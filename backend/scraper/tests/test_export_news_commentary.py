"""Round-trip test for the news exporter's commentary promotion.

Scrapers embed `_commentary` inside the existing `meta` JSON string; the
news.json exporter pulls that block out to a top-level `commentary` field
so the frontend reads structured data, not a stringified blob.

`extract_commentary_from_meta` lives in `scraper.commentary` so this test
doesn't transitively load sqlalchemy / database via the news exporter.
"""
import json

from scraper.commentary import extract_commentary_from_meta as _extract_commentary


def test_extract_commentary_promotes_block_to_dict():
    meta = json.dumps({
        "source": "ICE",
        "_commentary": {
            "text":               "KC Arabica certified stocks shifted by -2,400 bags today.",
            "hasUpdate":          True,
            "isLatestTradingDay": True,
        },
        "raw_payload": {"some": "data"},
    })
    out = _extract_commentary(meta)
    assert out == {
        "text":               "KC Arabica certified stocks shifted by -2,400 bags today.",
        "hasUpdate":          True,
        "isLatestTradingDay": True,
    }


def test_extract_commentary_returns_none_when_missing():
    meta = json.dumps({"source": "ICE", "raw_payload": {"some": "data"}})
    assert _extract_commentary(meta) is None


def test_extract_commentary_handles_non_json_meta():
    """Legacy callers stash freeform strings in meta — must not crash."""
    assert _extract_commentary("not json at all") is None
    assert _extract_commentary("") is None
    assert _extract_commentary(None) is None


def test_extract_commentary_handles_non_dict_json():
    """Older payloads might be a JSON list or scalar; treat as 'no commentary'."""
    assert _extract_commentary(json.dumps([1, 2, 3])) is None
    assert _extract_commentary(json.dumps("just a string")) is None


def test_extract_commentary_rejects_empty_text():
    """An empty commentary text is treated as no commentary — prevents the
    frontend from rendering a badge with an empty body if a scraper
    misconfigures the block."""
    meta = json.dumps({"_commentary": {"text": "", "hasUpdate": True}})
    assert _extract_commentary(meta) is None


def test_extract_commentary_defaults_hasupdate_true_isLatest_false():
    """The two flags default sensibly when scrapers omit them: hasUpdate=true
    because emitting commentary implies an update; isLatestTradingDay=false
    because the scraper hasn't asserted otherwise."""
    meta = json.dumps({"_commentary": {"text": "Some commentary."}})
    out = _extract_commentary(meta)
    assert out["hasUpdate"] is True
    assert out["isLatestTradingDay"] is False
