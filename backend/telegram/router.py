from __future__ import annotations
from fastapi import APIRouter, Request, Response
from telegram.auth import is_allowed
from telegram.sender import send_message
from telegram.commands import DISPATCH

router = APIRouter()


def _parse_command(text: str) -> tuple[str, str]:
    """Split '/command args' → ('command', 'args'). Strips @BotName suffix."""
    text = text.strip()
    if not text.startswith("/"):
        return "", text
    parts = text[1:].split(None, 1)
    cmd  = parts[0].split("@")[0].lower()
    args = parts[1] if len(parts) > 1 else ""
    return cmd, args


@router.post("/webhook")
async def webhook(request: Request):
    update = await request.json()

    if not is_allowed(update):
        return Response(status_code=200)

    message = update.get("message", {})
    text    = message.get("text", "")
    chat_id = message.get("chat", {}).get("id")

    if not text or not chat_id:
        return Response(status_code=200)

    cmd, args = _parse_command(text)
    if not cmd:
        return Response(status_code=200)

    handler = DISPATCH.get(cmd)
    if handler is None:
        reply = "Unknown command. /help for list."
    else:
        try:
            context = {"chat_id": chat_id, "message": message}
            reply = handler(args, context)
        except Exception as e:
            reply = f"Error running /{cmd}: {e}"

    send_message(chat_id, reply)
    return Response(status_code=200)
