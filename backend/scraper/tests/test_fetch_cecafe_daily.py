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


# ── Error class hierarchy ────────────────────────────────────────────────────

def test_cecafe_unreachable_is_runtime_error_subclass():
    """Caller can catch it as RuntimeError if they don't want to import
    the specific class — useful for the workflow's bash retry loop where
    the exit code is what matters."""
    assert issubclass(fcd.CecafeUnreachable, RuntimeError)
