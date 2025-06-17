from typing import Optional, Tuple
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
def parse_get(request: Request, sentence: str):
    # separated by + instead of spaces (e.g. using quote_plus)
    # this was done by alpino-query < 2.1.10
    # ideally this should be done using unquote_plus
    # however the sentence and path_info we receive here
    # already contain the decoded plusses, meaning we cannot
    # make this distinction here anymore
    if '+' in sentence and ' ' not in sentence:
        sentence = sentence.replace('+', ' ')
    parsed_sentence, err = parse_sentence(sentence)
    if parsed_sentence is None:
        return Response(
            {"error": "Parsing error: {}".format(err)},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )
    return Response({"parsed_sentence": parsed_sentence})


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
