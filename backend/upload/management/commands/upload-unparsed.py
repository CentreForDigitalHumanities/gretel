from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from upload.models import TreebankUpload, UploadError


class Command(BaseCommand):
    help = 'Add corpus from directory or compressed file containing ' \
           'unparsed files'

    def add_arguments(self, parser):
        parser.add_argument(
            'input_path',
            help='compressed file or directory containing input files'
        )

    def handle(self, *args, **options):
        upload = TreebankUpload()
        path = Path(options['input_path'])
        if path.is_dir():
            upload.input_dir = path
        else:
            raise CommandError('Cannot work with compressed files for now. '
                               'Please provide a directory.')
        self.stdout.write(self.style.SUCCESS(
            'Inspecting input files...'
        ))
        try:
            upload.prepare()
        except UploadError as err:
            self.stdout.write(self.style.ERROR(
                'Upload preparation failed: {}'.format(str(err))
            ))
        number_of_files = sum([len(x) for x in upload.components.values()])
        number_of_components = len(upload.components)
        self.stdout.write(self.style.SUCCESS(
            'Found {} input files of {} type that will be placed in {} '
            'components.'
            .format(number_of_files, upload.get_input_format_display(),
                    number_of_components)
        ))
        try:
            upload.process()
        except UploadError as err:
            self.stdout.write(self.style.ERROR(
                'Upload preparation failed: {}'.format(str(err))
            ))
