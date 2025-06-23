from parse.views import sentence_from_path


def test_sentence_from_path():
    assert (
        sentence_from_path("/parse/parse-sentence?format=api&s=Dit+is+een+test")
        == "Dit is een test"
    )
    assert (
        sentence_from_path("/parse/parse-sentence?s=Dit+is+een+test&format=api")
        == "Dit is een test"
    )
    assert (
        sentence_from_path("/parse/parse-sentence/Dit+is+een+test?format=api")
        == "Dit is een test"
    )
    assert (
        sentence_from_path("/parse/parse-sentence/Dit%20is%20een%20test?format=xml")
        == "Dit is een test"
    )
    assert (
        sentence_from_path("/parse/parse-sentence/Een+en%2Fof-vraag")
        == "Een en/of-vraag"
    )
    assert (
        sentence_from_path("/parse/parse-sentence/Een en%2Fof-vraag")
        == "Een en/of-vraag"
    )
    assert sentence_from_path("/parse/parse-sentence?s=.") == "."
    assert sentence_from_path("/parse/parse-sentence/Wat%3F") == "Wat?"
    assert (
        sentence_from_path(
            "/parse/parse-sentence?format=json&s=Eén%20+%20één%20=%20twee"
        )
        == "Eén + één = twee"
    )
    assert (
        sentence_from_path("/parse/parse-sentence/Eén%20+%20één%20=%20twee")
        == "Eén + één = twee"
    )
    assert (
        sentence_from_path("/parse/parse-sentence/Eén+%2B+één+=+twee")
        == "Eén + één = twee"
    )
