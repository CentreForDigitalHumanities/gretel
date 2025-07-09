from pathlib import Path
import re
from lxml import etree
import logging

from django.db import models
from django.contrib.auth.models import User
from django.utils.text import slugify

from corpus2alpino.converter import Converter
from corpus2alpino.collectors.filesystem import FilesystemCollector
from corpus2alpino.targets.memory import MemoryTarget
from corpus2alpino.writers.lassy import LassyWriter

from treebanks.models import Treebank, Component, BaseXDB
from services.alpino import alpino, AlpinoError
from services.basex import basex

logger = logging.getLogger(__name__)

MAXIMUM_DATABASE_SIZE = 1024 * 1024 * 10  # 10 MiB


class UploadError(RuntimeError):
    pass


class TreebankUpload(models.Model):
    '''Class to upload texts of various input formats to GrETEL. The model
    can keep information about the upload progress during the various stages
    of the process (i.e. after uploading and inspecting the files, during
    processing and after processing), allowing user interaction in between,
    but if the process can be executed in one run (e.g. after calling a
    Django management command) it does not have to be saved at all. To use,
    make sure that input_file or input_dir is set and subsequently call
    prepare() and process().'''
    class InputFormat(models.TextChoices):
        ALPINO = 'A', 'Alpino'
        CHAT = 'C', 'CHAT'
        TXT = 'T', 'plain text'
        FOLIA = 'F', 'FoLiA'
    MAX_METADATA_OPTIONS = 20

    treebank = models.OneToOneField(Treebank, on_delete=models.SET_NULL,
                                    null=True)
    input_file = models.FileField(upload_to='uploaded_treebanks/', blank=True)
    input_dir = models.CharField(max_length=255, blank=True)
    input_format = models.CharField(max_length=2, choices=InputFormat.choices)
    upload_timestamp = models.DateTimeField(
        verbose_name='Upload date and time', null=True, blank=True
    )
    uploaded_by = models.ForeignKey(User, null=True, blank=True,
                                    on_delete=models.SET_NULL)
    public = models.BooleanField(default=False)
    sentence_tokenized = models.BooleanField(null=True)
    word_tokenized = models.BooleanField(null=True)
    sentences_have_labels = models.BooleanField(null=True)
    processed = models.DateTimeField(null=True, blank=True)

    def get_metadata(self):
        '''Return a list containing the discovered metadata of this treebank,
        available after processing has finished. Format is the same as in the
        Treebank model.'''
        # This method uses the private _metadata attribute but does some
        # optimization by probing metadata facets (e.g. slider if all
        # values of the field are numeric, otherwise checkbox) and removing
        # metadata fields with too many different values.
        if not hasattr(self, '_metadata'):
            raise UploadError('Treebank was not yet processed')
        datas = []
        for fieldname in self._metadata:
            field = self._metadata[fieldname]
            data = {'field': fieldname, 'type': field['type']}
            if field.get('allnumeric', None):
                if field['type'] != 'int':
                    logger.info(
                        'Changing metadata field {} from type {} to int'
                        .format(fieldname, field['type'])
                    )
                    data['type'] = 'int'
                data['min_value'] = field['min_value']
                data['max_value'] = field['max_value']
                data['facet'] = 'slider'
            if 'facet' not in data:
                data['facet'] = 'checkbox'
            if len(field['values']) > self.MAX_METADATA_OPTIONS and \
                    data['facet'] == 'checkbox':
                # Do not include checkboxes that consist of too many values
                continue
            datas.append(data)
        return datas

    def _discover_metadata(self, xml: str):
        '''Helper method to discover the metadata for a number of sentences
        (to be passed in xml as the argument to this method). This method
        updates the private _metadata class attribute.'''
        root = etree.fromstring(xml)
        for sentence in root.findall('alpino_ds'):
            metadata = sentence.find('metadata')
            for meta in metadata.findall('meta'):
                name = meta.get('name')
                type_ = meta.get('type')
                value = meta.get('value')
                m = self._metadata.get(name, None)
                if m:
                    if len(m['values']) <= (self.MAX_METADATA_OPTIONS + 1):
                        # Only add to values set if not too large -
                        # we only use this to test if a filter should be
                        # created
                        m['values'].add(value)
                    if m.get('allnumeric', None):
                        if value.isnumeric():
                            m['min_value'] = min(m['min_value'], int(value))
                            m['max_value'] = max(m['max_value'], int(value))
                        else:
                            m['allnumeric'] = False
                else:
                    m = {}
                    m['type'] = type_
                    m['values'] = {value}
                    if value.isnumeric():
                        m['allnumeric'] = True
                        m['min_value'] = int(value)
                        m['max_value'] = int(value)
                    self._metadata[name] = m

    def _probe_file(self, path):
        '''Probe file format to allow autodiscovery'''
        filename = str(path)
        if filename.lower().endswith('.txt'):
            return self.InputFormat.TXT
        elif filename.lower().endswith('.cha'):
            return self.InputFormat.CHAT
        elif filename.lower().endswith('.xml'):
            with open(filename, 'r') as f:
                firstline = f.readline()
                secondline = f.readline()
                if firstline.startswith('<FoLiA'):
                    return self.InputFormat.FOLIA
                elif secondline.startswith('<alpino_ds'):
                    return self.InputFormat.ALPINO
        return None

    def _unpack(self):
        '''Unpack compressed input file and set input_dir.
        TODO: not yet implemented.'''
        if not self.input_file:
            raise UploadError('Need input_file to unpack')
        raise UploadError('Unpacking not yet implemented')

    def _add_file(self, path: Path, component: str):
        '''Include the file if it is of a supported format and if no
        files of another supported format had been found. Otherwise
        ignore the file.'''
        format = self._probe_file(path)
        if format:
            if self.input_format and format != self.input_format:
                raise UploadError(
                    'Different input formats found ({} and {}).'
                    .format(self.input_format, format)
                )
            self.input_format = format
            if component not in self.components:
                self.components[component] = []
            self.components[component].append(path)

    def _read_input_files(self):
        '''Divide extracted files into components and probe input format'''
        inputpath = Path(self.input_dir)

        # Put all toplevel files in a 'main' component and all files
        # in a subdirectory in a component with the name of the directory
        self.components = {}
        for entry in inputpath.glob('*'):
            if entry.is_file():
                self._add_file(entry, 'main')
            if entry.is_dir():
                files = entry.glob('**/*')
                for f in files:
                    self._add_file(f, entry.name)

    def prepare(self):
        '''Unpack (if input file is zipped) and inspect files. If this
        method runs without error, the processing is ready to start and
        the components class attribute (a dict of all components with
        the corresponding filenames) is available.'''
        if not self.input_dir:
            self._unpack()
        self._read_input_files()

    def _generate_blocks(self, filenames, componentslug):
        '''A generator function converting all files in filenames to
        Alpino, yielding multiple strings ready to be added to BaseX,
        respecting MAXIMUM_DATABASE_SIZE.'''
        # This method directly manipulates the XML using regular expressions,
        # but it may be a good idea to use lxml for this because of
        # possible changes in what Alpino returns.
        current_output = []
        current_length = 0
        current_id = 0
        current_file = 0
        nr_words = 0
        nr_sentences = 0
        for filename in filenames:
            converter = Converter(FilesystemCollector([filename]),
                                  annotators=[alpino.annotator],
                                  target=MemoryTarget(),
                                  writer=LassyWriter(True))
            parses = converter.convert()
            try:
                results = list(parses)
            except Exception as e:
                logger.error('Could not process file {} - skipping: {}'
                             .format(filename, str(e)))
                current_file += 1
                continue
            assert len(results) == 1
            parse = results[0]
            current_file += 1
            current_length += len(parse)
            stripped = parse.strip()
            stripped = re.sub(
                '^' + re.escape(
                    '<?xml version="1.0" encoding="UTF-8"?>\n<treebank>'
                ), '', stripped
            )  # Alternative for str.removeprefix()
            stripped = re.sub(
                re.escape('</treebank>') + '$', '', stripped
            )
            lines = stripped.split('\n')
            for line in lines:
                if 'cat="top"' in line:
                    # Like gretel-upload, determine number of words using the
                    # 'end' attribute in the top-level node
                    nr_words += int(
                        re.search('end=\"(.+?)\"', line).group(1)
                    )
                if '<alpino_ds' in line:
                    # Each <alpino_ds> tag contains one sentence
                    nr_sentences += 1
                    # Add id to the end of the tag for identification in GrETEL
                    tagend_pos = line.find('">') + 1
                    id_attr = ' id="{}:{}"'.format(componentslug, current_id)
                    line = line[:tagend_pos] + id_attr + line[tagend_pos:]
                    current_id += 1
                current_output.append(line)
            if current_length > MAXIMUM_DATABASE_SIZE:
                # Yield as soon as the maximum length is reached
                yield ('<treebank>' + ''.join(current_output) + '</treebank>',
                       nr_words, nr_sentences, current_file)
                current_length = 0
                nr_words = 0
                nr_sentences = 0
                current_output.clear()
        # Yield once more as soon as all files have been read
        yield ('<treebank>' + ''.join(current_output) + '</treebank>',
               nr_words, nr_sentences, current_file)

    def process(self):
        '''Process prepared treebank upload. This method converts the
        prepared input files to Alpino format, uploads them to BaseX,
        probes metadata and creates Treebank/Component/BaseXDB model
        instances.'''
        try:
            alpino.initialize()
        except AlpinoError as e:
            raise UploadError('Alpino not available: {}'.format(str(e)))
        if not basex.test_connection():
            raise UploadError('BaseX not available')

        # Check if preparation has been done yet
        if not self.input_dir or not hasattr(self, 'components'):
            raise UploadError('prepare() has to be called first')

        treebankslug = slugify(Path(self.input_dir).name)

        # Check if treebank already exists
        if Treebank.objects.filter(slug=treebankslug).exists():
            raise UploadError('Treebank {} already exists.'
                              .format(treebankslug))

        treebank = Treebank(slug=treebankslug, title=treebankslug)
        treebank.save()
        component_objs = []
        basexdb_objs = []
        total_number_of_files = sum([len(x) for x in self.components.values()])
        total_processed_files = 0
        self._metadata = {}
        for component in self.components:
            logger.info('Processing component {} out of {}'
                        .format(len(component_objs) + 1, len(self.components)))
            nr_words = 0
            nr_sentences = 0
            componentslug = slugify(component)
            comp_obj = Component(slug=componentslug, title=componentslug)
            comp_obj.treebank = treebank
            component_objs.append(comp_obj)
            filenames = [str(x) for x in self.components[component]]
            if not len(filenames):
                logger.warning('Component {} is empty.'.format(component))
                continue
            db_sequence = 0
            for result in self._generate_blocks(filenames, componentslug):
                doc, words, sentences, files_processed = result
                self._discover_metadata(doc)
                nr_words += words
                nr_sentences += sentences
                comp_obj.nr_sentences = nr_sentences
                comp_obj.nr_words = nr_words
                comp_obj.save()
                dbname = ('GRETEL5_' + treebankslug + '_' + componentslug +
                          '_' + str(db_sequence)).upper()
                basexdb_obj = BaseXDB(dbname)
                basexdb_objs.append(basexdb_obj)
                basexdb_obj.component = comp_obj
                basex.create(dbname, doc)
                basexdb_obj.size = basexdb_obj.get_db_size()
                basexdb_obj.save()
                db_sequence += 1
                percentage_component = int(files_processed
                                           / len(filenames) * 100)
                percentage = int((files_processed + total_processed_files) /
                                 total_number_of_files * 100)
                logger.info('{} out of {} files processed ({}%, {}% of total)'
                            .format(files_processed, len(filenames),
                                    percentage_component, percentage))
            total_processed_files += files_processed
        treebank.metadata = self.get_metadata()
        treebank.save()
