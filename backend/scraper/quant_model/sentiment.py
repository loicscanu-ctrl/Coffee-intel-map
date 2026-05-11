"""
sentiment.py
Classify recent coffee news headlines as Bullish / Bearish / Neutral using Gemini.
Requires GEMINI_API_KEY environment variable; returns {available: False} if absent.

Usage (debug):
    cd backend
    python -m scraper.quant_model.sentiment
"""

import json
import os
import sys
from datetime import datetime, timedelta
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from database import SessionLocal
from models import NewsItem

_COFFEE_TAGS = {
    "coffee", "arabica", "robusta", "cot", "supply", "demand",
    "weather", "vietnam", "brazil", "colombia", "ethiopia",
    "futures", "forecast", "ico", "conab", "cecafe",
}

_IRRELEVANT_SOURCES = {"acaphe"}


def _relevant_news(db, days: int = 7, limit: int = 25) -> list[dict]:
    cutoff = datetime.utcnow() - timedelta(days=days)
    items = (
        db.query(NewsItem)
        .filter(NewsItem.pub_date >= cutoff, NewsItem.title.isnot(None))
        .order_by(NewsItem.pub_date.desc())
        .limit(300)
        .all()
    )
    relevant = []
    for it in items:
        tags = set(it.tags or [])
        source_lc = (it.source or "").lower()
        if source_lc in _IRRELEVANT_SOURCES:
            continue
        if not (tags & _COFFEE_TAGS):
            continue
        relevant.append({
            "headline": (it.title or "").strip()[:200],
            "source":   it.source or "Unknown",
            "tags":     list(tags - {"futures", "price"})[:4],
        })
        if len(relevant) >= limit:
            break
    return relevant


def run(db) -> dict:
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        return {"available": False, "reason": "GEMINI_API_KEY not configured"}

    news = _relevant_news(db)
    if not news:
        return {"available": False, "reason": "No recent coffee news in DB"}

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

    try:
        import google.generativeai as genai
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel("gemini-2.5-flash")
        response = model.generate_content(prompt)
        raw = response.text.strip()
        if "```" in raw:
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        classifications = json.loads(raw.strip())
    except Exception as e:
        return {"available": False, "reason": f"Gemini API error: {e}"}

    cls_map = {c["n"]: c for c in classifications}

    items_out = []
    bull = bear = neutral = 0
    score_sums: dict[str, float] = {"Bullish": 0.0, "Bearish": 0.0, "Neutral": 0.0}

    for i, item in enumerate(news):
        cls = cls_map.get(i + 1, {})
        raw_sent = cls.get("sentiment", "Neutral")
        sentiment: str = raw_sent if raw_sent in {"Bullish", "Bearish", "Neutral"} else "Neutral"
        confidence = float(max(0, min(100, cls.get("confidence", 50))))

        if sentiment == "Bullish":
            bull += 1
        elif sentiment == "Bearish":
            bear += 1
        else:
            neutral += 1

        score_sums[sentiment] += confidence
        items_out.append({
            "headline":   item["headline"],
            "source":     item["source"],
            "sentiment":  sentiment,
            "confidence": confidence,
            "tags":       item["tags"],
        })

    total = len(items_out)
    overall = max(score_sums, key=lambda k: score_sums[k])
    overall_conf = round(score_sums[overall] / total, 1) if total else 50.0

    return {
        "available":          True,
        "scraped_at":         datetime.utcnow().isoformat() + "Z",
        "overall_sentiment":  overall,
        "overall_confidence": overall_conf,
        "bull_count":         bull,
        "bear_count":         bear,
        "neutral_count":      neutral,
        "total":              total,
        "items":              items_out,
    }


if __name__ == "__main__":
    db = SessionLocal()
    try:
        result = run(db)
        print(json.dumps(result, indent=2, ensure_ascii=False))
    finally:
        db.close()
