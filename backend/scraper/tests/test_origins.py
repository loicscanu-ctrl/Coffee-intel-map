from scraper.sources.origins import parse_alfabean


def test_parse_alfabean_extracts_price():
    html = '<td class="price-idr">45.000</td>'
    result = parse_alfabean(html)
    assert result is not None
    assert result["source"] == "Alfabean"
    assert "indonesia" in result["tags"]
