from scraper.sources.b3 import parse_b3

def test_parse_b3_extracts_price():
    html = '<td class="quotation__last-value">R$ 1.350,00</td>'
    result = parse_b3(html)
    assert result is not None
    assert result["source"] == "B3"
    assert "brazil" in result["tags"]
    assert "futures" in result["tags"]

def test_parse_b3_returns_none_when_missing():
    html = "<html><body>sem dados</body></html>"
    result = parse_b3(html)
    assert result is None
