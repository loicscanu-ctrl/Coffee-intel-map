from scraper.sources.origins import parse_alfabean, parse_colombia, parse_ihcafe, parse_uganda


def test_parse_alfabean_extracts_price():
    html = '<td class="price-idr">45.000</td>'
    result = parse_alfabean(html)
    assert result is not None
    assert result["source"] == "Alfabean"
    assert "indonesia" in result["tags"]

def test_parse_ihcafe_extracts_price():
    html = '<td>L. 1.250,00</td>'
    result = parse_ihcafe(html)
    assert result is not None
    assert result["source"] == "IHCafe"
    assert "honduras" in result["tags"]

def test_parse_uganda_extracts_data():
    html = '<p class="export-volume">Uganda exported 500,000 bags</p>'
    result = parse_uganda(html)
    assert result is not None
    assert result["source"] == "Uganda Coffee Board"
    assert "uganda" in result["tags"]

def test_parse_colombia_extracts_data():
    html = '<div class="estadisticas">Producción: 1.2M sacos</div>'
    result = parse_colombia(html)
    assert result is not None
    assert result["source"] == "Federación de Cafeteros"
    assert "colombia" in result["tags"]
