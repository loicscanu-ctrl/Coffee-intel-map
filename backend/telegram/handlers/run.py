from __future__ import annotations

import os

import requests

WORKFLOWS = {
    "prices":       "scraper-prices.yml",
    "cot":          "scraper-cot.yml",
    "cecafe":       "scraper-cecafe.yml",
    "kaffeesteuer": "scraper-kaffeesteuer.yml",
    "ecf":          "scraper-slow-data.yml",
    "brief":        "morning-brief.yml",
}
VALID_NAMES = ", ".join(sorted(WORKFLOWS))


def handle(args: str, context: dict) -> str:
    parts = args.strip().lower().split()
    name  = parts[0] if parts else ""
    if name not in WORKFLOWS:
        return f"Unknown scraper. Options: {VALID_NAMES}"

    owner = os.environ.get("GH_OWNER", "")
    repo  = os.environ.get("GH_REPO", "")
    pat   = os.environ.get("GH_PAT", "")
    if not owner or not repo or not pat:
        return "GitHub credentials not configured (GH_OWNER, GH_REPO, GH_PAT)."

    workflow = WORKFLOWS[name]
    url = f"https://api.github.com/repos/{owner}/{repo}/actions/workflows/{workflow}/dispatches"
    try:
        resp = requests.post(
            url,
            headers={"Authorization": f"Bearer {pat}", "Accept": "application/vnd.github+json"},
            json={"ref": "main"},
            timeout=10,
        )
    except requests.Timeout:
        return "Trigger timed out. Try again."

    if resp.status_code == 204:
        return f"Triggered {name} scraper. Results in ~2 min."
    return f"Failed to trigger (HTTP {resp.status_code}). Check GH_PAT and workflow name."
