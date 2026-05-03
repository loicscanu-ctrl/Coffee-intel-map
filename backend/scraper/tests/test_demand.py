from scraper.sources.demand import parse_ajca, parse_bls_cpi, parse_ecf
from scraper.sources.technicals import parse_cftc_cot, parse_searates, parse_worldbank_fertilizer


def test_parse_bls_cpi_extracts_value():
    html = '<td class="datavalue">309.685</td>'
    result = parse_bls_cpi(html)
    assert result is not None
    assert result["source"] == "BLS"
    assert "cpi" in result["tags"]
    assert "usa" in result["tags"]

def test_parse_worldbank_fertilizer_extracts_value():
    html = '<td class="odd views-field">156.3</td>'
    result = parse_worldbank_fertilizer(html)
    assert result is not None
    assert result["source"] == "World Bank"
    assert "fertilizer" in result["tags"]

def test_parse_ecf_extracts_data():
    html = '<div class="stat-figure">3.2M bags</div>'
    result = parse_ecf(html)
    assert result is not None
    assert result["source"] == "ECF"
    assert "eu" in result["tags"]

def test_parse_ajca_extracts_data():
    html = '<table><tr><th>Month</th></tr><tr><td>Jan</td><td>250,000</td></tr></table>'
    result = parse_ajca(html)
    assert result is not None
    assert result["source"] == "AJCA"
    assert "japan" in result["tags"]

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
