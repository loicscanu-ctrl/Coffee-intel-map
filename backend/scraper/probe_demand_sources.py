"""
probe_demand_sources.py — catalog what AJCA + ECF actually publish today.

For each candidate page URL:
  * fetch via requests with realistic UA, follow redirects
  * print status / final URL / size / content-type
  * if HTML, extract every <a href> that points at .xls/.xlsx/.pdf/.csv
    or whose anchor text suggests stocks / statistics — print href + label
  * if HTML, print a short text excerpt around any number that mentions
    bags / tonnes / stocks, so we can see what phrasing the regexes will
    need to hit
  * if the link itself is a file, hex-dump the first 16 bytes so we can
    tell PDF (`%PDF`) vs Excel (`PK` for xlsx, `D0CF11E0` for legacy xls)
    vs an HTML error page wearing a `.pdf` URL

No DB, no Playwright. Just enough info to design the real scrapers.
"""
from __future__ import annotations

import re
import sys
from html.parser import HTMLParser
from urllib.parse import urljoin

import requests

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9,ja;q=0.7",
}

AJCA_PAGES = [
    "https://www.ajca.or.jp/",
    "https://www.ajca.or.jp/statistics/",
    "https://www.ajca.or.jp/data/",
    "https://www.ajca.or.jp/coffee_data/",
    "https://www.ajca.or.jp/data/data01.html",
    "https://www.ajca.or.jp/data/data02.html",
    "https://www.ajca.or.jp/toukei/",
    "https://ajca.or.jp/",
]

ECF_PAGES = [
    "https://www.ecf-coffee.org/",
    "https://www.ecf-coffee.org/resources/statistics/",
    "https://www.ecf-coffee.org/resources/",
    "https://www.ecf-coffee.org/knowledge/statistics/",
    "https://www.ecf-coffee.org/knowledge/",
    "https://www.ecf-coffee.org/news/",
    "https://www.ecf-coffee.org/publications/",
    "https://www.ecf-coffee.org/category/news/",
]

FILE_EXTS = (".pdf", ".xls", ".xlsx", ".csv", ".zip")
INTEREST_TOKENS = (
    "stock", "stocks", "statistic", "statistics", "report", "monthly",
    "annual", "data", "ecf", "ajca", "coffee",
    "在庫", "統計", "コーヒー", "データ",
)


class LinkExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.links: list[tuple[str, str]] = []  # (href, anchor_text)
        self._current_href: str | None = None
        self._buf: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "a":
            for k, v in attrs:
                if k == "href" and v:
                    self._current_href = v
                    self._buf = []
                    break

    def handle_endtag(self, tag: str) -> None:
        if tag == "a" and self._current_href is not None:
            text = " ".join(self._buf).strip()
            self.links.append((self._current_href, text))
            self._current_href = None
            self._buf = []

    def handle_data(self, data: str) -> None:
        if self._current_href is not None:
            self._buf.append(data.strip())


def hexdump(data: bytes, n: int = 16) -> str:
    return " ".join(f"{b:02x}" for b in data[:n])


def magic_guess(data: bytes) -> str:
    if data.startswith(b"%PDF"):
        return "PDF"
    if data.startswith(b"PK\x03\x04"):
        return "ZIP/XLSX/DOCX"
    if data.startswith(b"\xd0\xcf\x11\xe0"):
        return "Legacy MS Office (XLS/DOC)"
    if data.lstrip().lower().startswith((b"<!doctype html", b"<html")):
        return "HTML"
    return "?"


def probe_one(url: str) -> dict:
    out = {"url": url}
    try:
        r = requests.get(url, headers=HEADERS, timeout=25, allow_redirects=True)
    except Exception as e:
        out["error"] = str(e)
        return out
    out["status"] = r.status_code
    out["final_url"] = r.url
    out["bytes"] = len(r.content)
    out["content_type"] = r.headers.get("Content-Type", "")
    out["magic"] = magic_guess(r.content)
    out["head_hex"] = hexdump(r.content)

    if "html" in out["content_type"].lower():
        out["links"] = _extract_links(r.text, r.url)
        out["text_snippets"] = _grep_stock_phrases(r.text)
    return out


def _extract_links(html: str, base_url: str) -> list[dict]:
    p = LinkExtractor()
    try:
        p.feed(html)
    except Exception:
        pass
    candidates: list[dict] = []
    for href, text in p.links:
        href_l = href.lower()
        text_l = text.lower()
        is_file = any(href_l.endswith(ext) for ext in FILE_EXTS)
        has_token = any(t in href_l or t in text_l for t in INTEREST_TOKENS)
        if not (is_file or has_token):
            continue
        candidates.append({
            "href":  urljoin(base_url, href),
            "label": text[:80] or "(no text)",
            "is_file": is_file,
        })
    # Dedupe by absolute href; prefer entries that have a label
    seen: dict[str, dict] = {}
    for c in candidates:
        prev = seen.get(c["href"])
        if not prev or (prev.get("label") in ("(no text)", "") and c["label"] != "(no text)"):
            seen[c["href"]] = c
    return list(seen.values())[:40]  # cap


def _grep_stock_phrases(html: str) -> list[str]:
    text = re.sub(r"<[^>]+>", " ", html)
    text = re.sub(r"\s+", " ", text)
    snippets: list[str] = []
    patterns = [
        # English
        r"[\d,.\s]{4,15}\s*(?:million\s+bags|m\s+bags|bags|tonnes|metric\s+tons|MT)",
        # Japanese
        r"[\d,.\s]{4,15}\s*(?:袋|トン|t)",
    ]
    for pat in patterns:
        for m in re.finditer(pat, text, flags=re.I):
            start = max(0, m.start() - 60)
            end   = min(len(text), m.end() + 30)
            snippets.append(text[start:end].strip())
            if len(snippets) >= 8:
                break
        if len(snippets) >= 8:
            break
    return snippets


def probe_file(url: str) -> dict:
    """Lightweight HEAD-ish probe for a downloadable file: GET first 4 KB."""
    out = {"url": url}
    try:
        r = requests.get(url, headers={**HEADERS, "Range": "bytes=0-4095"},
                         timeout=25, allow_redirects=True, stream=True)
        data = r.raw.read(4096)
        out["status"] = r.status_code
        out["final_url"] = r.url
        out["bytes_sampled"] = len(data)
        out["content_type"] = r.headers.get("Content-Type", "")
        out["content_length"] = r.headers.get("Content-Length", "?")
        out["head_hex"] = hexdump(data)
        out["magic"] = magic_guess(data)
    except Exception as e:
        out["error"] = str(e)
    return out


def render_page(label: str, page: dict) -> str:
    lines = [f"### {label}: {page['url']}"]
    if "error" in page:
        lines.append(f"  ✗ {page['error']}")
        return "\n".join(lines)
    lines.append(
        f"  {page['status']} {page.get('content_type', '')} "
        f"{page.get('bytes', 0):,} bytes  magic={page.get('magic', '?')}"
    )
    if page.get("final_url") and page["final_url"] != page["url"]:
        lines.append(f"  -> {page['final_url']}")
    links = page.get("links") or []
    if links:
        lines.append(f"  links of interest ({len(links)}):")
        for L in links:
            marker = "FILE" if L["is_file"] else "    "
            lines.append(f"    [{marker}] {L['label'][:50]!r:<54} {L['href']}")
    snippets = page.get("text_snippets") or []
    if snippets:
        lines.append("  number/stock phrases:")
        for s in snippets:
            lines.append(f"    … {s[:140]}")
    return "\n".join(lines)


def main() -> int:
    print("════════════════════════════════════════════════════════════")
    print("  AJCA — All Japan Coffee Association probe")
    print("════════════════════════════════════════════════════════════")
    ajca_pages = [probe_one(u) for u in AJCA_PAGES]
    for p in ajca_pages:
        print(render_page("AJCA", p))
        print()

    print("════════════════════════════════════════════════════════════")
    print("  ECF — European Coffee Federation probe")
    print("════════════════════════════════════════════════════════════")
    ecf_pages = [probe_one(u) for u in ECF_PAGES]
    for p in ecf_pages:
        print(render_page("ECF", p))
        print()

    # Now download a sample of every file link we found, on each side, so
    # we can see what the actual file looks like.
    all_files: list[str] = []
    for p in ajca_pages + ecf_pages:
        for L in p.get("links", []):
            if L["is_file"]:
                all_files.append(L["href"])
    all_files = list(dict.fromkeys(all_files))[:10]  # cap to 10

    if all_files:
        print("════════════════════════════════════════════════════════════")
        print(f"  Sample file probes ({len(all_files)} files)")
        print("════════════════════════════════════════════════════════════")
        for u in all_files:
            f = probe_file(u)
            print(f"  {f.get('status', '?')} {f.get('content_type', '?')} "
                  f"len={f.get('content_length', '?')} magic={f.get('magic', '?')}")
            print(f"    {u}")
            if "head_hex" in f:
                print(f"    head: {f['head_hex']}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
