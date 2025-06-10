from django.core.management.base import BaseCommand, CommandError
from django.conf import settings

import sys
import json

from treebanks.models import Treebank, Component, BaseXDB
from services.basex import basex


def userinputyesno(prompt, default=False):
    if default is True:
        default_view = " [Y/n]"
    else:
        default_view = " [y/N]"
    sys.stderr.write(prompt + default_view + "\n")
    answer = input()
    if answer[:1].lower() == "y":
        return True
    elif answer[:1].lower() == "n":
        return False
    elif answer.strip() == "":
        return default
    else:
        sys.stderr.write("Invalid answer given.\n")
        return userinputyesno(prompt, default)


class Command(BaseCommand):
    help = "Add treebank for which BaseX databases already exist"
    requires_migrations_checks = True

    def add_arguments(self, parser):
        parser.add_argument("configuration", help="JSON configuration file")

    class InputError(RuntimeError):
        pass

    class ArgumentError(RuntimeError):
        pass

    def create_database(self, dbname: str):
        # Get database size (and check if it exists)
        basex_db = BaseXDB(dbname)
        try:
            basex_db.size = basex_db.get_db_size()
            words = basex_db.get_number_of_words()
            sentences = basex_db.get_number_of_sentences()
        except OSError as err:
            raise CommandError(
                "Error accessing BaseX database {}: {}"
                " - probably this database does not exist.".format(dbname, str(err))
            )
        return basex_db, words, sentences

    def create_component(self, comp: dict):
        try:
            slug = comp["slug"]
            title = comp["title"]
            description = comp["description"]
            databases = comp["databases"]
        except KeyError as err:
            raise CommandError("Key {} missing in component definition.".format(err))
        component = Component(slug=slug, title=title, description=description)
        component.treebank = self.treebank
        component.variant = comp.get("variant", "")
        component.group = comp.get("group", "")
        basex_dbs = []
        nr_words = 0
        nr_sentences = 0
        for dbname in databases:
            basex_db, words, sentences = self.create_database(dbname)
            nr_words += words
            nr_sentences += sentences
            basex_db.component = component
            basex_dbs.append(basex_db)
        component.nr_words = nr_words
        component.nr_sentences = nr_sentences
        return component, basex_dbs

    def handle(self, *args, **options):  # noqa: C901
        if not basex.test_connection():
            raise CommandError(
                "Cannot connect to BaseX. " "This command needs BaseX to run."
            )

        config_file = options["configuration"]
        try:
            self.configuration = json.loads(open(config_file, "r").read())
        except OSError as err:
            raise CommandError("Cannot open configuration file: {}.".format(str(err)))
        except json.JSONDecodeError as err:
            raise CommandError("Cannot parse configuration file: {}.".format(str(err)))

        self.treebank = Treebank()
        try:
            self.treebank.slug = self.configuration["slug"]
            self.treebank.title = self.configuration["title"]
            self.config_components = self.configuration["components"]
        except KeyError as err:
            raise CommandError("Key {} missing from configuration file.".format(err))
        if Treebank.objects.filter(slug=self.treebank.slug).count() != 0:
            raise CommandError("Treebank {} already exists.".format(self.treebank.slug))

        # Optional treebank-wide fields that are stored in JSON
        self.treebank.variants = self.configuration.get("variants", "[]")
        self.treebank.groups = self.configuration.get("groups", "{}")
        self.treebank.metadata = self.configuration.get("metadata", "{}")

        # Get all Component and BaseXDB objects
        component_objs = []
        all_db_objs = []  # A flat list of all BaseXDB objects
        for component_config in self.config_components:
            component_obj, db_objs = self.create_component(component_config)
            component_objs.append(component_obj)
            all_db_objs.extend(db_objs)

        # If all objects have been created successfully, save them
        self.treebank.save()
        for component_obj in component_objs:
            component_obj.save()
        for db_obj in all_db_objs:
            db_obj.save()

        self.stdout.write(
            self.style.SUCCESS(
                "Successfully imported treebank {} with existing BaseX databases".format(
                    self.treebank.slug
                )
            )
        )

        if settings.DELETE_COMPONENTS_FROM_BASEX:
            self.stdout.write(
                self.style.WARNING(
                    "Warning: the DELETE_COMPONENTS_FROM_BASEX setting is "
                    "True, which means that the existing BaseX databases "
                    "will be deleted in case you delete this treebank."
                )
            )
