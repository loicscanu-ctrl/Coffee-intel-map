"""Demand-side exporters (certified stocks, factory mix)."""



def export_demand_stocks(db) -> None:
    try:
        from scraper.export_stocks import export_stocks as _export_stocks
        _export_stocks(db)
    except Exception as e:
        print(f"  demand_stocks.json → FAILED: {e}")


def export_factory_mix_step() -> None:
    try:
        from scraper.export_factory_mix import export_factory_mix as _export_factory_mix
        _export_factory_mix()
    except Exception as e:
        print(f"  factory_mix.json → FAILED: {e}")
