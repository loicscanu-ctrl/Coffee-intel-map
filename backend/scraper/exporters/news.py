"""News-feed static export."""
import json
from datetime import datetime, timedelta

from models import (
    NewsItem,
)
from scraper.classify_sentiment import classify_news_item
from scraper.commentary import extract_commentary_from_meta
from scraper.exporters.base import OUT_DIR
from scraper.validate_export import safe_write_json


def _norm_title(s: str | None) -> str:
    """Match key for stitching Gemini sentiment classifications onto news rows.

    The Gemini classifier (scraper.quant_model.sentiment) truncates titles
    to 200 chars before sending them to the model and stores the same
    truncated form in quant_report.json["sentiment"]["items"][i]["headline"].
    Normalising both sides to lowercased, whitespace-collapsed, 200-char
    prefix lets us join the two layers without an id (the Gemini output
    doesn't carry NewsItem.id).
    """
    return " ".join((s or "").strip().split())[:200].lower()


def _load_gemini_index() -> dict[tuple[str, str], dict]:
    """Load latest per-headline Gemini classifications from quant_report.json,
    keyed by (source_lower, normalized_title) for O(1) join below.

    Returns an empty dict on any failure — quant_report.json is produced
    by a separate workflow and may legitimately be missing on a fresh
    repo or before the first quant run lands.
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

    Per-item sentiment stamping uses a two-layer policy:

      1. **Deterministic rules** (scraper.classify_sentiment) cover the
         quantitative slice — ICE OI snapshots, agronomic alerts, futures
         snapshots, Cecafe daily exports, COT releases, ENSO ONI. These
         have direction encoded in `body` or `meta` and don't need an
         LLM. ~50% of the feed gets a verdict this way, instantly, free.
      2. **Gemini classifier** (quant_model.sentiment, joined via the
         static quant_report.json) fills the qualitative remainder —
         Sprudge build-outs, analyst pieces, single-day price labels
         without a delta in the title/body, etc.

    Each emitted item carries a `sentiment_method` field
    ("deterministic" | "gemini") so the frontend / downstream consumers
    can tell which path produced the verdict — useful for trust
    calibration ("rule-based with cited reason" vs "LLM judgment").
    Deterministic items also carry a short `sentiment_reason` string.
    """
    cutoff = datetime.utcnow() - timedelta(days=90)
    rows = (
        db.query(NewsItem)
        .filter(NewsItem.pub_date >= cutoff)
        .order_by(NewsItem.pub_date.desc())
        .limit(200)
        .all()
    )
    gemini_index = _load_gemini_index()
    items = []
    n_det = 0
    n_gem = 0
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

        # ── Sentiment: deterministic rules first, Gemini fallback ────────────
        det = classify_news_item(item)
        if det is not None:
            item["sentiment"]            = det["sentiment"]
            item["sentiment_confidence"] = det["confidence"]
            item["sentiment_method"]     = "deterministic"
            item["sentiment_reason"]     = det["reason"]
            n_det += 1
        else:
            gem_key = ((r.source or "").strip().lower(), _norm_title(r.title))
            gem = gemini_index.get(gem_key)
            if gem and gem.get("sentiment"):
                item["sentiment"]            = gem["sentiment"]
                item["sentiment_confidence"] = gem.get("confidence")
                item["sentiment_method"]     = "gemini"
                n_gem += 1
        items.append(item)
    safe_write_json(
        OUT_DIR / "news.json",
        items,
        lambda d: (isinstance(d, list) and len(d) > 0, "empty news feed"),
    )
    n_commentary = sum(1 for it in items if "commentary" in it)
    print(
        f"  news.json → {len(items)} items ({n_commentary} with commentary, "
        f"{n_det} deterministic + {n_gem} Gemini sentiment)"
    )
