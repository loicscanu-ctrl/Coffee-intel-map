"""
One-time webhook registration.

Usage:
  TELEGRAM_BOT_TOKEN=xxx BACKEND_PUBLIC_URL=https://your-app.onrender.com python -m telegram.setup

Idempotent — safe to run multiple times (Telegram ignores duplicate setWebhook to same URL).
"""
import os
import requests

TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]
URL   = os.environ["BACKEND_PUBLIC_URL"]

webhook_url = f"{URL.rstrip('/')}/telegram/webhook"
resp = requests.post(
    f"https://api.telegram.org/bot{TOKEN}/setWebhook",
    json={"url": webhook_url},
    timeout=10,
)
data = resp.json()
print(f"setWebhook → {resp.status_code}: {data.get('description', data)}")
