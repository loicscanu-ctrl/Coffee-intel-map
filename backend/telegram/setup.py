"""
One-time webhook registration.

Usage:
  TELEGRAM_BOT_TOKEN=xxx BACKEND_PUBLIC_URL=https://your-app.onrender.com \
  TELEGRAM_WEBHOOK_SECRET=<random> python -m telegram.setup

Idempotent — safe to run multiple times (Telegram ignores duplicate setWebhook to same URL).
TELEGRAM_WEBHOOK_SECRET must match the value the backend process reads (router.py
verifies the X-Telegram-Bot-Api-Secret-Token header against it).
"""
import os

import requests

TOKEN  = os.environ["TELEGRAM_BOT_TOKEN"]
URL    = os.environ["BACKEND_PUBLIC_URL"]
SECRET = os.environ.get("TELEGRAM_WEBHOOK_SECRET", "")

webhook_url = f"{URL.rstrip('/')}/telegram/webhook"
payload = {"url": webhook_url}
if SECRET:
    payload["secret_token"] = SECRET
else:
    print("WARNING: TELEGRAM_WEBHOOK_SECRET unset — registering WITHOUT a secret "
          "token; /webhook stays spoofable. Set it and re-run.")

resp = requests.post(
    f"https://api.telegram.org/bot{TOKEN}/setWebhook",
    json=payload,
    timeout=10,
)
data = resp.json()
print(f"setWebhook → {resp.status_code}: {data.get('description', data)}  "
      f"(secret_token: {'set' if SECRET else 'NONE'})")
