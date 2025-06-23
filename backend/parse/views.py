from typing import Optional, Tuple
from urllib.parse import unquote, unquote_plus
import re
from rest_framework.response import Response
from rest_framework.decorators import (
    api_view,
    parser_classes,
    renderer_classes,
    authentication_classes,
)
from rest_framework.parsers import JSONParser
from rest_framework.renderers import BaseRenderer, JSONRenderer, BrowsableAPIRenderer
from rest_framework.request import Request
from rest_framework.authentication import BasicAuthentication
from rest_framework import status
from functools import lru_cache

from lxml import etree
from alpino_query import AlpinoQuery

from services.alpino import alpino, AlpinoError


class XmlSentenceRenderer(BaseRenderer):
    media_type = "text/xml"
    format = "xml"

    def render(self, data, accepted_media_type=None, renderer_context=None):
        return data["parsed_sentence"]


@api_view(["POST"])
@authentication_classes([BasicAuthentication])
@renderer_classes([JSONRenderer, BrowsableAPIRenderer])
@parser_classes([JSONParser])
def parse_post(request: Request):
    data = request.data
    try:
        sentence = data["sentence"]
    except KeyError as err:
        return Response(
            {"error": "{} is missing".format(err)}, status=status.HTTP_400_BAD_REQUEST
        )
    
    parsed_sentence, err = parse_sentence(sentence)
    if parsed_sentence is None:
        return Response(
            {"error": "Parsing error: {}".format(err)},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )
    return Response({"parsed_sentence": parsed_sentence})


@api_view(["GET"])
@renderer_classes([XmlSentenceRenderer, JSONRenderer, BrowsableAPIRenderer])
def parse_get(request: Request, *_):
    # *_ is needed because of the group in the path
    # it will be passed to this method, but we don't use the value
    # e.g. /parse/parse-sentence?s=<sentence>
    #   This is an option when more lenience is required for weird characters
    #   such as only parsing a period
    #   Warning: adding a slash at the end of the route
    #   will not work, because this will match the POST route
    # e.g. /parse/parse-sentence/<sentence>
    # This is done because
    # 1. if the sentence is separated using + (using quote_plus)
    #    the + and %2B are both replaced with + which is useless
    # 2. if a slash is in the sentence this is escaped by %2F
    #    however the routing replaces this slash with an actual
    #    slash and then tries to find this route; which doesn't
    #    exist so the user would get a 404
    #    also see: https://github.com/django/asgiref/issues/51
    pattern = r'^.*?parse-sentence(\?s=|/)'
    full_path = request.parser_context['request'].get_full_path()
    short_path = re.sub(pattern, '', full_path)
    # separated by + instead of spaces (e.g. using quote_plus)
    # this was done by alpino-query < 2.1.10
    # use a plain unquote if separated by spaces: we assume
    # any + is intentional and should be included in the sentence
    sentence = unquote(short_path) if '%20' in short_path else unquote_plus(short_path)
    parsed_sentence, err = parse_sentence(sentence)
    if parsed_sentence is None:
        return Response(
            {"error": "Parsing error: {}".format(err)},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )
    return Response({"parsed_sentence": parsed_sentence})

# cache up to about 100 MB of sentences
@lru_cache(maxsize=500000)
def parse_sentence(sentence: str) -> Tuple[Optional[str], Optional[AlpinoError]]:
    try:
        alpino.initialize()
        return alpino.client.parse_line(sentence, "zin"), None
    except AlpinoError as err:
        return None, err


@api_view(['POST'])
@authentication_classes([BasicAuthentication])
@renderer_classes([JSONRenderer, BrowsableAPIRenderer])
@parser_classes([JSONParser])
def generate_xpath_view(request: Request):
    data = request.data
    try:
        # TODO perhaps use a schema for this...
        xml = data['xml']
        tokens = data['tokens']
        attributes = data['attributes']
        ignore_top_node = data['ignoreTopNode']
        respect_order = data['respectOrder']
    except KeyError as err:
        return Response(
            {'error': '{} is missing'.format(err)},
            status=status.HTTP_400_BAD_REQUEST
        )

    if ignore_top_node:
        remove = ['rel', 'cat']
    else:
        remove = ['rel']
    try:
        query = AlpinoQuery()
        query.mark(xml, tokens, attributes)
        marked_tree = query.marked_xml
        query.generate_subtree([remove])
        sub_tree = query.subtree_xml
        xpath = query.generate_xpath(respect_order)
    except etree.XMLSyntaxError as err:
        return Response(
            {'error': 'syntax error in input XML: {}'.format(err)},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR
        )

    response = {
        'xpath': xpath,
        'markedTree': marked_tree,
        'subTree': sub_tree
    }
    return Response(response)
