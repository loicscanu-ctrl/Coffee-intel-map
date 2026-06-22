# backend/scraper/cot_calendar.py
"""US federal-holiday calendar + CFTC COT release-date logic.

The CFTC publishes the disaggregated Commitments of Traders report every Friday
at 15:30 ET for the prior Tuesday's positions. When a US federal holiday falls
in the production window (Wed–Fri of the report week), the release slips one
business day per holiday — e.g. Juneteenth on a Friday pushes that week's report
to the following Monday. ICE Europe (Robusta) is NOT affected by US holidays, so
on those weeks Robusta lands on time while Arabica (CFTC) is late, which shows up
as a COT week with LDN populated but NY null.

The COT scraper used to run on a Friday-only cron, so a holiday-delayed release
was missed until the next Friday. This module lets the workflow attempt the pull
on the *actual* release day — normal Friday or the holiday-shifted business day —
so the delayed release is picked up automatically. Pulling is idempotent (the
scraper's staleness guard no-ops when there's no new data), so the only thing we
need to get right is "is a release expected today?".

Stdlib-only on purpose: the workflow runs this as a fast gate before installing
the heavy scraper dependencies.
"""
from __future__ import annotations

import os
import sys
from datetime import date, timedelta

MONDAY, TUESDAY, FRIDAY, SATURDAY, SUNDAY = 0, 1, 4, 5, 6


def _nth_weekday(year: int, month: int, weekday: int, n: int) -> date:
    """The n-th (1-based) `weekday` of `month` — e.g. 3rd Monday of January."""
    first = date(year, month, 1)
    offset = (weekday - first.weekday()) % 7
    return first + timedelta(days=offset + 7 * (n - 1))


def _last_weekday(year: int, month: int, weekday: int) -> date:
    """The last `weekday` of `month` — e.g. last Monday of May."""
    last = (date(year, 12, 31) if month == 12
            else date(year, month + 1, 1) - timedelta(days=1))
    offset = (last.weekday() - weekday) % 7
    return last - timedelta(days=offset)


def _observed(d: date) -> date:
    """Federal observance shift: a holiday on Sat is observed Fri, on Sun Mon."""
    if d.weekday() == SATURDAY:
        return d - timedelta(days=1)
    if d.weekday() == SUNDAY:
        return d + timedelta(days=1)
    return d


def us_federal_holidays(year: int) -> dict[date, str]:
    """The 11 US federal holidays for `year`, keyed by their *observed* date.

    These are the days the CFTC is closed; a holiday in the report-production
    window delays the COT release. Juneteenth (2021+) is included for all years
    here — harmless for pre-2021 since the scraper only looks at recent weeks.
    """
    return {
        _observed(date(year, 1, 1)):    "New Year's Day",
        _nth_weekday(year, 1, MONDAY, 3):   "Martin Luther King Jr. Day",
        _nth_weekday(year, 2, MONDAY, 3):   "Presidents' Day",
        _last_weekday(year, 5, MONDAY):     "Memorial Day",
        _observed(date(year, 6, 19)):   "Juneteenth",
        _observed(date(year, 7, 4)):    "Independence Day",
        _nth_weekday(year, 9, MONDAY, 1):   "Labor Day",
        _nth_weekday(year, 10, MONDAY, 2):  "Columbus Day",
        _observed(date(year, 11, 11)):  "Veterans Day",
        _nth_weekday(year, 11, 3, 4):       "Thanksgiving Day",  # 4th Thursday
        _observed(date(year, 12, 25)):  "Christmas Day",
    }


def holiday_name(d: date) -> str | None:
    """Return the federal-holiday name for `d`, or None if it's a normal day."""
    return us_federal_holidays(d.year).get(d)


def is_business_day(d: date) -> bool:
    return d.weekday() < SATURDAY and holiday_name(d) is None


def add_business_days(start: date, n: int) -> date:
    """`start` advanced by `n` business days (skipping weekends + holidays)."""
    d = start
    while n > 0:
        d += timedelta(days=1)
        if is_business_day(d):
            n -= 1
    return d


def cot_release_date(report_tuesday: date) -> date:
    """Date the CFTC is expected to publish `report_tuesday`'s COT report.

    Normally the Friday of that week — i.e. 3 business days after the Tuesday.
    `add_business_days` skips federal holidays, so a holiday in Wed–Fri shifts
    the release forward exactly as the CFTC does. Worked example (Juneteenth):
    report Tue 2026-06-16 → Wed 17, Thu 18, [Fri 19 = Juneteenth, skipped],
    Mon 22 → release 2026-06-22.
    """
    return add_business_days(report_tuesday, 3)


def _most_recent_tuesday(d: date) -> date:
    return d - timedelta(days=(d.weekday() - TUESDAY) % 7)


def recent_report_tuesdays(today: date, weeks: int = 3) -> list[date]:
    """The most recent report Tuesdays on/before `today`, newest first."""
    latest = _most_recent_tuesday(today)
    return [latest - timedelta(weeks=i) for i in range(weeks)]


def release_due_on(today: date) -> tuple[bool, date | None, str]:
    """Is `today` the expected CFTC COT release day for a recent report?

    Returns (due, report_tuesday, reason). True on the normal Friday release and
    on a holiday-shifted release day (e.g. the Monday after a Juneteenth Friday),
    so the workflow can run on whichever day the data actually lands.
    """
    for tue in recent_report_tuesdays(today):
        release = cot_release_date(tue)
        if release == today:
            normal_friday = tue + timedelta(days=3)
            if release != normal_friday:
                blockers = ", ".join(
                    f"{name} ({d})"
                    for d in (tue + timedelta(days=i) for i in (1, 2, 3))
                    if (name := holiday_name(d))
                )
                reason = (f"holiday-delayed CFTC release for Tue {tue}: normal "
                          f"Friday {normal_friday} shifted to {release}"
                          + (f" by {blockers}" if blockers else ""))
            else:
                reason = f"normal Friday CFTC release for Tue {tue}"
            return True, tue, reason
    return False, None, f"no CFTC COT release expected on {today}"


def main(argv: list[str] | None = None) -> int:
    """Workflow gate. Prints status and writes `due`/`report_tuesday` to
    GITHUB_OUTPUT so the COT scraper steps can run only on a real release day.
    Optional argv[0] = YYYY-MM-DD overrides "today" (for testing). Always exits
    0 — the gate is expressed via the `due` output, not the exit code."""
    argv = sys.argv[1:] if argv is None else argv
    today = date.fromisoformat(argv[0]) if argv else date.today()

    due, tue, reason = release_due_on(today)
    print(f"[cot_calendar] {today}: due={due} — {reason}", file=sys.stderr)

    gh_out = os.environ.get("GITHUB_OUTPUT")
    if gh_out:
        with open(gh_out, "a", encoding="utf-8") as f:
            f.write(f"due={'true' if due else 'false'}\n")
            if tue is not None:
                f.write(f"report_tuesday={tue.isoformat()}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
