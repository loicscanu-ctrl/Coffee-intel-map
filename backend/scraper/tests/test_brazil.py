from scraper.sources.brazil import parse_cecafe, parse_cooabriel, parse_noticiasagricolas


def test_parse_cooabriel_extracts_price():
    html = '<td class="valor">R$ 1.250,00</td>'
    result = parse_cooabriel(html)
    assert result is not None
    assert result["source"] == "Cooabriel"
    assert "conilon" in result["tags"]
    assert "brazil" in result["tags"]

def test_parse_cooabriel_returns_none_when_missing():
    html = "<html><body>sem dados</body></html>"
    result = parse_cooabriel(html)
    assert result is None

def test_parse_noticiasagricolas_extracts_price():
    html = '<span class="cotacao-valor">650,00</span>'
    result = parse_noticiasagricolas(html)
    assert result is not None
    assert result["source"] == "Noticiasagricolas"
    assert "arabica" in result["tags"]

def test_parse_cecafe_extracts_data():
    html = '<table><tr><th>Month</th></tr><tr><td>Jan 2026</td><td>500,000</td></tr></table>'
    result = parse_cecafe(html)
    assert result is not None
    assert result["source"] == "Cecafe"
    assert "exports" in result["tags"]
