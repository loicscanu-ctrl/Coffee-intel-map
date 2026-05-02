from scraper.sources.barchart import parse_barchart_price


def test_parse_barchart_price_extracts_value():
    # Simulated page HTML containing price
    html = '<span data-testid="last-price">220.50</span>'
    result = parse_barchart_price(html, "KCA", "ICE NY Arabica")
    assert result["title"].startswith("ICE NY Arabica –")
    assert "220.50" in result["body"]
    assert result["source"] == "Barchart"
    assert result["category"] == "general"
    assert "futures" in result["tags"]

def test_parse_barchart_price_returns_none_on_missing():
    html = '<div>no price here</div>'
    result = parse_barchart_price(html, "KCA", "ICE NY Arabica")
    assert result is None
