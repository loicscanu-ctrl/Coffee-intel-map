"""Contract test for the news exporter's per-headline sentiment join.

`export_news` reads the static `quant_report.json` (written by the
separate quant workflow) and stitches its per-headline `sentiment`
verdict onto each emitted news row. The match key is
(source.lower(), normalized_title) where normalized_title is whitespace-
collapsed, lowercased, truncated to 200 chars — matching exactly the
form the Gemini classifier stored. These tests pin that contract so a
future refactor doesn't silently break the join (the symptom would be
that every news item ships with no sentiment fields and no error).
"""
import json

from scraper.exporters import news as news_mod


def test_norm_title_lowercases_collapses_whitespace_and_truncates():
    assert news_mod._norm_title("  Hello   World  ") == "hello world"
    assert news_mod._norm_title("MIXED Case Title") == "mixed case title"
    long = "x" * 300
    assert len(news_mod._norm_title(long)) == 200


def test_norm_title_handles_none_and_empty():
    assert news_mod._norm_title(None) == ""
    assert news_mod._norm_title("") == ""
    assert news_mod._norm_title("   ") == ""


def test_load_gemini_index_handles_missing_file(tmp_path, monkeypatch):
    """Quant workflow hasn't run yet → return {} not crash."""
    monkeypatch.setattr(news_mod, "OUT_DIR", tmp_path)
    assert news_mod._load_gemini_index() == {}


def test_load_gemini_index_handles_unavailable_block(tmp_path, monkeypatch):
    """Quant ran but Gemini was disabled → return {} not crash."""
    monkeypatch.setattr(news_mod, "OUT_DIR", tmp_path)
    (tmp_path / "quant_report.json").write_text(json.dumps({
        "sentiment": {"available": False, "reason": "no GEMINI_API_KEY"},
    }))
    assert news_mod._load_gemini_index() == {}


def test_load_gemini_index_handles_malformed_json(tmp_path, monkeypatch):
    """Crashed mid-write or hand-edited → return {} not raise."""
    monkeypatch.setattr(news_mod, "OUT_DIR", tmp_path)
    (tmp_path / "quant_report.json").write_text("not valid json {")
    assert news_mod._load_gemini_index() == {}


def test_load_gemini_index_keys_normalize_source_and_title(tmp_path, monkeypatch):
    monkeypatch.setattr(news_mod, "OUT_DIR", tmp_path)
    (tmp_path / "quant_report.json").write_text(json.dumps({
        "sentiment": {
            "available": True,
            "items": [
                {"source": "Cecafe",  "headline": "Brazil Exports Up",  "sentiment": "Bullish", "confidence": 80},
                {"source": "GIACAPHE","headline": "  VN price drops  ", "sentiment": "Bearish", "confidence": 65},
            ],
        }
    }))
    idx = news_mod._load_gemini_index()
    # Both keys use lowercase source + normalized title; the spaces around
    # "VN price drops" are collapsed, the case is folded.
    assert ("cecafe",  "brazil exports up") in idx
    assert ("giacaphe", "vn price drops")    in idx
    assert idx[("cecafe",  "brazil exports up")]["sentiment"] == "Bullish"
    assert idx[("giacaphe", "vn price drops")]["confidence"] == 65


def test_load_gemini_index_drops_items_missing_required_fields(tmp_path, monkeypatch):
    """Items without a headline shouldn't pollute the lookup with empty keys."""
    monkeypatch.setattr(news_mod, "OUT_DIR", tmp_path)
    (tmp_path / "quant_report.json").write_text(json.dumps({
        "sentiment": {
            "available": True,
            "items": [
                {"source": "X", "headline": None,  "sentiment": "Bullish"},
                {"source": "X", "headline": "",    "sentiment": "Bearish"},
                {"source": "Y", "headline": "Real headline", "sentiment": "Neutral"},
            ],
        }
    }))
    idx = news_mod._load_gemini_index()
    assert list(idx.keys()) == [("y", "real headline")]
