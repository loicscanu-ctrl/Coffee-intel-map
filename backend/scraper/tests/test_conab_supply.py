"""
Tests for conab_supply.py — pure parsing helpers only (no HTTP calls).
"""
import io
import os
import sys

# Make sure we can import the module under test
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sources.conab_supply import (
    _brl_to_float,
    _parse_conab_custos_excel,
    _parse_conab_safra_html,
)

# ---------------------------------------------------------------------------
# _brl_to_float
# ---------------------------------------------------------------------------

def test_brl_to_float_standard():
    assert _brl_to_float("2.240,5") == 2240.5


def test_brl_to_float_simple():
    assert _brl_to_float("32,1") == 32.1


def test_brl_to_float_empty_returns_none():
    assert _brl_to_float("") is None


def test_brl_to_float_whitespace_returns_none():
    assert _brl_to_float("   ") is None


def test_brl_to_float_integer_format():
    # "1.234" with dot as thousands separator, no decimal
    assert _brl_to_float("1.234") == 1234.0


def test_brl_to_float_plain_integer():
    assert _brl_to_float("100") == 100.0


# ---------------------------------------------------------------------------
# _parse_conab_safra_html
# ---------------------------------------------------------------------------

def test_parse_conab_safra_html_extracts_brazil_row():
    html = """
    <table>
      <tr><th>Produto/UF</th><th>Área Colhida (mil ha)</th><th>Produtividade (sc/ha)</th></tr>
      <tr><td>Brasil</td><td>2.240,5</td><td>32,1</td></tr>
    </table>
    """
    result = _parse_conab_safra_html(html)
    assert result is not None
    assert result["harvested_area_kha"] == 2240.5
    assert result["yield_bags_ha"] == 32.1


def test_parse_conab_safra_html_case_insensitive():
    html = """
    <table>
      <tr><td>BRASIL</td><td>1.500,0</td><td>28,5</td></tr>
    </table>
    """
    result = _parse_conab_safra_html(html)
    assert result is not None
    assert result["harvested_area_kha"] == 1500.0
    assert result["yield_bags_ha"] == 28.5


def test_parse_conab_safra_html_returns_none_on_no_data():
    html = "<html><body>sem dados</body></html>"
    assert _parse_conab_safra_html(html) is None


def test_parse_conab_safra_html_returns_none_on_empty():
    assert _parse_conab_safra_html("") is None


# ---------------------------------------------------------------------------
# _parse_conab_custos_excel
# ---------------------------------------------------------------------------

def _build_minimal_workbook() -> bytes:
    """Build a minimal in-memory .xlsx with a 'Sul de Minas' sheet."""
    import openpyxl
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Sul de Minas"

    # Header row
    ws.append(["Discriminação", "Custo (R$/sc)"])

    # A component row: Insumos
    ws.append(["Insumos", 120.50])

    # A component row: Mão-de-obra
    ws.append(["Mão-de-obra", 85.30])

    # An input detail row: Nitrogênio
    ws.append(["Nitrogênio (ureia)", 45.00])

    # Total row
    ws.append(["Custo Total", 300.00])

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def test_parse_conab_custos_excel_returns_dict():
    content = _build_minimal_workbook()
    result = _parse_conab_custos_excel(content, brl_usd=5.0)
    assert result is not None
    assert isinstance(result, dict)


def test_parse_conab_custos_excel_total_brl():
    content = _build_minimal_workbook()
    result = _parse_conab_custos_excel(content, brl_usd=5.0)
    assert result["total_brl_per_bag"] == 300.0


def test_parse_conab_custos_excel_components_populated():
    content = _build_minimal_workbook()
    result = _parse_conab_custos_excel(content, brl_usd=5.0)
    # Should find at least Inputs and Labor
    labels = [c["label"] for c in result["components_brl"]]
    assert "Inputs" in labels
    assert "Labor" in labels


def test_parse_conab_custos_excel_inputs_detail():
    content = _build_minimal_workbook()
    result = _parse_conab_custos_excel(content, brl_usd=5.0)
    # Should find Nitrogen row
    detail_labels = [d["label"] for d in result["inputs_detail_brl"]]
    assert "Nitrogen (urea / AN)" in detail_labels


def test_parse_conab_custos_excel_has_required_keys():
    content = _build_minimal_workbook()
    result = _parse_conab_custos_excel(content, brl_usd=5.0)
    for key in ("season", "total_brl_per_bag", "prev_total_brl_per_bag",
                "brl_usd", "components_brl", "inputs_detail_brl", "source_label"):
        assert key in result, f"Missing key: {key}"


def test_parse_conab_custos_excel_brl_usd_stored():
    content = _build_minimal_workbook()
    result = _parse_conab_custos_excel(content, brl_usd=4.75)
    assert result["brl_usd"] == 4.75


def test_parse_conab_custos_excel_component_has_color():
    content = _build_minimal_workbook()
    result = _parse_conab_custos_excel(content, brl_usd=5.0)
    for comp in result["components_brl"]:
        assert "color" in comp
        assert comp["color"].startswith("#")


def test_parse_conab_custos_excel_falls_back_to_active_sheet():
    """If 'Sul de Minas' sheet is absent, fall back to wb.active."""
    import openpyxl
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Geral"
    ws.append(["Insumos", 100.0])
    ws.append(["Custo Total", 100.0])

    buf = io.BytesIO()
    wb.save(buf)
    content = buf.getvalue()

    result = _parse_conab_custos_excel(content, brl_usd=5.0)
    assert result is not None
    assert result["total_brl_per_bag"] == 100.0
