from dataclasses import dataclass
from typing import Any, Dict, Iterable, Optional, Callable

from lxml import etree


@dataclass
class BaseXMatch:
    sentid: str
    sentence: str
    ids: str
    begins: str
    xml_sentences: str
    meta: str
    component: str
    database: str


class Result:
    _match: BaseXMatch
    _tree: Optional[etree.ElementTree]
    _variables: str
    _nexts: str
    _prevs: str
    attributes: Dict[str, Any] = {}

    def __init__(self, match: BaseXMatch):
        self._match = match
        self._tree = None
        self._variables = ''
        self._prevs = ''
        self._nexts = ''

    def as_dict(self):
        return dict(
            sentid=self._match.sentid,
            sentence=self._match.sentence,
            prevs=self._prevs,
            nexts=self._nexts,
            ids=self._match.ids,
            begins=self._match.begins,
            xml_sentences=self._match.xml_sentences,
            meta=self._match.meta,
            variables=self._variables,
            component=self._match.component,
            database=self._match.database,
            attributes=self.attributes)

    @property
    def tree(self) -> etree.ElementTree:
        if self._tree is None:
            # important: we have to use lxml.etree and not Python's builtin ElementTree
            # for compatibility with mwe-query
            self._tree = etree.fromstring(self._match.xml_sentences)
        return self._tree

    @tree.setter
    def tree(self, tree):
        # we want to allow manipulations for the result tree
        # note however that this has no effect on the serialized result (see as_dict())
        self._tree = tree

    @property
    def variables(self):
        return self._variables

    @variables.setter
    def variables(self, variables):
        # this is set by SearchQuery, but variable resolution could potentially be moved here
        self._variables = variables

    @property
    def begins(self) -> Iterable[int]:
        return (int(begin) for begin in self._match.begins.split('-'))

    def add_context(self, prevs, nexts):
        self._prevs = prevs
        self._nexts = nexts

    @property
    def id(self) -> str:
        return self._match.sentid

    def __eq__(self, other):
        # used for testing purposes
        return self._match == other._match


ResultSet = Iterable[Result]
ResultSetFilter = Callable[[ResultSet], ResultSet]
