"""
spot_coffee.py — ATTE spot-coffee offer-list scraper.

Source: https://attespotcoffee.azurewebsites.net/  — a login-gated, single
HTML table of live spot green-coffee offers. Credentials come from the
SPOT_COFFEE_USER / SPOT_COFFEE_PASS environment variables (GitHub secrets in
CI). The host is NOT on the Claude sandbox allowlist, so this only ever runs
on a GitHub runner (same constraint as the AJCA / ICE scrapers).

The page is a single offer table whose columns are roughly:
  Bags/Tons · Unit · Origin · Quality · Quality cont. · Crop year ·
  Certification · Add. information · Port · Warehouse · Terms · Price

We capture the table *header-faithfully* (whatever the live <th> text is) and
emit frontend/public/data/spot_coffee.json:

  {
    "as_of":        "2026-06-05",
    "generated_at": "2026-06-05T11:30:00Z",
    "source_url":   "https://attespotcoffee.azurewebsites.net/",
    "headers":      ["Bags/Tons", "Unit", "Origin", ...],
    "rows":         [ {"Bags/Tons": "250", "Origin": "Colombia", ...}, ... ],
    "row_count":    N
  }

Run modes (see __main__):
  --probe : log in, dump login-form + table diagnostics to stdout, write
            nothing. Validates the credentials and reveals the real markup so
            the full parser can be finalised.
  --full  : log in, parse the table, write the JSON file.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urljoin

import requests

try:
    from bs4 import BeautifulSoup
except ImportError:  # pragma: no cover - bs4 is in requirements
    BeautifulSoup = None  # type: ignore

_BASE = "https://attespotcoffee.azurewebsites.net/"
_OUT = Path(__file__).resolve().parents[3] / "frontend" / "public" / "data" / "spot_coffee.json"

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

# Heuristic: which form-field name carries the username/login.
_USER_HINTS = ("user", "email", "login", "account", "uid", "username", "name")


def _creds() -> tuple[str, str]:
    user = os.environ.get("SPOT_COFFEE_USER", "")
    pwd = os.environ.get("SPOT_COFFEE_PASS", "")
    if not user or not pwd:
        print("[spot] ERROR: SPOT_COFFEE_USER / SPOT_COFFEE_PASS not set", file=sys.stderr)
    return user, pwd


def _looks_user(name: str) -> bool:
    n = (name or "").lower()
    return any(h in n for h in _USER_HINTS)


def _find_login_form(soup) -> object | None:
    """The login <form> is the one containing an input[type=password]."""
    for form in soup.find_all("form"):
        if form.find("input", attrs={"type": "password"}):
            return form
    return None


def _attempt_login(session: requests.Session, verbose: bool = False) -> requests.Response:
    """GET the base page; if it presents a password form, submit credentials.

    Carries over every existing input value (hidden anti-forgery tokens like
    __RequestVerificationToken / __VIEWSTATE, "remember me" defaults, etc.) so
    the POST mirrors a real browser submit. Returns the response of the page
    that follows the login (or the original GET if no form was present —
    e.g. the session is already authenticated).
    """
    user, pwd = _creds()
    r = session.get(_BASE, headers=_HEADERS, timeout=30, allow_redirects=True)
    if verbose:
        print(f"[spot] GET {_BASE} -> {r.status_code} (final {r.url})")
    if BeautifulSoup is None:
        raise RuntimeError("beautifulsoup4 not installed")

    soup = BeautifulSoup(r.text, "html.parser")
    form = _find_login_form(soup)
    if form is None:
        if verbose:
            print("[spot] no password form on landing page (already authed, or table is public)")
        return r

    action = urljoin(r.url, form.get("action") or r.url)
    method = (form.get("method") or "post").lower()

    data: dict[str, str] = {}
    user_field: str | None = None
    pass_field: str | None = None
    # Pass 1 — collect every named input; tag the password + username fields.
    for inp in form.find_all(("input", "select", "textarea")):
        name = inp.get("name")
        if not name:
            continue
        itype = (inp.get("type") or "text").lower()
        if itype == "password":
            pass_field = name
            data[name] = pwd
        elif itype in ("text", "email") and pass_field is None and _looks_user(name) and user_field is None:
            user_field = name
            data[name] = user
        else:
            data[name] = inp.get("value") or ""
    # Pass 2 — fallback if no field matched the username heuristics: take the
    # first plain text/email input.
    if user_field is None:
        for inp in form.find_all("input"):
            itype = (inp.get("type") or "text").lower()
            nm = inp.get("name")
            if itype in ("text", "email") and nm:
                user_field = nm
                data[nm] = user
                break

    if verbose:
        print(f"[spot] login form: action={action} method={method}")
        print(f"[spot] login fields: {sorted(data.keys())}")
        print(f"[spot] username field = {user_field!r}, password field = {pass_field!r}")

    submit_headers = {**_HEADERS, "Referer": r.url, "Origin": _BASE.rstrip("/")}
    if method == "get":
        resp = session.get(action, params=data, headers=submit_headers, timeout=30, allow_redirects=True)
    else:
        resp = session.post(action, data=data, headers=submit_headers, timeout=30, allow_redirects=True)
    if verbose:
        print(f"[spot] login POST -> {resp.status_code} (final {resp.url})")
        post_soup = BeautifulSoup(resp.text, "html.parser")
        still_login = post_soup.find("input", attrs={"type": "password"}) is not None
        print(f"[spot] password field still present after login: {still_login} "
              f"({'LOGIN LIKELY FAILED' if still_login else 'login looks OK'})")
        print(f"[spot] cookies: {sorted(session.cookies.keys())}")
    return resp


def _uniq_headers(raw: list[str]) -> list[str]:
    """Make header keys unique + non-empty so they can key row dicts."""
    out: list[str] = []
    seen: dict[str, int] = {}
    for i, h in enumerate(raw):
        key = (h or "").strip() or f"col{i + 1}"
        if key in seen:
            seen[key] += 1
            key = f"{key} ({seen[key]})"
        else:
            seen[key] = 1
        out.append(key)
    return out


def _cell_text(cell) -> str:
    return " ".join(cell.get_text(" ", strip=True).split())


def _find_main_table(soup):
    """Return the <table> with the most data rows (the offer list)."""
    best = None
    best_rows = -1
    for t in soup.find_all("table"):
        n = len(t.find_all("tr"))
        if n > best_rows:
            best, best_rows = t, n
    return best


def _parse_table(table) -> tuple[list[str], list[dict]]:
    """Extract (headers, rows) from the offer table, keyed by header text."""
    headers: list[str] = []
    thead = table.find("thead")
    if thead:
        hr = thead.find("tr")
        if hr:
            headers = [_cell_text(c) for c in hr.find_all(("th", "td"))]
    trs = table.find_all("tr")
    body_trs = trs
    if not headers and trs:
        # No <thead> — treat the first row as the header if it is all <th>.
        first = trs[0]
        if first.find_all("th") and not first.find_all("td"):
            headers = [_cell_text(c) for c in first.find_all("th")]
            body_trs = trs[1:]
    elif thead:
        body_trs = (table.find("tbody") or table).find_all("tr")

    headers = _uniq_headers(headers)
    rows: list[dict] = []
    for tr in body_trs:
        cells = tr.find_all(("td", "th"))
        if not cells:
            continue
        vals = [_cell_text(c) for c in cells]
        if headers and len(headers) >= len(vals):
            row = {headers[i]: vals[i] for i in range(len(vals))}
        elif headers:
            row = {headers[i]: vals[i] for i in range(len(headers))}
            row["_extra"] = " | ".join(vals[len(headers):])
        else:
            row = {f"col{i + 1}": v for i, v in enumerate(vals)}
        rows.append(row)
    return headers, rows


def probe() -> int:
    session = requests.Session()
    resp = _attempt_login(session, verbose=True)
    soup = BeautifulSoup(resp.text, "html.parser")

    tables = soup.find_all("table")
    print(f"[spot] tables on post-login page: {len(tables)}")
    if not tables:
        # Help discover the data page if it lives behind a link/redirect.
        links = []
        for a in soup.find_all("a", href=True)[:40]:
            links.append(f"{_cell_text(a)!r} -> {a['href']}")
        print("[spot] no <table> found. First links on page:")
        for ln in links:
            print(f"        {ln}")
        print("[spot] --- page <title> ---")
        title = soup.find("title")
        print(f"        {title.get_text(strip=True) if title else '(none)'}")
        return 0

    table = _find_main_table(soup)
    headers, rows = _parse_table(table)
    print(f"[spot] main table: {len(headers)} columns, {len(rows)} rows")
    print(f"[spot] table id={table.get('id')!r} class={table.get('class')!r}")
    print(f"[spot] headers: {headers}")
    print("[spot] first rows:")
    for r in rows[:3]:
        print(f"        {json.dumps(r, ensure_ascii=False)}")
    _pagination_report(soup)

    _origin_filter_experiment(session, soup)
    return 0


def _distinct_origins(rows: list[dict]) -> list[str]:
    return sorted({(r.get("Origin") or "").strip() for r in rows if (r.get("Origin") or "").strip()})


def _origin_filter_experiment(session, soup) -> None:
    """Crack how the Origin filter actually narrows the grid. Tries, for one
    mid-size origin, several activation strategies and reports the resulting
    row count + distinct origins so the working recipe is obvious."""
    print("[spot] === EXPERIMENT: origin filter mechanics ===")
    osoup = _postback(session, soup, _ORIGIN_ACTIVATE)
    if osoup is None:
        print("[spot] origin-activate returned nothing")
        return

    # The origin LinkButtons carry the origin NAME as their link text.
    origins: list[tuple[str, str]] = []  # (name, postback_target)
    for a in osoup.find_all("a"):
        aid = a.get("id") or ""
        href = a.get("href") or ""
        if "lb_Origin" in aid or "lb_Origin" in href:
            m = _PAGE_RE.search(href)
            origins.append((_cell_text(a), m.group(1) if m else ""))
    print(f"[spot] origin options ({len(origins)}): {[o[0] for o in origins][:40]}")
    if not origins:
        return

    # Pick a presumably-small origin to test narrowing (skip the first, often
    # the biggest / 'all').
    name, tgt = next((o for o in origins if o[0] and o[0].upper() not in ("", "ALL")), origins[0])
    print(f"[spot] testing origin = {name!r} target={tgt!r}")
    sel = "ctl00$ContentPlaceHolder1$txt_selected"
    sea = "ctl00$ContentPlaceHolder1$txt_search"
    apply_text = "ctl00$ContentPlaceHolder1$hb_origin_active_text"

    trials = [
        ("A: EVENTTARGET=lb_Origin only", tgt, None),
        ("B: lb_Origin + txt_selected", tgt, {sel: name}),
        ("C: hb_origin_active_text + txt_selected", apply_text, {sel: name}),
        ("D: hb_origin_active_text + txt_search", apply_text, {sea: name}),
        ("E: hb_origin_active_text + both", apply_text, {sel: name, sea: name}),
    ]
    for desc, target, extra in trials:
        if not target:
            continue
        res = _postback(session, osoup, target, extra=extra)
        if res is None:
            print(f"[spot] {desc}: (no response)")
            continue
        tbl = _find_main_table(res)
        rws = _parse_table(tbl)[1] if tbl is not None else []
        print(f"[spot] {desc}: rows={len(rws)} origins={_distinct_origins(rws)[:8]}")
    return


_PAGE_RE = re.compile(r"__doPostBack\(\s*'([^']*)'\s*,\s*'([^']*)'\s*\)")
_COUNT_RE = re.compile(
    r"(page\s+\d+\s+of\s+\d+|\b\d{2,6}\s+(?:records|items|results|offers|rows|entries)\b)",
    re.I,
)


def _pagination_report(soup) -> None:
    """Dump every clue about how the offer table paginates so the full
    fetcher can be made to walk all pages (ASP.NET GridView pager, page-size
    <select>, total-count text, __doPostBack targets)."""
    print("[spot] --- pagination report ---")

    # __doPostBack targets (GridView pager links call these).
    targets: list[tuple[str, str, str]] = []
    for a in soup.find_all("a", href=True):
        m = _PAGE_RE.search(a["href"])
        if m:
            targets.append((_cell_text(a) or "(no text)", m.group(1), m.group(2)))
    if targets:
        print(f"[spot] __doPostBack links: {len(targets)}")
        for txt, tgt, arg in targets[:25]:
            print(f"        {txt!r:>14} -> target={tgt!r} arg={arg!r}")
    else:
        print("[spot] no __doPostBack pager links found")

    # Any inline onclick / input buttons that postback (Next/Last buttons).
    for inp in soup.find_all("input"):
        oc = inp.get("onclick") or ""
        if "__doPostBack" in oc or "Page$" in oc:
            print(f"        input name={inp.get('name')!r} value={inp.get('value')!r} onclick={oc[:120]!r}")

    # Page-size / filter <select>s.
    for sel in soup.find_all("select"):
        opts = [(o.get("value"), _cell_text(o)) for o in sel.find_all("option")]
        print(f"[spot] <select> name={sel.get('name')!r} options={opts[:20]}")

    # Total-count / "Page X of Y" text anywhere on the page.
    page_text = soup.get_text(" ", strip=True)
    hits = {m.group(1) for m in _COUNT_RE.finditer(page_text)}
    print(f"[spot] count/paging text hits: {sorted(hits) if hits else '(none)'}")

    # Query-string knobs sometimes expose page size (?pageSize=, ?ps=).
    print(f"[spot] final URL: {soup.find('base')['href'] if soup.find('base') else _BASE}")

    # Every __doPostBack target anywhere in the raw HTML (origin/quality/port
    # filter links live here too, not only in visible <a> tags).
    pbs = sorted(set(_PAGE_RE.findall(str(soup))))
    print(f"[spot] ALL __doPostBack targets ({len(pbs)}):")
    for tgt, arg in pbs[:60]:
        print(f"        target={tgt!r} arg={arg!r}")

    # Filter controls = the form minus the big offers table. Dump named
    # inputs / selects / filter links + the surrounding text so the filter
    # mechanism (the only way past the 200-row cap) is fully visible.
    form = soup.find("form")
    if form is not None:
        fsoup = BeautifulSoup(str(form), "html.parser")
        for tbl in fsoup.find_all("table"):
            tbl.decompose()
        print("[spot] --- filter controls (form minus offers table) ---")
        for inp in fsoup.find_all("input"):
            ty = (inp.get("type") or "text").lower()
            if ty in ("hidden", "submit", "image"):
                continue
            print(f"        input type={ty} name={inp.get('name')!r} value={inp.get('value')!r}")
        for sel in fsoup.find_all("select"):
            opts = [(o.get("value"), _cell_text(o)) for o in sel.find_all("option")]
            print(f"        select name={sel.get('name')!r} options={opts[:30]}")
        for a in fsoup.find_all("a"):
            txt = _cell_text(a)
            if txt:
                print(f"        link {txt!r} href={(a.get('href') or '')[:90]!r}")
        ftext = fsoup.get_text(" ", strip=True)
        print(f"[spot] non-table form text ({len(ftext)} chars): {ftext[:1600]!r}")
    print("[spot] --- end pagination report ---")


# The offer list is split across LinkButton "type" tabs (Arabica / Robusta),
# each an ASP.NET __doPostBack target ending in "lb_Type". The default page
# only shows one type — the other must be fetched by posting back the tab.
_TYPE_TARGET = "lb_Type"


def _type_tabs(soup) -> list[tuple[str, str]]:
    """Return [(label, postback_target)] for every Arabica/Robusta-style tab."""
    out: list[tuple[str, str]] = []
    for a in soup.find_all("a", href=True):
        m = _PAGE_RE.search(a["href"])
        if m and _TYPE_TARGET in m.group(1):
            label = _cell_text(a) or m.group(1)
            if (label, m.group(1)) not in out:
                out.append((label, m.group(1)))
    return out


def _postback(session: requests.Session, soup, target: str, argument: str = "",
              extra: dict[str, str] | None = None) -> object | None:
    """Replay an ASP.NET __doPostBack(target, argument) from the given page.

    Re-submits the page's single server form with every current input value
    (carrying __VIEWSTATE / __EVENTVALIDATION etc.) plus the event target, so
    the server re-renders with the requested tab active. Returns the parsed
    response soup, or None on failure.
    """
    form = soup.find("form")
    if form is None:
        return None
    action = urljoin(_BASE, form.get("action") or _BASE)
    data: dict[str, str] = {}
    for inp in form.find_all("input"):
        name = inp.get("name")
        if not name:
            continue
        itype = (inp.get("type") or "text").lower()
        if itype in ("submit", "button", "image"):
            continue  # don't emulate a click on these
        if itype in ("checkbox", "radio") and not inp.has_attr("checked"):
            continue
        data[name] = inp.get("value") or ""
    for sel in form.find_all("select"):
        name = sel.get("name")
        if not name:
            continue
        opt = sel.find("option", selected=True) or sel.find("option")
        data[name] = (opt.get("value") if opt and opt.has_attr("value") else _cell_text(opt) if opt else "")
    data["__EVENTTARGET"] = target
    data["__EVENTARGUMENT"] = argument
    if extra:
        data.update(extra)
    try:
        r = session.post(action, data=data, headers={**_HEADERS, "Referer": _BASE}, timeout=30)
    except Exception as e:  # noqa: BLE001
        print(f"[spot] postback {target} failed: {e}", file=sys.stderr)
        return None
    return BeautifulSoup(r.text, "html.parser")


# The grid hard-caps at 200 rendered rows. The only way past it is to narrow
# with the per-column filters. Activating the Origin filter renders a repeater
# of one LinkButton per distinct origin (rep_Origin$ctlNN$lb_Origin); each
# origin's slice is well under the cap, so iterating origins recovers the full
# list per type.
_ORIGIN_ACTIVATE = "ctl00$ContentPlaceHolder1$hb_origin_active"
_ORIGIN_TARGET = "lb_Origin"
_GRID_CAP = 200


def _origin_filters(soup) -> list[str]:
    """Distinct origin-filter postback targets in the (origin-activated) page."""
    out: list[str] = []
    for tgt, _arg in set(_PAGE_RE.findall(str(soup))):
        if "rep_Origin" in tgt and _ORIGIN_TARGET in tgt:
            out.append(tgt)
    return sorted(out)  # ctl01..ctlNN are zero-padded → lexical sort = order


def _collect_type(session: requests.Session, tsoup, label: str) -> tuple[list[str], list[dict]]:
    """All offers for one type page, recovered by iterating the Origin filter.

    De-dupes by full-row identity so an origin click that silently fails to
    narrow (returning the capped grid again) can't inflate the result, and so
    the capped default grid can be merged in as a safety net for any origin the
    repeater might omit.
    """
    headers: list[str] = []
    seen: set[tuple] = set()
    rows_out: list[dict] = []

    def _absorb(rws: list[dict]) -> int:
        added = 0
        for r in rws:
            key = tuple(sorted(r.items()))
            if key not in seen:
                seen.add(key)
                rows_out.append(r)
                added += 1
        return added

    # Safety net: the default (capped) grid for this type.
    base = _find_main_table(tsoup)
    if base is not None:
        headers, rws = _parse_table(base)
        _absorb(rws)

    osoup = _postback(session, tsoup, _ORIGIN_ACTIVATE)
    origins = _origin_filters(osoup) if osoup is not None else []
    print(f"[spot] {label or 'default'}: {len(origins)} origin filters")
    if osoup is None or not origins:
        print(f"[spot] WARN: no origin filters for {label!r} — using capped grid only", file=sys.stderr)
        return headers, rows_out

    for i, otgt in enumerate(origins, 1):
        fsoup = _postback(session, osoup, otgt)
        if fsoup is None:
            continue
        tbl = _find_main_table(fsoup)
        if tbl is None:
            continue
        h, rws = _parse_table(tbl)
        if not headers:
            headers = h
        _absorb(rws)
        if len(rws) >= _GRID_CAP:
            print(f"[spot] WARN: {label} origin #{i} hit the {_GRID_CAP}-row cap "
                  f"— that origin may need a sub-filter", file=sys.stderr)
        time.sleep(0.25)  # be polite to the small Azure app
    return headers, rows_out


def full() -> int:
    session = requests.Session()
    resp = _attempt_login(session, verbose=True)
    soup0 = BeautifulSoup(resp.text, "html.parser")

    tabs = _type_tabs(soup0)
    headers: list[str] = []
    all_rows: list[dict] = []
    by_type: dict[str, int] = {}

    if not tabs:
        # No type tabs — one type, still origin-partition past the cap.
        headers, rows = _collect_type(session, soup0, "")
        all_rows = [{"Type": "", **r} for r in rows]
        by_type[""] = len(rows)
    else:
        print(f"[spot] type tabs: {[t[0] for t in tabs]}")
        for label, target in tabs:
            tsoup = _postback(session, soup0, target)
            if tsoup is None:
                print(f"[spot] WARN: postback for {label!r} returned nothing — skipping", file=sys.stderr)
                continue
            h, rows = _collect_type(session, tsoup, label)
            if not headers:
                headers = h
            for r in rows:
                all_rows.append({"Type": label, **r})
            by_type[label] = len(rows)
            print(f"[spot] type {label!r}: {len(rows)} unique rows")

    if not all_rows:
        print("[spot] ERROR: parsed 0 rows across all tabs — not writing.", file=sys.stderr)
        return 1

    headers = ["Type", *headers]
    now = datetime.now(UTC)
    payload = {
        "as_of": now.date().isoformat(),
        "generated_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source_url": _BASE,
        "headers": headers,
        "by_type": by_type,
        "rows": all_rows,
        "row_count": len(all_rows),
    }
    _OUT.parent.mkdir(parents=True, exist_ok=True)
    _OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[spot] wrote {_OUT.relative_to(Path(__file__).resolve().parents[3])} "
          f"— {len(all_rows)} rows ({by_type}), {len(headers)} columns")
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="ATTE spot-coffee scraper")
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--probe", action="store_true", help="dump login/table diagnostics, write nothing")
    g.add_argument("--full", action="store_true", help="parse table and write spot_coffee.json")
    args = ap.parse_args()
    if args.probe:
        sys.exit(probe())
    else:
        sys.exit(full())
