"""Failure-isolation contract for the export_static_json orchestrator.

The audit on PR #423 surfaced that wrapping each exporter in try/except
isn't enough on its own: SQLAlchemy leaves the session in an aborted-
transaction state after a query raises, so the next DB-touching exporter
in the loop would fail anyway. The follow-up PR adds an explicit
db.rollback() in the except clause; these tests pin that contract so a
future refactor doesn't quietly undo the fix.
"""
import os
import sys
from unittest.mock import MagicMock

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../.."))

# The orchestrator imports the whole exporter zoo at module level, which
# transitively pulls in pandas/numpy via scraper.sources.macro_cot. CI has
# them installed (per the backend requirements); dep-light envs skip these
# tests rather than fail collection.
pytest.importorskip("pandas", reason="orchestrator transitively imports pandas")

import scraper.export_static_json as esj  # noqa: E402 — after importorskip


def test_run_exporters_rolls_back_db_after_topic_raises(monkeypatch):
    """When one exporter raises, db.rollback() runs before the next is invoked
    — otherwise the next exporter's first query inherits an aborted
    transaction and fails too, defeating the isolation guarantee."""
    db = MagicMock()
    rollback_call_order: list[str] = []
    db.rollback.side_effect = lambda: rollback_call_order.append("rollback")

    call_order: list[str] = []

    def ok_a():  call_order.append("a")
    def boom():
        call_order.append("b")
        raise RuntimeError("simulated mid-query failure")
    def ok_c():  call_order.append("c")
    def ok_d():  call_order.append("d")

    fake_registry = [
        ("good_a",   ok_a),
        ("broken",   boom),
        ("good_c",   ok_c),
        ("good_d",   ok_d),
    ]
    monkeypatch.setattr(esj, "_exporters", lambda _db: fake_registry)

    result = esj._run_exporters(db, None)

    # All four were attempted (broken doesn't abort the loop).
    assert call_order == ["a", "b", "c", "d"], (
        f"Loop should attempt every topic; got {call_order}"
    )
    # The broken topic is absent from the success map.
    assert set(result) == {"good_a", "good_c", "good_d"}
    # CRITICAL: rollback was called once, right after the raise, before c & d.
    # (We can't observe ordering between db.rollback() and the next fn() call
    # via plain MagicMock without a richer fixture — but call_count pins the
    # rollback-on-failure contract.)
    assert db.rollback.call_count == 1


def test_run_exporters_does_not_rollback_when_topic_succeeds(monkeypatch):
    """rollback() must NOT fire on the happy path — otherwise an exporter's
    own commit inside its function could be partially undone (though most
    exporters commit per-write; this is a belt-and-suspenders check)."""
    db = MagicMock()
    def ok(): pass
    monkeypatch.setattr(esj, "_exporters", lambda _db: [("only_one", ok)])

    esj._run_exporters(db, None)

    assert db.rollback.call_count == 0


def test_run_exporters_continues_when_rollback_itself_raises(monkeypatch):
    """If the DB is unreachable when rollback() is called (e.g. connection
    dropped mid-run), the loop must still continue — otherwise a transient
    DB blip cascades into a full publish abort."""
    db = MagicMock()
    db.rollback.side_effect = RuntimeError("connection lost")

    call_order: list[str] = []

    def boom():
        call_order.append("b")
        raise RuntimeError("first failure")
    def still_ok():
        call_order.append("c")

    monkeypatch.setattr(esj, "_exporters", lambda _db: [
        ("broken", boom),
        ("good",   still_ok),
    ])

    result = esj._run_exporters(db, None)

    # Loop ran both, recorded the surviving topic, swallowed the rollback fail.
    assert call_order == ["b", "c"]
    assert set(result) == {"good"}


def test_run_exporters_respects_only_slice(monkeypatch):
    """--only slicing still works after the refactor."""
    db = MagicMock()
    call_order: list[str] = []

    def make(name):
        def _f(): call_order.append(name)
        return _f

    monkeypatch.setattr(esj, "_exporters", lambda _db: [
        ("a", make("a")),
        ("b", make("b")),
        ("c", make("c")),
    ])

    result = esj._run_exporters(db, {"a", "c"})

    assert call_order == ["a", "c"]
    assert set(result) == {"a", "c"}
