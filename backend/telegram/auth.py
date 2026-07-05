from __future__ import annotations

import hmac
import os


def webhook_secret_ok(header_value: str | None) -> bool:
    """Verify Telegram's X-Telegram-Bot-Api-Secret-Token header (constant-time).

    Telegram echoes the `secret_token` we registered via setWebhook (see
    telegram.setup) on every delivery. Without this, /webhook trusts only a body
    chat-id that anyone can forge. Set TELEGRAM_WEBHOOK_SECRET and re-run
    `python -m telegram.setup` to enable enforcement.

    Fails OPEN only when the secret is UNSET — so deploying this code can't take a
    live bot offline before the secret is configured (the is_allowed() body gate
    still applies). Once the secret is set it fails CLOSED on any mismatch.
    """
    expected = os.getenv("TELEGRAM_WEBHOOK_SECRET", "")
    if not expected:
        return True
    return hmac.compare_digest(str(header_value or ""), expected)


def is_allowed(update: dict) -> bool:
    chat_id = str(update.get("message", {}).get("chat", {}).get("id", ""))
    raw = os.getenv("TELEGRAM_ALLOWED_IDS", "")
    allowed = {x.strip() for x in raw.split(",") if x.strip()}
    return chat_id in allowed
