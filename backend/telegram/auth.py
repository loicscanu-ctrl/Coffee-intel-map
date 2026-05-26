from __future__ import annotations
import os


def is_allowed(update: dict) -> bool:
    chat_id = str(update.get("message", {}).get("chat", {}).get("id", ""))
    raw = os.getenv("TELEGRAM_ALLOWED_IDS", "")
    allowed = {x.strip() for x in raw.split(",") if x.strip()}
    return chat_id in allowed
