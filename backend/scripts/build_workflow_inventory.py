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
from datetime import UTC, datetime
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


# ── Drift detection ──────────────────────────────────────────────────────────
# The /data-map page also renders a hand-curated "Per-workflow → exact dashboard
# visual" table (the ROWS array in frontend/app/data-map/page.tsx). It maps
# each workflow to the chart/component it drives, which the YAML can't tell us
# on its own. The risk: ship a new workflow without adding a row → the
# table silently lags behind reality.
#
# This module's drift report flags that gap so the page can render a "needs
# curation" warning. Matching key is the leading version prefix in both the
# workflow's `name:` field ("1.3 – Daily OI Snapshot") and the row's `wf:`
# value ("1.3 Daily OI" / "1.3 → 2.3 rebuild") — the prefix is stable across
# both conventions while the trailing text varies. Rows whose `wf:` doesn't
# carry a version prefix are non-workflow features (Telegram commands,
# sub-tab descriptions, "various / manual" rollups) — they're valid but out
# of scope for drift.

import re

CURATED_SOURCE = ROOT / "frontend" / "app" / "data-map" / "page.tsx"
_VERSION_PREFIX = re.compile(r"^([0-9]+\.[0-9]+(?:\.[0-9]+)?)\b")


def _version_prefix(name: str) -> str | None:
    m = _VERSION_PREFIX.match(name)
    return m.group(1) if m else None


def _read_curated_wf_refs() -> tuple[set[str], list[str]]:
    """Scan ROWS in data-map/page.tsx for `wf: "..."` values.

    Returns (prefixes, non_workflow_labels):
      prefixes              — set of version prefixes that ROWS references
      non_workflow_labels   — `wf:` values that don't carry a version prefix
                              (informational entries like /cot Telegram,
                              "various / manual", sub-tab descriptions).

    Returns ({}, []) if the source file is missing — the drift report
    degrades gracefully on environments that don't have the frontend
    checked out alongside the script.
    """
    if not CURATED_SOURCE.exists():
        return set(), []
    text = CURATED_SOURCE.read_text(encoding="utf-8")
    refs = re.findall(r'wf:\s*"([^"]+)"', text)
    prefixes: set[str] = set()
    non_workflow: list[str] = []
    for r in refs:
        p = _version_prefix(r)
        if p:
            prefixes.add(p)
        else:
            non_workflow.append(r)
    return prefixes, non_workflow


def compute_drift(workflows: list[dict]) -> dict:
    """Cross-reference the auto-inventory against the curated ROWS table.

    Output schema:
      uncovered_workflows   — workflows with no ROWS entry (each: {file, name, version})
      stale_curation        — ROWS prefixes that no workflow file matches
      non_workflow_entries  — sample of curated `wf:` values without version prefix
                              (kept short for the UI; full list lives in the source).
    """
    curated_prefixes, non_workflow = _read_curated_wf_refs()
    workflows_by_prefix: dict[str, list[dict]] = {}
    no_version: list[dict] = []
    for w in workflows:
        p = _version_prefix(w["name"])
        if p:
            workflows_by_prefix.setdefault(p, []).append(w)
        else:
            no_version.append(w)

    uncovered = []
    for prefix, group in sorted(workflows_by_prefix.items()):
        if prefix in curated_prefixes:
            continue
        for w in group:
            uncovered.append({"file": w["file"], "name": w["name"], "version": prefix})

    stale = sorted(curated_prefixes - set(workflows_by_prefix))

    return {
        "uncovered_workflows":   uncovered,
        "stale_curation":        stale,
        # First few non-workflow entries — enough to confirm the system
        # recognised them; not a comprehensive list.
        "non_workflow_entries":  non_workflow[:8],
        "uncovered_workflows_count": len(uncovered),
        "stale_curation_count":      len(stale),
    }


def main() -> None:
    workflows = build_inventory()
    drift = compute_drift(workflows)
    payload = {
        "generated_at": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "count": len(workflows),
        "workflows": workflows,
        "drift": drift,
    }
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(
        f"[workflow-inventory] wrote {OUT_PATH.relative_to(ROOT)} "
        f"({len(workflows)} workflows, {len(drift['uncovered_workflows'])} uncovered, "
        f"{len(drift['stale_curation'])} stale)",
    )


if __name__ == "__main__":
    main()
