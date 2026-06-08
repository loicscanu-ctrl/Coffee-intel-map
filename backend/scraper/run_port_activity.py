"""
Standalone runner for the IMF PortWatch port-activity scraper.
Used by GitHub Actions (workflow 1.11) — fetches the curated coffee export
ports and writes frontend/public/data/port_activity.json. No DB, no browser.

    cd backend && python -m scraper.run_port_activity
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from scraper.sources.port_activity import run

if __name__ == "__main__":
    payload = run()
    # Non-zero exit if nothing was fetched, so the workflow surfaces the failure.
    sys.exit(0 if payload else 1)
