import logging
from typing import List, TypedDict

from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.generics import ListAPIView

from mwe_query.canonicalform import generatequeries

from .models import CanonicalForm
from .serializers import (
    CanonicalFormSerializer,
    XPathQuerySerializer,
    MweQuerySerializer,
)

log = logging.getLogger(__name__)


class CanonicalFormList(ListAPIView):
    queryset = CanonicalForm.objects.all().order_by("dcmid")
    serializer_class = CanonicalFormSerializer


class MWEQuery(TypedDict):
    xpath: str
    description: str
    rank: int


def generate_queries(sentence: str) -> List[MWEQuery]:
    """Generates a set of queries using the mwe-query package.
    (https://github.com/UUDigitalHumanitieslab/mwe-query)

    This happens on the basis of an alpino parse tree and results in three
    queries:
    1. Multi-word expression query
    2. "Near-miss" query
    3. Superset query (aka major lemma query)

    The superset query is special in the sense that it is executed directly on BaseX.
    The other queries are executed against the results of the superset query.
    This numbering scheme (1-3) is referred to as "rank" in the codebase, and reflects the idea that
    the results of query of rank i should be included in the results of query j if j>i.
    """

    # TODO: we could maybe replace the whole rank idea with an is_superset boolean
    generated = generatequeries(sentence)
    assert len(generated) == 3
    return [
        MWEQuery(xpath=generated[0], description="Multi-word expression query", rank=1),
        MWEQuery(xpath=generated[1], description="Near-miss query", rank=2),
        MWEQuery(xpath=generated[2], description="Major lemma query", rank=3),
    ]


class GenerateMweQueries(APIView):
    def post(self, request, format=None):
        """Generate XPath queries for a given canonical form of a MWE.
        If the MWE is a known form, it may have manually adjusted stored queries.
        Otherwise, queries are generated on-the-fly"""
        text = request.data["canonical"].lower()
        canonical = CanonicalForm.objects.filter(text=text).first()

        queries = dict()
        try:
            generated = generate_queries(text)
            # complement saved queries with newly generated ones, based on rank
            for i in range(len(generated)):
                queries[i] = MweQuerySerializer(generated[i]).data
        except Exception:
            log.exception("Could not generate MWE queries")
            return Response("Could not generate MWE queries", status=500)

        if canonical:
            # look for saved queries, replace generated with saved ones
            for query in canonical.xpathquery_set.all():
                queries[query.rank - 1] = XPathQuerySerializer(query).data

        return Response(queries.values())
