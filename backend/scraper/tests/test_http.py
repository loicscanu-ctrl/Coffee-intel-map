"""Contract tests for scraper.utils.http.get_with_backoff.

Covers: success short-circuit, 5xx retry, 429 Retry-After honoring, exhaustion
raises the underlying HTTPError, and the no-retry-on-4xx rule (404 must not
burn attempts).
"""
import os
import sys
from unittest.mock import MagicMock, patch

import pytest
import requests

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../.."))

from scraper.utils.http import _parse_retry_after, get_with_backoff


def _resp(status: int, headers: dict | None = None) -> MagicMock:
    """Build a stub Response. raise_for_status raises on 4xx/5xx."""
    r = MagicMock(spec=requests.Response)
    r.status_code = status
    r.headers = headers or {}
    if status >= 400:
        r.raise_for_status.side_effect = requests.exceptions.HTTPError(f"{status} Error")
    else:
        r.raise_for_status.return_value = None
    return r


def test_parse_retry_after_seconds():
    assert _parse_retry_after("30") == 30.0
    assert _parse_retry_after("0") == 0.0
    assert _parse_retry_after("") == 0.0
    assert _parse_retry_after("not-a-number") == 0.0


def test_parse_retry_after_negative_clamps_to_zero():
    assert _parse_retry_after("-5") == 0.0


def test_success_returns_immediately_with_no_sleep():
    with patch("scraper.utils.http.requests.get", return_value=_resp(200)) as mock_get, \
         patch("scraper.utils.http.time.sleep") as mock_sleep:
        r = get_with_backoff("http://x")
        assert r.status_code == 200
        assert mock_get.call_count == 1
        assert mock_sleep.call_count == 0


def test_retries_on_500_then_succeeds():
    with patch("scraper.utils.http.requests.get",
               side_effect=[_resp(500), _resp(200)]) as mock_get, \
         patch("scraper.utils.http.time.sleep") as mock_sleep:
        r = get_with_backoff("http://x", retries=3, backoff_factor=2.0)
        assert r.status_code == 200
        assert mock_get.call_count == 2
        assert mock_sleep.call_count == 1
        # First retry sleeps backoff_factor ** 0 == 1 second.
        mock_sleep.assert_called_with(1.0)


def test_honors_retry_after_on_429():
    with patch("scraper.utils.http.requests.get",
               side_effect=[_resp(429, {"Retry-After": "5"}), _resp(200)]), \
         patch("scraper.utils.http.time.sleep") as mock_sleep:
        r = get_with_backoff("http://x")
        assert r.status_code == 200
        mock_sleep.assert_called_once_with(5.0)


def test_429_without_retry_after_falls_back_to_backoff():
    with patch("scraper.utils.http.requests.get",
               side_effect=[_resp(429, {}), _resp(200)]), \
         patch("scraper.utils.http.time.sleep") as mock_sleep:
        get_with_backoff("http://x", retries=3, backoff_factor=2.0)
        # Falls back to backoff_factor ** 0 = 1.0
        mock_sleep.assert_called_once_with(1.0)


def test_raises_after_exhaustion():
    with patch("scraper.utils.http.requests.get", return_value=_resp(503)), \
         patch("scraper.utils.http.time.sleep"):
        with pytest.raises(requests.exceptions.HTTPError):
            get_with_backoff("http://x", retries=2)


def test_no_retry_on_4xx_other_than_429():
    with patch("scraper.utils.http.requests.get", return_value=_resp(404)) as mock_get, \
         patch("scraper.utils.http.time.sleep") as mock_sleep:
        with pytest.raises(requests.exceptions.HTTPError):
            get_with_backoff("http://x", retries=3)
        # No retry, no sleep — 404s shouldn't burn attempts.
        assert mock_get.call_count == 1
        assert mock_sleep.call_count == 0


def test_connection_error_retries():
    with patch("scraper.utils.http.requests.get",
               side_effect=[requests.ConnectionError("boom"), _resp(200)]) as mock_get, \
         patch("scraper.utils.http.time.sleep"):
        r = get_with_backoff("http://x", retries=3)
        assert r.status_code == 200
        assert mock_get.call_count == 2
