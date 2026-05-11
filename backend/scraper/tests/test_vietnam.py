from scraper.sources.vietnam import parse_giacaphe_price


def test_parse_giacaphe_price_extracts_from_table():
    # 115,200 VND — within 50k-250k range
    html = "<table><tr><td>115.200</td></tr></table>"
    result = parse_giacaphe_price(html)
    assert result is not None
    assert result["source"] == "Giacaphe"
    assert "vietnam" in result["tags"]


def test_parse_giacaphe_price_returns_none_when_missing():
    html = "<html><body>sem dados</body></html>"
    result = parse_giacaphe_price(html)
    assert result is None


def test_parse_giacaphe_price_rejects_out_of_range():
    # 43,500 VND — below the 50k floor, should not parse
    html = "<table><tr><td>43.500</td></tr></table>"
    result = parse_giacaphe_price(html)
    assert result is None
