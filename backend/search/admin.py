from django.contrib import admin
from django.contrib import messages

import pprint

from .models import ComponentSearchResult, SearchQuery, SearchError


@admin.action(description="Perform search")
def perform_search(modeladmin, request, queryset):
    """Admin action to manually perform search for debug purposes"""
    errors = False
    for component_search in queryset:
        try:
            component_search.perform_search()
            if component_search.errors:
                errors = True
        except SearchError:
            errors = True
    if not errors:
        modeladmin.message_user(
            request, "Component search has successfully completed", messages.SUCCESS
        )
    else:
        modeladmin.message_user(
            request, "Component search has completed with errors", messages.WARNING
        )


@admin.action(description="Perform count")
def perform_count(modeladmin, request, queryset):
    """Admin action to perform a count on a search query, to check if
    the frontend is returning all results"""
    total_count = 0
    for search_query in queryset:
        try:
            results = search_query.perform_count()
        except SearchError:
            modeladmin.message_user(
                request,
                "Could not complete count: {}".format(str(SearchError)),
                messages.ERROR,
            )
        print("Results for query number {}:".format(search_query.id))
        pprint.pprint(results)
        total_count += sum(results.values())
    modeladmin.message_user(
        request, "Total count: {}. See console log for details.".format(total_count)
    )


@admin.register(SearchQuery)
class SearchQueryAdmin(admin.ModelAdmin):
    list_display = ["id", "xpath", "query_of", "total_database_size"]
    readonly_fields = ["total_database_size"]
    actions = [perform_count]

    def query_of(self, obj):
        return str(obj.components.all().first()) + ", …"


@admin.register(ComponentSearchResult)
class ComponentSearchResultAdmin(admin.ModelAdmin):
    list_display = ["component", "xpath", "search_completed", "number_of_results"]
    actions = [perform_search]
    readonly_fields = [
        "search_completed",
        "last_accessed",
        "number_of_results",
        "errors",
        "completed_part",
        "cache_size",
    ]
