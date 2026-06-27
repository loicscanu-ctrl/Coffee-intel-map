"""
sentiment.py
Classify recent coffee NEWS headlines as Bullish / Bearish / Neutral using Gemini.
Requires GEMINI_API_KEY environment variable; returns {available: False} if absent.

What counts as "news": only editorial headlines (tagged `news` by the RSS
scraper). Internally-generated data snapshots and auto-commentary rows
(agronomic status, daily OI snapshots, price/COT/FX rows) are excluded — they
are factual data, inherently neutral, and previously flooded the classifier so
the feed read "Neutral" every day. See _filter_news.

Usage (debug):
    cd backend
    python -m scraper.quant_model.sentiment
"""

import json
import os
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

# NOTE: `database`/`models` are imported lazily (inside the functions that need a
# live DB) so the pure helpers — _filter_news / _aggregate — stay importable and
# unit-testable without a Postgres driver or connection.

# Coffee-relevance allowlist — used to keep the (broad) editorial feed on-topic
# for coffee futures. Macro drivers the prompt cares about are included so a
# "USD strength" / "frost" / "tariff" headline isn't dropped.
_COFFEE_TAGS = {
    "coffee", "arabica", "robusta", "cot", "supply", "demand",
    "weather", "vietnam", "brazil", "colombia", "ethiopia",
    "futures", "forecast", "ico", "conab", "cecafe",
}
_COFFEE_KEYWORDS = (
    "coffee", "arabica", "robusta", "espresso", "barista", "roaster", "café", "cafe",
    "brazil", "vietnam", "colombia", "ethiopia", "honduras", "uganda", "indonesia",
    "harvest", "crop", "frost", "drought", "rain", "export", "tariff", "differential",
    "ico", "conab", "cecafe", "futures", "price",
)

_IRRELEVANT_SOURCES = {"acaphe"}

# Tags that mark internally-generated, non-editorial rows (data snapshots and
# auto-commentary). These are NOT news and must never enter the classifier.
_AUTO_TAGS = {"auto-commentary", "daily-oi"}
# Tag the RSS scraper sets on genuine editorial news items.
_NEWS_TAG = "news"


def _norm_title(t: str) -> str:
    """Lowercased, whitespace-collapsed title — the dedup key."""
    return " ".join((t or "").lower().split())


def _is_real_news(tags: set[str], source_lc: str, title: str) -> bool:
    """A row is classifiable news iff it's an editorial headline (RSS `news`
    tag), not an excluded source, not auto-generated, and coffee-relevant."""
    if source_lc in _IRRELEVANT_SOURCES:
        return False
    if tags & _AUTO_TAGS:
        return False
    if _NEWS_TAG not in tags:
        return False
    # Editorial feeds (e.g. Sprudge) carry coffee-culture pieces with no market
    # relevance; keep only headlines that look coffee/market related.
    blob = f"{title} {' '.join(tags)}".lower()
    return bool(tags & _COFFEE_TAGS) or any(k in blob for k in _COFFEE_KEYWORDS)


def _filter_news(rows, limit: int = 25) -> list[dict]:
    """Pure selection step (no DB): editorial coffee news, deduped by title.

    `rows` is any iterable of objects exposing `.title` / `.source` / `.tags`,
    newest first. Returns the compact dicts handed to the model.
    """
    out: list[dict] = []
    seen: set[str] = set()
    for it in rows:
        tags = set(getattr(it, "tags", None) or [])
        title = getattr(it, "title", "") or ""
        source_lc = (getattr(it, "source", "") or "").lower()
        if not _is_real_news(tags, source_lc, title):
            continue
        key = _norm_title(title)
        if not key or key in seen:
            continue
        seen.add(key)
        out.append({
            "headline": title.strip()[:200],
            "source":   getattr(it, "source", "") or "Unknown",
            # Drop routing/noise tags; keep up to 4 descriptive ones.
            "tags":     [t for t in tags if t not in {_NEWS_TAG, "futures", "price"}][:4],
        })
        if len(out) >= limit:
            break
    return out


def _relevant_news(db, days: int = 7, limit: int = 25) -> list[dict]:
    from models import NewsItem
    cutoff = datetime.utcnow() - timedelta(days=days)
    items = (
        db.query(NewsItem)
        .filter(NewsItem.pub_date >= cutoff, NewsItem.title.isnot(None))
        .order_by(NewsItem.pub_date.desc())
        .limit(400)
        .all()
    )
    return _filter_news(items, limit=limit)


def _aggregate(items_out: list[dict]) -> dict:
    """Roll per-headline classifications into the section summary.

    overall_confidence is the mean confidence WITHIN the winning class (not
    diluted by the total count). net_index is a single −100…+100 score:
    confidence-weighted bullish minus bearish pressure per headline.
    """
    counts = {"Bullish": 0, "Bearish": 0, "Neutral": 0}
    sums = {"Bullish": 0.0, "Bearish": 0.0, "Neutral": 0.0}
    for it in items_out:
        s = it["sentiment"]
        counts[s] += 1
        sums[s] += float(it["confidence"])

    total = len(items_out)
    overall = max(sums, key=lambda k: sums[k]) if total else "Neutral"
    overall_conf = round(sums[overall] / counts[overall], 1) if counts.get(overall) else 50.0
    net_index = round((sums["Bullish"] - sums["Bearish"]) / total, 1) if total else 0.0

    return {
        "overall_sentiment":  overall,
        "overall_confidence": overall_conf,
        "net_index":          net_index,
        "bull_count":         counts["Bullish"],
        "bear_count":         counts["Bearish"],
        "neutral_count":      counts["Neutral"],
        "total":              total,
    }


def classify_headlines(news: list[dict], api_key: str | None = None) -> list[dict]:
    """Classify a list of {headline, source, tags} dicts via Gemini, returning the
    same dicts enriched with `sentiment` + `confidence`. Raises on API failure.

    Shared by the daily run() and the historical backfill so both use identical
    prompt, model and parsing.
    """
    api_key = api_key or os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY not configured")

    headlines_block = "\n".join(
        f"{i + 1}. [{item['source']}] {item['headline']}"
        for i, item in enumerate(news)
    )
    prompt = (
        "You are a coffee commodity market analyst. Classify each headline as Bullish, "
        "Bearish, or Neutral for coffee futures prices (KC arabica and/or RC robusta).\n\n"
        "Bullish = likely pushes prices higher (supply cut, drought, frost risk, demand growth, fund buying).\n"
        "Bearish = likely pushes prices lower (large crop, surplus, USD strength, weak demand, fund selling).\n"
        "Neutral = mixed signals or no clear price impact.\n\n"
        "Return ONLY a JSON array (no markdown), one object per headline:\n"
        '[{"n":1,"sentiment":"Bullish","confidence":82}, ...]\n'
        "confidence is an integer 0-100.\n\n"
        f"Headlines:\n{headlines_block}"
    )

    import google.generativeai as genai
    genai.configure(api_key=api_key)
    model = genai.GenerativeModel(
        "gemini-2.5-flash",
        generation_config={"response_mime_type": "application/json"},
    )
    last_err: Exception | None = None
    for attempt in range(3):
        try:
            response = model.generate_content(prompt)
            classifications = json.loads(response.text)
            break
        except Exception as e:
            last_err = e
            if attempt < 2:
                time.sleep(2 ** attempt)  # 1s, 2s
    else:
        raise last_err if last_err else RuntimeError("Gemini call failed")

    cls_map = {c["n"]: c for c in classifications}
    items_out = []
    for i, item in enumerate(news):
        cls = cls_map.get(i + 1, {})
        raw_sent = cls.get("sentiment", "Neutral")
        sentiment = raw_sent if raw_sent in {"Bullish", "Bearish", "Neutral"} else "Neutral"
        confidence = float(max(0, min(100, cls.get("confidence", 50))))
        items_out.append({
            "headline":   item["headline"],
            "source":     item["source"],
            "sentiment":  sentiment,
            "confidence": confidence,
            "tags":       item["tags"],
        })
    return items_out


def run(db) -> dict:
    if not os.getenv("GEMINI_API_KEY"):
        return {"available": False, "reason": "GEMINI_API_KEY not configured"}

    news = _relevant_news(db)
    if not news:
        return {"available": False, "reason": "No recent coffee news in DB"}

    try:
        items_out = classify_headlines(news)
    except Exception as e:
        return {"available": False, "reason": f"Gemini API error: {e}"}

    return {
        "available":  True,
        "scraped_at": datetime.utcnow().isoformat() + "Z",
        **_aggregate(items_out),
        "items":      items_out,
    }


if __name__ == "__main__":
    from database import SessionLocal
    db = SessionLocal()
    try:
        result = run(db)
        print(json.dumps(result, indent=2, ensure_ascii=False))
    finally:
        db.close()
