from django.core.management.base import BaseCommand

from treebanks.models import Treebank
from services.alpino import alpino, AlpinoError


class Command(BaseCommand):
    help = (
        "Show all versions of Alpino that were used to generate all "
        "installed treebanks"
    )

    def handle(self, *args, **kwargs):
        # Get version of installed Alpino
        try:
            alpino.initialize()
        except AlpinoError:
            self.stdout.write(
                self.style.WARNING(
                    "No connection to Alpino - cannot determine installed "
                    "Alpino version."
                )
            )
        else:
            self.stdout.write(
                "Installed Alpino version: {}".format(alpino.get_alpino_version())
            )

        treebanks = Treebank.objects.all()
        if not treebanks.count():
            self.stdout.write(self.style.WARNING("There are no installed treebanks."))
        else:
            self.stdout.write("Alpino versions for each treebank:")
            for treebank in treebanks:
                component = treebank.components.all().first()
                if not component:
                    self.stdout.write(
                        self.style.WARNING(
                            "  {}: has no components".format(str(treebank))
                        )
                    )
                    break
                database = component.databases.all().first()
                if not database:
                    self.stdout.write(
                        self.style.WARNING(
                            "  {}: has no databases".format(str(treebank))
                        )
                    )
                    break
                self.stdout.write(
                    "  {}: {}".format(str(treebank), database.get_alpino_version())
                )
