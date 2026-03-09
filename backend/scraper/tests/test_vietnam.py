from scraper.sources.vietnam import parse_giacaphe, parse_tintaynguyen, parse_vicofa

def test_parse_giacaphe_extracts_price():
    html = '<td class="price">43.500</td>'
    result = parse_giacaphe(html)
    assert result is not None
    assert result["source"] == "Giacaphe"
    assert "vietnam" in result["tags"]

def test_parse_giacaphe_returns_none_when_missing():
    html = "<html><body>no data</body></html>"
    result = parse_giacaphe(html)
    assert result is None

def test_parse_tintaynguyen_extracts_headline():
    html = '<h2 class="entry-title"><a href="#">Giá cà phê hôm nay tăng</a></h2>'
    result = parse_tintaynguyen(html)
    assert result is not None
    assert result["source"] == "Tintaynguyen"
    assert "vietnam" in result["tags"]

def test_parse_vicofa_extracts_headline():
    html = '<h1>Tin tức cà phê Việt Nam</h1>'
    result = parse_vicofa(html)
    assert result is not None
    assert result["source"] == "Vicofa"
