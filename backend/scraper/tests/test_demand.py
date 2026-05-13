from scraper.sources.technicals import parse_cftc_cot, parse_searates, parse_worldbank_fertilizer


def test_parse_worldbank_fertilizer_extracts_value():
    html = '<td class="odd views-field">156.3</td>'
    result = parse_worldbank_fertilizer(html)
    assert result is not None
    assert result["source"] == "World Bank"
    assert "fertilizer" in result["tags"]


def test_parse_cftc_cot_extracts_data():
    html = '<a href="#" class="cot-link">Coffee Report 2026</a>'
    result = parse_cftc_cot(html)
    assert result is not None
    assert result["source"] == "CFTC"
    assert "cot" in result["tags"]


def test_parse_searates_extracts_data():
    html = '<div class="rate-index">Baltic Index: 1250</div>'
    result = parse_searates(html)
    assert result is not None
    assert result["source"] == "Searates"
    assert "freight" in result["tags"]
