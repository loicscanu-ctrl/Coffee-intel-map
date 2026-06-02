"""Tests for fetch_cecafe_daily — focuses on the new connect-timeout
handling that distinguishes transient TCP failures (CecafeUnreachable)
from parser bugs.

Live HTTP intentionally not exercised — Cecafe.com.br is unreachable from
sandbox + the failure mode the test guards against IS the unreachability,
which has to be simulated via mocked requests.
"""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
import requests

from scraper import fetch_cecafe_daily as fcd

# ── _fetch_page: success path ────────────────────────────────────────────────

def test_fetch_page_returns_text_on_200():
    fake = MagicMock(status_code=200, text="<html>...resumo-diario...</html>")
    fake.raise_for_status.return_value = None
    with patch.object(fcd.requests, "get", return_value=fake) as mock_get:
        html = fcd._fetch_page()
        assert "resumo-diario" in html
        # Verify our browser-shaped headers + (connect, read) timeout went out.
        _, kwargs = mock_get.call_args
        assert kwargs["timeout"] == (15, 45)
        assert kwargs["headers"]["User-Agent"].startswith("Mozilla/5.0")
        assert kwargs["headers"]["Accept-Language"] == "pt-BR,pt;q=0.9"


# ── _fetch_page: transient failures → CecafeUnreachable ──────────────────────

def test_fetch_page_timeout_raises_unreachable():
    """The 2026-05-30 outage signature: requests.Timeout from sock.connect.
    Must surface as CecafeUnreachable so main() exits with a clear log."""
    with patch.object(fcd.requests, "get", side_effect=requests.Timeout("connect timed out")):
        with pytest.raises(fcd.CecafeUnreachable) as exc_info:
            fcd._fetch_page()
        assert "TCP-level failure" in str(exc_info.value)
        assert "cecafe.com.br" in str(exc_info.value)


def test_fetch_page_connection_error_raises_unreachable():
    """DNS failure / connection refused / connection reset — all roll up to
    requests.ConnectionError. Same treatment as Timeout."""
    with patch.object(fcd.requests, "get", side_effect=requests.ConnectionError("Name or service not known")):
        with pytest.raises(fcd.CecafeUnreachable):
            fcd._fetch_page()


def test_fetch_page_http_error_propagates_naturally():
    """5xx server errors are NOT transient unreachability — they mean
    Cecafe is up but returning an error page. Let it propagate so the
    caller sees the distinct failure mode (it'll exit non-zero with a
    traceback, which is appropriate; a sustained 5xx warrants attention)."""
    fake = MagicMock(status_code=503)
    fake.raise_for_status.side_effect = requests.HTTPError("503 Server Error")
    with patch.object(fcd.requests, "get", return_value=fake):
        with pytest.raises(requests.HTTPError):
            fcd._fetch_page()


# ── _parse_page: anchor priority (Embarques > Certificados) ──────────────────

def _build_two_table_html(emb_totais: str, cert_totais: str, ref_date: str = "01/06/2026") -> str:
    """Synthetic Cecafé page with BOTH tables present. Order matches the live
    page (Certificados first, then Embarques later in the document)."""
    return f"""
    <html><body>
        <p>Informações recebidas até: {ref_date}</p>
        <h2>Emissão de Certificados de Origem</h2>
        <table><tr><td>TOTAIS</td>{cert_totais}</tr></table>
        <h2>Unidades de Embarques Marítimos e Rodoviários</h2>
        <table><tr><td>TOTAIS</td>{emb_totais}</tr></table>
    </body></html>
    """


def _td_row(*values) -> str:
    return "".join(f"<td>{v}</td>" for v in values)


def test_parse_extracts_both_sources():
    """User spec: fetch BOTH Embarques (physical loadings) and Certificados
    (paperwork). Distinct numbers per table so misrouting would show up."""
    cert = _td_row(0, 28024, 0, 28024, 0, 28024, 0, 28024, 99999, 99999, 99999, 99999)
    emb  = _td_row(0, 2520,  0, 2520,  0, 2520,  0, 2520,  34254, 26973, 0,     61227)
    html = _build_two_table_html(emb_totais=emb, cert_totais=cert)

    parsed = fcd._parse_page(html)

    assert parsed["sources"]["embarques"]["conillon"]      == 2520
    assert parsed["sources"]["embarques"]["prev_arabica"]  == 34254
    assert parsed["sources"]["certificados"]["conillon"]   == 28024
    assert parsed["sources"]["certificados"]["prev_arabica"] == 99999


def test_parse_handles_missing_embarques_source():
    """If Embarques header is absent (Cecafé page-tree drift), Certificados
    still parses and the run keeps going. sources['embarques'] becomes None."""
    cert = _td_row(0, 28024, 0, 28024, 0, 28024, 0, 28024, 99999, 99999, 99999, 99999)
    html = f"""
    <html><body>
        <p>Informações recebidas até: 01/06/2026</p>
        <h2>Emissão de Certificados de Origem</h2>
        <table><tr><td>TOTAIS</td>{cert}</tr></table>
    </body></html>
    """
    parsed = fcd._parse_page(html)
    assert parsed["sources"]["embarques"] is None
    assert parsed["sources"]["certificados"]["conillon"] == 28024


def test_parse_reference_date_correct():
    """Date after 'Informações recebidas até:' becomes ref_date."""
    emb = _td_row(*([0] * 12))
    html = _build_two_table_html(emb_totais=emb, cert_totais=emb, ref_date="15/05/2026")
    parsed = fcd._parse_page(html)
    assert parsed["ref_date"].isoformat() == "2026-05-15"


def test_parse_column_order_matches_user_spec():
    """Column order per source:
        1-4   Movimento do dia: arabica, conillon, soluvel, total
        5-8   Acumulado:        arabica, conillon, soluvel, total
        9-12  Mês Anterior:     arabica, conillon, soluvel, total"""
    emb = _td_row(
        100, 200, 300, 600,
        1000, 2000, 3000, 6000,
        10000, 20000, 30000, 60000,
    )
    cert = _td_row(*([99999] * 12))
    html = _build_two_table_html(emb_totais=emb, cert_totais=cert)
    parsed = fcd._parse_page(html)
    s = parsed["sources"]["embarques"]
    assert s["arabica"]       == 1000
    assert s["conillon"]      == 2000
    assert s["soluvel"]       == 3000
    assert s["prev_arabica"]  == 10000
    assert s["prev_conillon"] == 20000
    assert s["prev_soluvel"]  == 30000


def test_parse_raises_when_both_sources_missing():
    """Neither table present → page is unrecognizable, raise so the workflow's
    retry / alert path fires."""
    html = "<html><body><p>Informações recebidas até: 01/06/2026</p></body></html>"
    with pytest.raises(ValueError, match="Could not find TOTAIS row for ANY"):
        fcd._parse_page(html)


# ── Error class hierarchy ────────────────────────────────────────────────────

def test_cecafe_unreachable_is_runtime_error_subclass():
    """Caller can catch it as RuntimeError if they don't want to import
    the specific class — useful for the workflow's bash retry loop where
    the exit code is what matters."""
    assert issubclass(fcd.CecafeUnreachable, RuntimeError)
