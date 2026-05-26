from __future__ import annotations

import os

import requests

TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")


def send_message(chat_id: str | int, text: str, parse_mode: str = "HTML") -> bool:
    if not TELEGRAM_BOT_TOKEN:
        print("[telegram] TELEGRAM_BOT_TOKEN not set")
        return False
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    resp = requests.post(
        url,
        data={"chat_id": chat_id, "text": text, "parse_mode": parse_mode},
        timeout=15,
    )
    if resp.ok:
        return True
    print(f"[telegram] sendMessage error: {resp.status_code} {resp.text[:200]}")
    return False
