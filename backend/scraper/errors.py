"""
Scraper-internal exception types.

The default contract in scraper/main.py is "any source can fail without
failing the whole run" — _run_one and _run_side_channel catch generic
Exception and continue. That's the right default for noisy sources where
intermittent failure is expected (one news source down, etc.).

CriticalSourceError opts a specific source out of that contract: when
this exception leaves a source's run() function, _run_one re-raises so
the daily scraper exits non-zero and the existing if: failure() Telegram
fires within an hour. Use sparingly — only for sources whose total
outage genuinely needs same-day attention. Normal "0 items today" should
remain a soft fail caught by the freshness-check workflow.
"""


class CriticalSourceError(Exception):
    """A scraper source failed in a way that should fail the entire run."""
