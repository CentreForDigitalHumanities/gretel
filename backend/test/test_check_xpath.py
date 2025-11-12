from search.basex_search import check_xpath


def test_check_xpath():
    assert not check_xpath(
        'SELECT * FROM query;'
    )
    assert not check_xpath(
        '//node[@cat="inf"'
    )
    assert not check_xpath(
        '//node[@cat="inf" and]'
    )
    assert check_xpath(
        '//node[@cat="inf" and not(@rel="vc" and ../node[@pt="ww" and @rel="hd"]/@lemma="zullen") and not(@rel="cnj" and ../node[node[@rel="vc"]] and ../../node[@pt="ww" and @rel="hd"]/@lemma="zullen")  and ((@rel="cnj" and ../../node[@pt="ww" and @rel="hd"] and not(../../@cat="smain" or ../../@cat="sv1")) or (../node[@pt="ww" and @rel="hd"] and not(../@cat="smain" or ../@cat="sv1"))) and node[@rel="svp" and @pt="vz"]  and node[@rel="hd" and @pt="ww" and number(@begin) > ../node[@rel="svp" and @pt="vz"]/number(@end) and not(@begin = ancestor::node/node[@lemma="te"]/@end)] and node[@rel="hd" and @pt="ww"]]'
    )
    assert check_xpath(
        '//node[not(@cat="smain" or @cat="sv1") and not(@cat="inf" and @rel="vc" and ../node[@pt="ww" and @rel="hd"]/@lemma="zullen") and not(@cat="inf" and @rel="cnj" and ../node[node[@rel="vc"]] and ../../node[@pt="ww" and @rel="hd"]/@lemma="zullen")  and not(@cat="ppart" and @rel="vc") and not(@cat="ppart" and @rel="cnj" and ../node[node[@rel="vc"]])  and node[@rel="hd" and @pt="ww"] and node[@cat="pp" and number(@begin) < ../node[@pt="ww" and @rel="hd"]/number(@begin) and node[@rel="hd"]] and not(node[@cat="pp" and number(@end) > ../node[@pt="ww" and @rel="hd"]/number(@end)])]'
    )
