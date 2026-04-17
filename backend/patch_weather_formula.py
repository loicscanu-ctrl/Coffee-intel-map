"""
Patch: re-fetch Open-Meteo weather for all 4 Brazil regions and recompute
drought risk using the new agronomic formula (RWC + ET0 + rain relief).
Then re-exports farmer_economics.json.

Run from backend/:
    python patch_weather_formula.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from database import SessionLocal
from scraper.sources.farmer_economics import _scrape_weather
from scraper.export_static_json import export_farmer_economics

def main():
    db = SessionLocal()
    try:
        print("Re-scraping weather with new drought formula...")
        _scrape_weather(db)
        print("Re-exporting farmer_economics.json...")
        export_farmer_economics(db)
        print("Done.")
    finally:
        db.close()

if __name__ == "__main__":
    main()
