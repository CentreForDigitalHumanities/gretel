from django.db import models
from django.utils import timezone
from django.db.models import F, Sum
from django.conf import settings
from django.db.models.signals import pre_delete, post_save
from django.dispatch import receiver

from copy import deepcopy
import logging
import pathlib
import re
from datetime import timedelta
from typing import List, Tuple, Iterable, Optional, Set
from lxml import etree

from treebanks.models import Component
from services.basex import basex
from .basex_search import (
    generate_xquery_search,
    parse_search_result,
    generate_xquery_count,
)
from .types import ResultSet, Result, ResultSetFilter

logger = logging.getLogger(__name__)


class SearchError(RuntimeError):
    pass


class ComponentSearchResult(models.Model):
    xpath = models.TextField()
    component = models.ForeignKey(Component, on_delete=models.CASCADE)
    variables = models.JSONField(blank=True, default=list)
    search_completed = models.DateTimeField(null=True, editable=False)
    last_accessed = models.DateField(null=True, editable=False)
    number_of_results = models.PositiveIntegerField(null=True, editable=False)
    cache_size = models.PositiveBigIntegerField(
        null=True, editable=False, help_text="Size of the cached results in bytes"
    )
    errors = models.TextField(default="", editable=False)
    completed_part = models.PositiveIntegerField(
        null=True,
        editable=False,
        help_text="Total size in KiB of databases for which the search has "
        "been completed",
    )

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["xpath", "component", "variables"],
                name="componentsearchresult_uniqueness",
            )
        ]

    def __str__(self):
        return '"{}…" for {}'.format(self.xpath[:10], self.component)

    def _get_cache_path(self) -> pathlib.Path:
        """Get the Path of the caching file corresponding to this ComponentSearchResult."""
        settings.CACHING_DIR.mkdir(exist_ok=True, parents=True)
        return settings.CACHING_DIR / str(self.id)

    def check_cache(self) -> bool:
        """Check if the cache file is readable and if its contents corresponds
        to what the database knows about it. If not, the search will have to 
        be repeated. If search is not yet completed, the cache size is not
        tested."""
        cache_path = self._get_cache_path()
        try:
            with cache_path.open():
                pass
        except OSError:
            return False
        # Cache file is readable, now check if size is correct
        if self.search_completed is None:
            return True
        else:
            actual_size = cache_path.stat().st_size
            size_equal = actual_size == self.cache_size
            if not size_equal:
                logger.warning(
                    f"Cache size for {self} is {actual_size} while it is supposed to be {self.cache_size}"
                )
            return size_equal

    def get_results(self) -> ResultSet:
        """Return results as a ResultSet (a list of ``Result`` objects)."""
        cache_path = self._get_cache_path()
        try:
            results = cache_path.read_text()
        except OSError:
            # Cache file is not present or not readable. This may happen when
            # results are fetched but searching has not yet started, or if
            # the cache file was deleted. Go on and return an empty set -
            # this is not problematic because an inconsistency between model
            # and cache will be detected by the code that performs the search.
            return []
        self.last_accessed = timezone.now()
        # This method may be called from multiple processes while the query is still
        # running. If we save the entire model, we will overwrite the progress
        # that other processes may have saved (e.g. search_completed) in case our copy
        # of the model was not refreshed in the meantime.
        self.save(update_fields=["last_accessed"])
        return parse_search_result(results, self.component.slug)

    def get_completed_part(self) -> Optional[int]:
        if self.check_cache():
            return self.completed_part
        return None

    def _truncate_results(self, results: str, number: int) -> str:
        matches = list(re.finditer("<match>", results))
        start_of_nth_match = matches[number].span()[0]
        return results[:start_of_nth_match]

    def _was_query_cancelled(self, query_id):
        """Check if a SearchQuery object was cancelled. We get this
        immediately from the database, because this operation has to
        be frequently repeated."""
        return SearchQuery.objects.values_list("cancelled", flat=True).get(id=query_id)

    def perform_search(self, query_id=None):  # noqa: C901
        """Perform full component search and regularly update database
        with the progress so far. Saves the object if it has no value
        for its id. Most errors are written to the model's errors
        attribute, but a SearchError is raised if checks at the beginning
        are failing."""
        if not self.id:
            # Save, because we need the id for the caching file
            self.save()
        # Get BaseX databases belonging to component
        databases_with_size = self.component.get_databases()
        # Initialize variables
        self.results = ""
        self.errors = ""
        self.completed_part = 0
        self.number_of_results = 0
        # Open cache file
        try:
            resultsfile = self._get_cache_path().open(mode="w")
        except OSError:
            raise SearchError("Could not open caching file")
        try:
            with resultsfile:
                cancelled = False
                did_break = False
                # Go through all BaseX databases
                for database in databases_with_size:
                    size = databases_with_size[database]
                    # Check how many results we can still add to the cache file,
                    # respecting the maximum number of results per component
                    maximum_to_add = (
                        settings.MAXIMUM_RESULTS_PER_COMPONENT - self.number_of_results
                    )
                    if maximum_to_add > 0:
                        # We can still add, so perform a search on this database
                        try:
                            query = generate_xquery_search(database, self.xpath)
                            result = basex.perform_query_iter(query)
                        except (OSError, UnicodeDecodeError, ValueError) as err:
                            self.errors += (
                                "Error searching database {}: ".format(database)
                                + str(err)
                                + "\n"
                            )
                            result = []  # No break, keep going

                        results_for_database = 0
                        for _, entry in result:
                            if results_for_database > maximum_to_add:
                                # no need to read the rest of the results,
                                # but we do need to run a separate count query if we
                                # want an accurate count
                                did_break = True
                                break
                            results_for_database += 1
                            resultsfile.write(entry)

                        if not did_break:
                            self.number_of_results += results_for_database

                    if maximum_to_add <= 0 or did_break:
                        # The maximum number of results per component has been
                        # reached. From now on only count the number of results,
                        # which is somewhat faster
                        query = generate_xquery_count(database, self.xpath)
                        try:
                            count = int(basex.perform_query(query))
                        except (OSError, UnicodeDecodeError, ValueError) as err:
                            self.errors += (
                                "Error searching database {}: ".format(database)
                                + str(err)
                                + "\n"
                            )
                            count = 0
                        self.number_of_results += count
                    self.completed_part += size
                    self.save()
                    if query_id is not None and self._was_query_cancelled(query_id):
                        cancelled = True
                        break
            self.cache_size = self._get_cache_path().stat().st_size
            if not cancelled:
                self.search_completed = timezone.now()
        except Exception as err:
            self.errors += f"Error searching: ${err}\n"
        self.last_accessed = timezone.now()
        self.save()

    def init_cache_file(self):
        self._get_cache_path().touch()

    def delete_cache_file(self):
        """Delete the cache file belonging to this ComponentSearchResult.
        This method is called automatically on delete."""
        cache_path = self._get_cache_path()
        cache_path.unlink(missing_ok=True)
        logger.info(
            "Deleted cache for ComponentSearchResult with ID {}.".format(self.id)
        )

    @classmethod
    def empty_cache(cls) -> int:
        """Empty search result cache by deleting all CSR objects.
        Return number of CSR objects that were deleted."""
        # Delete all objects one by one to make sure cache files are
        # deleted as well
        count = 0
        for csr in cls.objects.all():
            csr.delete()
            count += 1
        return count

    @classmethod
    def purge_cache(cls):
        yesterday = timezone.now() - timedelta(days=1)
        # Get total cache size
        total_size = cls.objects.aggregate(Sum("cache_size"))["cache_size__sum"]
        if total_size is None:
            # This happens if all CSRs have no filled in cache size
            return
        # Calculate how much data we should delete
        maximum_size = settings.MAXIMUM_CACHE_SIZE * 1024 * 1024
        to_delete = total_size - maximum_size
        if to_delete <= 0:
            logger.info("Size of component search result cache is ok.")
            return
        # Get CSRs starting with lowest last accessed date
        number_deleted = 0
        for csr in cls.objects.order_by("last_accessed"):
            if csr.cache_size is None:
                continue
            if csr.searchquery_set.filter(last_accessed__lt=yesterday).count() > 0:
                # Do not delete if there are queries that might still be active
                continue
            to_delete -= csr.cache_size
            csr.delete()
            number_deleted += 1
            if to_delete <= 0:
                break
        if to_delete <= 0:
            logger.info(
                "Deleted the {} component search results having the "
                "earliest last access date to make space in cache.".format(
                    number_deleted
                )
            )
        else:
            logger.warning(
                "Deleted {} component search results to make "
                "space in cache, but cache is still larger than "
                "maximum size.".format(number_deleted)
            )


@receiver(post_save, sender=ComponentSearchResult)
def component_search_result_create_callback(sender, instance, using, **kwargs):
    instance.init_cache_file()


@receiver(pre_delete, sender=ComponentSearchResult)
def delete_basex_db_callback(sender, instance, using, **kwargs):
    instance.delete_cache_file()


class SearchQuery(models.Model):
    # User-defined fields
    components = models.ManyToManyField(Component)
    xpath = models.TextField()
    variables = models.JSONField(blank=True, default=list)
    # Fields that are filled in as soon as searching has started
    results = models.ManyToManyField(ComponentSearchResult, editable=False)
    total_database_size = models.PositiveIntegerField(
        null=True,
        editable=False,
        help_text="Total size in KiB of all databases for this query",
    )
    cancelled = models.BooleanField(
        default=False, help_text="True if the query was cancelled by the user"
    )
    last_accessed = models.DateTimeField(null=True, editable=False)

    # makes it possible to register extra filters (callback functions)
    # to further process the raw XPath results from BaseX
    filters: List[ResultSetFilter]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.filters = []

    def initialize(self) -> None:
        """Initialize search query after entering XPath and list of
        components by calculating total database size and creating
        ComponentSearchResult-s"""
        self.total_database_size = 0
        if not self.pk:
            # If object has not been saved we cannot add ComponentSearchResult
            raise RuntimeError(
                "SearchQuery should be saved before calling initialize()"
            )
        results = []
        for component in self.components.all():
            result, created = ComponentSearchResult.objects.get_or_create(
                xpath=self.xpath, component=component, variables=self.variables
            )
            if component.total_database_size is not None:
                self.total_database_size += component.total_database_size
            results.append(result)
        self.results.add(*results)
        self.save()

    def _component_results(self) -> Iterable[ComponentSearchResult]:
        return self.results.all().order_by("component")

    def _count_results(self, result: ComponentSearchResult) -> Optional[int]:
        if not self.filters:
            # fast path, no furether filtering necessary
            return result.number_of_results

        # slow path, iterate over all results and run filters
        matches = result.get_results()
        for filter_ in self.filters:
            matches = filter_(matches)
        return len(list(matches))

    def get_results(
        self, max_results: Optional[int] = None, exclude: Optional[Set[str]] = None
    ) -> Tuple[ResultSet, float, List]:
        """Get results so far, except for those whose ids are in `exclude`.
        Object should have been initialized with initialize() method but search does not have to be started yet
        with perform_search() method. Return a tuple of the result as
        a list of dictionaries and the percentage of search completion.
        This method saves the object to update last accessed time."""
        completed_part = 0
        all_matches: List[Result] = []
        counts = []

        # In the following code we loop over `self.results` twice:
        # 1. First we collect matches, and for that we would like to stop once
        # the desired amount of matches is reached.

        for result_obj in self._component_results():
            matches = result_obj.get_results()
            # exclude matches that were already returned
            if exclude is not None:
                matches = [m for m in matches if m.id not in exclude]

            for filter_ in self.filters:
                matches = filter_(matches)
            all_matches.extend(matches)

            if max_results is not None and len(all_matches) > max_results:
                break

        # 2. Here we collect statistics, and for that we would
        # like to loop over the complete results set.

        for result_obj in self._component_results():
            # Count completed part (for all results)
            part = result_obj.get_completed_part()
            if part is not None:
                completed_part += part
                percentage = part / max(
                    1, result_obj.component.total_database_size * 100
                )
                counts.append(
                    {
                        "component": result_obj.component.slug,
                        "number_of_results": self._count_results(result_obj),
                        "completed": result_obj.search_completed is not None,
                        "percentage": percentage,
                    }
                )

        if self.total_database_size != 0 and self.total_database_size is not None:
            search_percentage = int(
                100 * completed_part / max(1, self.total_database_size)
            )
        else:
            search_percentage = 100

        # Check if too many results have been added
        if max_results is not None:
            all_matches = all_matches[0:max_results]

        self.last_accessed = timezone.now()
        self.save()
        all_matches = list(self.augment_with_variables(all_matches))
        return (all_matches, search_percentage, counts)

    def perform_search(self) -> None:
        """Perform search and regularly update on progress"""
        # Get result objects for this query, but only those that have not
        # completed yet, and starting with those that have not started yet
        # (because those for which search has already started may finish
        # early).
        result_objs_query = self.results.filter(search_completed__isnull=True)
        # add failed result objects (with errors and no results)
        result_objs_query |= (
            self.results.filter(number_of_results=0)
            .exclude(errors=None)
            .exclude(errors="")
        )

        result_objs_query = result_objs_query.order_by(
            F("completed_part").desc(nulls_first=True), "component__slug"
        )

        result_objs = list(result_objs_query)
        # append results that should be complete but can't be read
        result_objs += [r for r in self.results.filter(search_completed__isnull=False) if not r.check_cache()]

        # loop through the linked ComponentSearchResults.
        # for each component, we have to either run the query (perform_search)
        # or read the results that were already collected (get_results)
        for result_obj in result_objs:
            result_obj.refresh_from_db()
            # if search has been completed, we expect to be able to read the results
            if result_obj.search_completed and not result_obj.errors:
                # kinda roundabout way to make sure the results are readable before skipping it
                # make sure the results are accessible, because reading the cache might fail
                if result_obj.check_cache():
                    # results are readable, skip the rest of the loop
                    continue
            try:
                result_obj.perform_search(self.id)
            except SearchError:
                logger.error(
                    "Failed executing query for ComponentSearchResult (%d)",
                    result_obj.pk,
                )
                raise

            # Check if search has been cancelled in the meantime
            self.refresh_from_db(fields=["cancelled"])
            if self.cancelled:
                # skip the rest of the components
                break

    def get_errors(self) -> str:
        errs = ""
        result_objs = self.results.order_by("component")
        for result_obj in result_objs:
            if result_obj.errors:
                errs += "Errors in searching component {}: " "\n{}\n\n".format(
                    result_obj.component, result_obj.errors
                )
        return errs

    def perform_count(self) -> dict:
        """Perform a full count without using any cached results or saving
        anything and return a dict of all components (using their slugs
        as keys) and the counts. This is mainly meant for debug purposes
        to check if no results are accidentally skipped when using the
        views. The XQuery code is equal to that of GrETEL 4. No need to
        call initialize() first."""
        counts = {}
        try:
            for component in self.components.all():
                component_count = 0
                dbs = component.get_databases().keys()
                for db in dbs:
                    xquery = generate_xquery_count(db, self.xpath)
                    component_count += int(basex.perform_query(xquery))
                counts[component.slug] = component_count
        except (OSError, ValueError) as err:
            # Propagate errors because of bad XPath or BaseX problems
            raise SearchError(str(err))
        return counts

    def cancel_search(self) -> None:
        """Mark search as cancelled and save object"""
        self.cancelled = True
        self.save()

    def augment_with_variables(self, matches: ResultSet) -> ResultSet:
        # register missing xpath lower-case() function for lxml
        ns = etree.FunctionNamespace(None)
        ns["lower-case"] = lambda ctx, lst: [x.lower() for x in lst]

        for m in matches:
            # stores all nodes (root and variables) on which we run xpaths
            # this is using the old notation from the original basex query
            nodes = dict()
            nodes["$node"] = m.tree

            vars = []
            for var in self.variables:
                if var["name"] in nodes:
                    continue

                try:
                    target_name, query = var["path"].split("/", 1)
                    target = nodes[target_name]
                    node = target.xpath(query)[0]
                except KeyError:
                    # skip missing variables
                    continue

                # save result for subsequent queries
                nodes[var["name"]] = deepcopy(node)

                # transform result into a <var/> element
                node.attrib["name"] = var["name"]
                node.tag = "var"

                vars.append(etree.tostring(node).decode())
            vars_str = "".join(vars)
            m.variables = f"<vars>{vars_str}</vars>"
        return matches

    def augment_with_context(self, matches: ResultSet) -> ResultSet:
        """Fetch preceding and following sentences for matches in the result set"""
        strip_match = re.compile(r"\+match=\d+$")
        for match in matches:
            sentid = strip_match.sub("", match._match.sentid)

            # TODO: there's probably a more efficient way to fetch everything in a single query
            # instead of one query per match

            query = (
                '''
            let $tree := db:open("'''
                + match._match.database
                + '''")/treebank/alpino_ds[
            @id="'''
                + sentid
                + """"
            ]
            let $prevs := $tree/preceding-sibling::alpino_ds[1]/sentence
            let $nexts := $tree/following-sibling::alpino_ds[1]/sentence
            return
            <match>{data($prevs)}||{data($nexts)}</match>
            """
            )
            result = basex.perform_query(query)
            prevs, nexts = result.split("||")
            prevs = prevs.replace("<match>", "")
            nexts = nexts.replace("</match>", "")
            match.add_context(prevs, nexts)
        return matches

    def add_filter(self, filter_: ResultSetFilter):
        self.filters.append(filter_)
