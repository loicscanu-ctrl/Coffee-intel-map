#!/usr/bin/env python3
"""Build frontend/public/data/workflows_inventory.json from .github/workflows/*.yml.

Lists every workflow with its structural metadata (name, triggers, cron
schedules, workflow_run upstream chains, concurrency group, timeout). The
Data Platform Map page reads this JSON so the inventory stays in sync with
the actual YAML — no manual maintenance.

Fields per workflow:
  file              : workflow YAML filename (sortable display key)
  name              : the human `name:` from the YAML, falls back to filename
  triggers          : list of top-level `on:` keys (push, schedule,
                      workflow_dispatch, workflow_run, …)
  crons             : list of cron expressions under `on.schedule`
  workflow_run_deps : list of upstream workflow names referenced under
                      `on.workflow_run.workflows`
  concurrency_group : the `concurrency.group` string, if any
  timeout_minutes   : max `timeout-minutes` across the workflow's jobs

PyYAML quirk: GitHub Actions writes `on:` at the top level, but YAML 1.1
treats bare `on` as the boolean True keyword. So when PyYAML parses the
file, `data["on"]` is missing and the trigger block lives under `data[True]`.
We check both keys.

Run via:
  python backend/scripts/build_workflow_inventory.py
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
WORKFLOWS_DIR = ROOT / ".github" / "workflows"
OUT_PATH = ROOT / "frontend" / "public" / "data" / "workflows_inventory.json"


def _on_block(data: dict):
    """Return the `on:` mapping, accounting for YAML 1.1's `on→True` quirk."""
    if "on" in data:
        return data["on"]
    if True in data:
        return data[True]
    return None


def _extract_triggers(on) -> list[str]:
    if isinstance(on, str):
        return [on]
    if isinstance(on, list):
        return [str(t) for t in on]
    if isinstance(on, dict):
        return sorted(on.keys())
    return []


def _extract_crons(on) -> list[str]:
    if not isinstance(on, dict):
        return []
    sched = on.get("schedule")
    if not isinstance(sched, list):
        return []
    return [s["cron"] for s in sched if isinstance(s, dict) and "cron" in s]


def _extract_workflow_run_deps(on) -> list[str]:
    if not isinstance(on, dict):
        return []
    wr = on.get("workflow_run")
    if not isinstance(wr, dict):
        return []
    flows = wr.get("workflows")
    if not isinstance(flows, list):
        return []
    return [str(f) for f in flows]


def _concurrency_group(data: dict) -> str | None:
    conc = data.get("concurrency")
    if isinstance(conc, dict):
        return conc.get("group")
    if isinstance(conc, str):
        return conc
    return None


def _max_timeout(jobs) -> int | None:
    if not isinstance(jobs, dict):
        return None
    timeouts = []
    for job in jobs.values():
        if isinstance(job, dict) and isinstance(job.get("timeout-minutes"), int):
            timeouts.append(job["timeout-minutes"])
    return max(timeouts) if timeouts else None


def build_inventory() -> list[dict]:
    workflows = []
    for yml in sorted(WORKFLOWS_DIR.glob("*.yml")):
        try:
            data = yaml.safe_load(yml.read_text(encoding="utf-8"))
        except yaml.YAMLError as e:
            print(f"[workflow-inventory] skip {yml.name}: parse error {e}", file=sys.stderr)
            continue
        if not isinstance(data, dict):
            continue
        on = _on_block(data)
        jobs = data.get("jobs", {})
        workflows.append({
            "file":              yml.name,
            "name":              data.get("name") or yml.stem,
            "triggers":          _extract_triggers(on),
            "crons":             _extract_crons(on),
            "workflow_run_deps": _extract_workflow_run_deps(on),
            "concurrency_group": _concurrency_group(data),
            "timeout_minutes":   _max_timeout(jobs),
        })
    return workflows


def main() -> None:
    workflows = build_inventory()
    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "count": len(workflows),
        "workflows": workflows,
    }
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"[workflow-inventory] wrote {OUT_PATH.relative_to(ROOT)} ({len(workflows)} workflows)")


if __name__ == "__main__":
    main()
