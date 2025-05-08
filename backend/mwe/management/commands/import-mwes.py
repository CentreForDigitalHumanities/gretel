from django.core.management.base import BaseCommand

from mwe.models import CanonicalForm


class Command(BaseCommand):
    def add_arguments(self, parser):
        parser.add_argument('input_file',
                            help='A tab-separated file with canonical forms')

    def handle(self, *args, **options):
        texts = {}
        with open(options['input_file'], 'r') as f:
            next(f)  # skip header
            for line in f:
                id, text = line.split('\t')
                texts[id] = text

        forms = [CanonicalForm(text=text, dcmid=key) for key, text in texts.items()]
        if forms:
            # list not empty
            CanonicalForm.objects.all().delete()
            CanonicalForm.objects.bulk_create(forms)
