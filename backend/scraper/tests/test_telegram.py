import os
import sys

# Ensure backend/ is on path for all tests
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../../backend"))


def test_is_allowed_match(monkeypatch):
    monkeypatch.setenv("TELEGRAM_ALLOWED_IDS", "111,222")
    from telegram.auth import is_allowed
    assert is_allowed({"message": {"chat": {"id": 111}}}) is True


def test_is_allowed_miss(monkeypatch):
    monkeypatch.setenv("TELEGRAM_ALLOWED_IDS", "111")
    from telegram.auth import is_allowed
    assert is_allowed({"message": {"chat": {"id": 999}}}) is False


def test_is_allowed_empty_env(monkeypatch):
    monkeypatch.setenv("TELEGRAM_ALLOWED_IDS", "")
    from telegram.auth import is_allowed
    assert is_allowed({"message": {"chat": {"id": 111}}}) is False


def test_is_allowed_missing_message():
    from telegram.auth import is_allowed
    assert is_allowed({}) is False


def test_cot_handle_no_data(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    import importlib

    import telegram.data as td
    importlib.reload(td)
    import telegram.handlers.cot as cot_mod
    importlib.reload(cot_mod)
    result = cot_mod.handle("", {})
    assert "No COT data" in result


def test_quote_parse_defaults():
    from telegram.handlers.quote import parse_args
    a = parse_args("")
    assert a["basis"] is None
    assert a["eudr"] is False
    assert a["bb"] is False


def test_quote_parse_basis():
    from telegram.handlers.quote import parse_args
    assert parse_args("basis=-140")["basis"] == -140
    assert parse_args("basis=+50")["basis"] == 50


def test_quote_parse_addons():
    from telegram.handlers.quote import parse_args
    a = parse_args("eudr rfa bb")
    assert a["eudr"] is True
    assert a["rfa"] is True
    assert a["bb"] is True
    assert a["jute"] is False


def test_quote_differential():
    from telegram.handlers.quote import compute_months
    # today_month=5 (May), offset=0 → i=0→May(N), i=1→Jun(N), same contract
    rows = compute_months(basis=-100, rc_prices={"N": 3487, "U": 3372, "X": 3292, "F": 3222},
                          today_month=5, today_day=1, addons=0)
    assert rows[0][2] == -100   # May: basis + 0*30
    assert rows[1][2] == -70    # Jun: basis + 1*30


def test_parse_command():
    from telegram.router import _parse_command
    assert _parse_command("/quote basis=-140 eudr") == ("quote", "basis=-140 eudr")
    assert _parse_command("/help") == ("help", "")
    assert _parse_command("/quote@CoffeeBot basis=+50") == ("quote", "basis=+50")
    assert _parse_command("hello") == ("", "hello")
