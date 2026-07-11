from __future__ import annotations

import html
import os

import requests

TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")


def esc(text: object) -> str:
    """Escape scraped/free text before it goes into a parse_mode=HTML message.

    Telegram parses `<`, `>`, `&` as markup, so an un-escaped scraped string
    (an event title, a region name) either breaks the whole sendMessage with a
    400 (dropping the brief silently) or injects unintended tags. quote=False
    keeps this for text nodes — our own template tags are written literally and
    must not be passed through here.
    """
    return html.escape("" if text is None else str(text), quote=False)


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
