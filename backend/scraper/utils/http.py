"""Shared HTTP helper with exponential backoff and 429 Retry-After handling.

Wraps requests.get with:
  - explicit (connect, read) timeout default
  - exponential backoff on 5xx / connection errors
  - honors Retry-After header on 429 (seconds or HTTP-date)
  - retries up to N attempts then raises the underlying error

Use this for any scraper that hits a rate-limited or transient-fault-prone
API. The workflow-level retry pattern (5-minute fixed sleep wrapping the
whole job) is still the outer guard — this hook adds finer-grained,
per-request resilience that honors what the server is actually telling us.
"""
import logging
import time
from datetime import datetime
from email.utils import parsedate_to_datetime
from typing import Any

import requests

logger = logging.getLogger(__name__)

# (connect, read) seconds. Most public scraper sources publish small payloads
# and a 60s read cap is generous enough for monthly Excel reports while keeping
# a stuck job from hanging the whole runner indefinitely.
DEFAULT_TIMEOUT = (10, 60)


def _parse_retry_after(value: str) -> float:
    """Parse a Retry-After header. Accepts seconds (number) or HTTP-date.

    Returns 0.0 on parse failure so callers can fall back to exponential
    backoff. Negative deltas (date already past) clamp to 0.
    """
    value = value.strip()
    if not value:
        return 0.0
    try:
        return max(0.0, float(value))
    except ValueError:
        pass
    try:
        dt = parsedate_to_datetime(value)
        if dt is None:
            return 0.0
        now = datetime.now(dt.tzinfo)
        return max(0.0, (dt - now).total_seconds())
    except (TypeError, ValueError):
        return 0.0


def get_with_backoff(
    url: str,
    *,
    retries: int = 3,
    timeout: tuple[float, float] = DEFAULT_TIMEOUT,
    backoff_factor: float = 2.0,
    max_backoff: float = 60.0,
    **kwargs: Any,
) -> requests.Response:
    """GET ``url`` with retries + backoff. Returns Response or raises last error.

    - On 2xx / 3xx: returns the response immediately.
    - On 429: honors Retry-After (seconds or HTTP-date). Falls back to
      exponential backoff if the header is missing or unparseable.
    - On 5xx: exponential backoff of ``backoff_factor ** attempt`` seconds,
      capped at ``max_backoff``.
    - On 4xx other than 429: raises ``HTTPError`` immediately — these don't
      get better with retry and burning attempts hides the real bug.
    - On ConnectionError / Timeout: retries with the same backoff schedule.

    Extra ``**kwargs`` are forwarded to ``requests.get`` (headers, params,
    stream, verify, etc.).
    """
    last_exc: Exception | None = None
    for attempt in range(retries):
        try:
            resp = requests.get(url, timeout=timeout, **kwargs)
        except (requests.ConnectionError, requests.Timeout) as e:
            last_exc = e
            if attempt == retries - 1:
                raise
            sleep = min(backoff_factor ** attempt, max_backoff)
            logger.warning(
                "[http] %s on %s — attempt %d/%d, sleeping %.1fs",
                type(e).__name__, url, attempt + 1, retries, sleep,
            )
            time.sleep(sleep)
            continue

        if resp.status_code < 400:
            return resp

        if resp.status_code == 429:
            ra = _parse_retry_after(resp.headers.get("Retry-After", ""))
            sleep = ra if ra > 0 else min(backoff_factor ** attempt, max_backoff)
            if attempt == retries - 1:
                resp.raise_for_status()
            logger.warning(
                "[http] 429 on %s — sleeping %.1fs (Retry-After hint), attempt %d/%d",
                url, sleep, attempt + 1, retries,
            )
            time.sleep(sleep)
            continue

        if 500 <= resp.status_code < 600:
            if attempt == retries - 1:
                resp.raise_for_status()
            sleep = min(backoff_factor ** attempt, max_backoff)
            logger.warning(
                "[http] %d on %s — attempt %d/%d, sleeping %.1fs",
                resp.status_code, url, attempt + 1, retries, sleep,
            )
            time.sleep(sleep)
            continue

        # 4xx other than 429 — raise immediately. No retry will fix a 404.
        resp.raise_for_status()

    # Unreachable in practice — the loop either returns or raises — but keeps
    # the type checker happy and gives a sensible error if the contract drifts.
    if last_exc:
        raise last_exc
    raise RuntimeError(f"get_with_backoff exhausted {retries} retries for {url}")
