"""Synthetic tests for the farmer_selling 'echo' enhancement — Google-News
discovery + crop-year-aware dual-crop parsing. No live network: the parser is
validated against synthetic article text and feedparser is faked."""
from types import SimpleNamespace

import scraper.sources.farmer_selling as fs

# ── dual-crop parsing ─────────────────────────────────────────────────────────

ECHO_TEXT = (
    "A comercialização da safra 2025/26 de café no Brasil atingiu 86% até maio. "
    "Para a safra 2026/27, as vendas antecipadas já somam 16%, sendo 20% do café "
    "arábica e 10% do conilon, segundo a Safras & Mercado."
)


def test_parse_dual_crop_two_years():
    out = fs._parse_dual_crop(ECHO_TEXT)
    assert out == {
        "2025/26": {"overall_sold_pct": 86},
        "2026/27": {"overall_sold_pct": 16, "arabica_sold_pct": 20, "conilon_sold_pct": 10},
    }


def test_parse_dual_crop_assigns_breakdown_to_right_variety():
    # "20% do arábica e 10% do conilon" must not swap (the gap blocks crossover)
    out = fs._parse_dual_crop("Safra 2026/27: 20% do arábica e 10% do conilon vendidos.")
    assert out["2026/27"]["arabica_sold_pct"] == 20
    assert out["2026/27"]["conilon_sold_pct"] == 10


def test_parse_dual_crop_keyword_then_pct_phrasing():
    out = fs._parse_dual_crop("Na safra 2026/27, o arábica soma 20% e o conilon 10%.")
    assert out["2026/27"]["arabica_sold_pct"] == 20
    assert out["2026/27"]["conilon_sold_pct"] == 10


def test_parse_dual_crop_none_without_crop_year():
    assert fs._parse_dual_crop("Preço do café sobe 5% na bolsa de NY.") is None
    assert fs._parse_dual_crop("") is None


def test_parse_dual_crop_rejects_out_of_range_pct():
    # a stray '120%' is not a valid sold-pct
    out = fs._parse_dual_crop("Safra 2025/26 teve alta de 120% no preço.")
    assert out is None or out.get("2025/26", {}).get("overall_sold_pct") != 120


# ── echo candidate filtering ──────────────────────────────────────────────────

def test_is_echo_candidate_accepts_coffee_sales():
    assert fs._is_echo_candidate("Comercialização do café 2025/26 atinge 86%, diz Safras")


def test_is_echo_candidate_rejects_other_crops():
    assert not fs._is_echo_candidate("Comercialização da soja safra 2025/26 atinge 70%")


def test_is_echo_candidate_requires_coffee():
    assert not fs._is_echo_candidate("Safras divulga relatório de comercialização")


# ── Google News discovery (feedparser faked) ──────────────────────────────────

def test_google_news_urls_filters_and_dedupes(monkeypatch):
    entries = [
        SimpleNamespace(title="Comercialização do café 2025/26 atinge 86% - Notícias Agrícolas",
                        link="https://www.noticiasagricolas.com.br/a"),
        SimpleNamespace(title="Soja: vendas da safra avançam 70%",  # other crop → rejected
                        link="https://x/soja"),
        SimpleNamespace(title="Vendas antecipadas do café 2026/27 em 16% - Globo Rural",
                        link="https://g1.globo.com/b"),
    ]
    fake = SimpleNamespace(parse=lambda url: SimpleNamespace(entries=entries))
    monkeypatch.setattr(fs, "feedparser", fake, raising=False)
    monkeypatch.setattr(fs, "HAS_FEEDPARSER", True)
    # one feed yields 2 coffee links; 3 feeds → deduped to the same 2
    urls = fs._google_news_urls()
    assert urls == ["https://www.noticiasagricolas.com.br/a", "https://g1.globo.com/b"]


def test_google_news_urls_noop_without_feedparser(monkeypatch):
    monkeypatch.setattr(fs, "HAS_FEEDPARSER", False)
    assert fs._google_news_urls() == []


# ── build wiring: additive dual-crop block (faked fetch, no network) ──────────

def test_build_writes_additive_crops_block(tmp_path, monkeypatch):
    import json

    existing = {
        "arabica": {"brazil": {"crop_year": "2025/26", "current": 83}, "regions": [], "progression": [], "chart": []},
        "robusta": {"brazil": {"crop_year": "2025/26", "current": 77}, "regions": [], "progression": [], "chart": []},
    }
    out = tmp_path / "farmer_selling_brazil.json"
    out.write_text(json.dumps(existing), encoding="utf-8")

    monkeypatch.setattr(fs, "OUT_PATH", out)
    monkeypatch.setattr(fs, "_find_sales_article_urls", lambda session: ["http://echo"])
    monkeypatch.setattr(fs, "_parse_article", lambda html: None)  # isolate the dual-crop path

    class _Resp:
        text = ECHO_TEXT
        def raise_for_status(self):
            pass

    class _Session:
        def get(self, *a, **k):
            return _Resp()

    monkeypatch.setattr(fs.requests, "Session", lambda: _Session())

    data = fs.build_farmer_selling()

    # existing rich fields preserved (additive — live panel unaffected)
    assert data["arabica"]["brazil"]["current"] == 83
    # new dual-crop block, both years, correct status + breakdown
    assert data["crops"]["2025/26"] == {
        "status": "current_crop", "overall_sold_pct": 86,
        "arabica_sold_pct": None, "conilon_sold_pct": None,
    }
    assert data["crops"]["2026/27"] == {
        "status": "new_crop_advance", "overall_sold_pct": 16,
        "arabica_sold_pct": 20, "conilon_sold_pct": 10,
    }
    assert data["crops_meta"]["source"] == "Safras & Mercado (via News Echo)"
    # persisted to disk
    assert json.loads(out.read_text())["crops"]["2026/27"]["arabica_sold_pct"] == 20
