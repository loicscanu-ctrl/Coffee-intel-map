"""News-feed static export."""
import json
from datetime import datetime, timedelta

from models import (
    NewsItem,
)
from scraper.commentary import extract_commentary_from_meta
from scraper.exporters.base import OUT_DIR
from scraper.validate_export import safe_write_json


def _norm_title(s: str | None) -> str:
    """Match key for stitching sentiment classifications onto news rows.

    The Gemini classifier (scraper.quant_model.sentiment) truncates titles
    to 200 chars before sending them to the model and stores the same
    truncated form in quant_report.json["sentiment"]["items"][i]["headline"].
    Normalising both sides to lowercased, whitespace-collapsed, 200-char
    prefix lets us join the two layers without an id (the sentiment
    output doesn't carry NewsItem.id).
    """
    return " ".join((s or "").strip().split())[:200].lower()


def _load_sentiment_index() -> dict[tuple[str, str], dict]:
    """Load latest per-headline classifications from quant_report.json,
    keyed by (source_lower, normalized_title) for O(1) join below.

    Returns an empty dict on any failure — quant_report.json is produced
    by a separate workflow and may legitimately be missing on a fresh
    repo or before the first quant run lands. The news exporter degrades
    to "no sentiment fields" rather than failing.
    """
    try:
        path = OUT_DIR / "quant_report.json"
        if not path.exists():
            return {}
        doc = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    sent = (doc or {}).get("sentiment") or {}
    if not sent.get("available"):
        return {}
    out: dict[tuple[str, str], dict] = {}
    for it in sent.get("items") or []:
        src = (it.get("source") or "").strip().lower()
        key = (src, _norm_title(it.get("headline")))
        if not key[1]:
            continue
        out[key] = {
            "sentiment":  it.get("sentiment"),
            "confidence": it.get("confidence"),
        }
    return out


def export_news(db) -> None:
    """Publish the recent news feed as a static file so the Map tab's News Feed
    works on the static site (the live /api/news backend isn't deployed).

    Each item is additionally stamped with `sentiment` + `sentiment_confidence`
    when the latest quant_report.json carries a Bull/Bear/Neutral verdict for
    that (source, headline). The classifier covers the ~25 most recent
    coffee-tagged headlines per run (see scraper.quant_model.sentiment), so
    older items in the feed land without sentiment fields by design — the
    NewsFeed UI renders pills only when present.
    """
    cutoff = datetime.utcnow() - timedelta(days=90)
    rows = (
        db.query(NewsItem)
        .filter(NewsItem.pub_date >= cutoff)
        .order_by(NewsItem.pub_date.desc())
        .limit(200)
        .all()
    )
    sent_index = _load_sentiment_index()
    items = []
    n_with_sent = 0
    for r in rows:
        item = {
            "id": r.id,
            "title": r.title,
            "body": r.body,
            "source": r.source,
            "category": r.category,
            "lat": r.lat,
            "lng": r.lng,
            "tags": r.tags or [],
            "meta": r.meta,
            "pub_date": r.pub_date.isoformat() if r.pub_date else None,
        }
        commentary = extract_commentary_from_meta(r.meta)
        if commentary is not None:
            item["commentary"] = commentary
        # Stitch per-headline sentiment classification when available.
        sent_key = ((r.source or "").strip().lower(), _norm_title(r.title))
        sent_match = sent_index.get(sent_key)
        if sent_match and sent_match.get("sentiment"):
            item["sentiment"]            = sent_match["sentiment"]
            item["sentiment_confidence"] = sent_match.get("confidence")
            n_with_sent += 1
        items.append(item)
    safe_write_json(
        OUT_DIR / "news.json",
        items,
        lambda d: (isinstance(d, list) and len(d) > 0, "empty news feed"),
    )
    n_commentary = sum(1 for it in items if "commentary" in it)
    print(
        f"  news.json → {len(items)} items ({n_commentary} with commentary, "
        f"{n_with_sent} with sentiment)"
    )
