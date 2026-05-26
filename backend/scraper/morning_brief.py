"""
morning_brief.py
Sends a daily Telegram morning brief. Message is built by telegram/handlers/brief.py.

Required env vars:
  TELEGRAM_BOT_TOKEN  — from @BotFather
  TELEGRAM_CHAT_ID    — your chat or group id
  DATABASE_URL        — postgres DSN (optional, unused now but kept for compat)

Optional env vars:
  DATA_DIR            — path to frontend/public/data (auto-detected from repo root)
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import requests

# ── Path setup ─────────────────────────────────────────────────────────────────
_REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_REPO_ROOT / "backend"))

TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID   = os.environ.get("TELEGRAM_CHAT_ID", "")


# ── Message builder ───────────────────────────────────────────────────────────

def build_message(db=None) -> str:
    from telegram.handlers.brief import build_brief_message
    return build_brief_message(db)


def send_telegram(text: str) -> bool:
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        print("[morning_brief] TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set")
        return False
    url  = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    resp = requests.post(url, data={
        "chat_id":    TELEGRAM_CHAT_ID,
        "text":       text,
        "parse_mode": "HTML",
    }, timeout=15)
    if resp.ok:
        print("[morning_brief] Telegram message sent OK")
        return True
    print(f"[morning_brief] Telegram error: {resp.status_code} {resp.text[:200]}")
    return False


def main():
    db = None
    database_url = os.environ.get("DATABASE_URL")
    if database_url:
        try:
            from database import SessionLocal
            db = SessionLocal()
        except Exception as e:
            print(f"[morning_brief] DB connect failed: {e}")

    try:
        msg = build_message(db)
        print("[morning_brief] Message preview:\n")
        print(msg.encode("ascii", "replace").decode())
        print()
        send_telegram(msg)
    finally:
        if db:
            db.close()


if __name__ == "__main__":
    main()
