# Telegram Bot Overhaul Design

## Goal

Transform one-way morning brief into interactive two-way Telegram bot: redesigned daily summary, command parser for report topics and price quotations, manual scraper triggers via GitHub Actions.

---

## 1. Architecture

**Option B (chosen): dedicated `backend/telegram/` module**

```
backend/
  telegram/
    __init__.py
    router.py        # FastAPI route POST /telegram/webhook
    commands.py      # dispatch table: command name → handler function
    handlers/
      quote.py       # /quote parser + formatter
      cot.py         # /cot formatter
      prices.py      # /prices formatter
      brazil.py      # /brazil formatter
      kaffeesteuer.py
      ecf.py
      run.py         # /run → GitHub Actions dispatch
      brief.py       # /brief on-demand (reuses morning_brief logic)
      help.py        # /help static response
    auth.py          # allowlist check (TELEGRAM_ALLOWED_IDS env var)
    sender.py        # sendMessage helper (extracted from morning_brief.py)
  scraper/
    morning_brief.py # existing, refactored to call brief.py handler
```

`morning_brief.py` refactored: imports `build_brief_message()` from `telegram/handlers/brief.py`, sends via `sender.py`. No duplication.

FastAPI app registers the router: `app.include_router(telegram_router, prefix="/telegram")`.

Webhook registered once at deploy time via `backend/telegram/setup.py` (called in startup event or manually).

---

## 2. Command Registry

| Command | Description |
|---|---|
| `/brief` | On-demand morning brief (same as daily cron) |
| `/quote [basis=N] [eudr] [rfa] [4c] [bb] [jute]` | Robusta price quotation |
| `/cot` | Full COT report (KC + RC) |
| `/prices` | Current prices ticker |
| `/brazil` | Brazil daily registration |
| `/kaffeesteuer` | German coffee clearances |
| `/ecf` | European port stocks |
| `/run <scraper>` | Trigger scraper via GitHub Actions |
| `/help` | Command list |

Unknown command → `"Unknown command. /help for list."`

---

## 3. Morning Brief Format

Sent 06:00 CET daily. Target: ~20 lines, scannable.

```
☕ Coffee Intel · Mon 26 May

RC   3,487  ▲+42    (RMN26)
KC   3.24   ▼−0.08  (KCN26)
VN FAQ  92,400 VND · N−40 (incl. +100 logistics)

COT KC (wk 20 May):
Price ▲ xx cents/lb · OI ▼ xx,xxx
Roasters ▼ xx,xxx · Producers ▲ xx,xxx
MM net +18,420 ▲+1,240

COT RC (wk 20 May):
Price ▼ $xxx · OI ▼ xx,xxx
Roasters ▲ xx,xxx · Producers ▼ xx,xxx
MM net −4,130 ▼−890

Brazil daily reg (14 May): 1,025,329 bags
MoM: ▲+186,333 Arabica · ▼−12,400 Conilon · ▲+800 Soluble

Cauca drought risk · Minas frost window opens Jun

/quote · /cot · /brazil · /ecf
```

### Data sources

| Field | Source |
|---|---|
| RC price + delta | `futures_chain.json` → front contract last vs prev |
| KC price + delta | `latest_prices.json` ticker `KC` |
| VN FAQ VND | `latest_prices.json` ticker `VN FAQ` (VND figure) |
| VN FAQ differential | `(VN_FAQ_USD − RC_front_price) + 100` where +100 = logistics/middlemen margin |
| COT KC | `cot_recent.json` → latest row with `ny` data |
| COT RC | `cot_recent.json` → latest row with `ldn` data |
| COT direction arrows | Compare latest vs prior row: price, OI, roaster net, producer net, MM net |
| Brazil daily reg | `cecafe_daily.json` → most recent month, last available day, cumulative total |
| Brazil MoM | Same day-of-month count vs prior month, per type (arabica, conillon, soluvel) |
| Weather | `weather.json` or equivalent (existing brief logic) |

### VN FAQ differential computation

```python
vn_faq_usd = parse_usd_from_ticker("VN FAQ")   # from latest_prices.json
vn_faq_vnd = parse_vnd_from_ticker("VN FAQ")   # from same source
rc_front_price = chain['robusta']['contracts'][0]['last']  # front contract
front_letter = SHIPMENT_TO_CONTRACT[front_month]
diff = round(vn_faq_usd - rc_front_price + 100)
diff_str = f"N{diff:+d}" if diff else "N±0"
```

### COT direction logic

For each field (price, OI, roasters net, producers net, MM net):
```python
arrow = "▲" if current > previous else "▼" if current < previous else "→"
```
WoW delta shown for MM net only: `▲+1,240` or `▼−890`.

### Brazil daily reg computation

```python
# cecafe_daily.json structure: {arabica: {YYYY-MM: {day: cumulative_bags}}}
latest_month = sorted(data['arabica'].keys())[-1]
latest_day = sorted(data['arabica'][latest_month].keys(), key=int)[-1]

total = sum(data[t][latest_month][latest_day] for t in ['arabica','conillon','soluvel'])
prev_month = prior_month(latest_month)
prev_day = closest_available_day(data['arabica'][prev_month], latest_day)

mom_arab = data['arabica'][latest_month][latest_day] - data['arabica'][prev_month][prev_day]
# etc.
```

---

## 4. /quote Command

### Parser

```
/quote [basis=N] [eudr] [rfa] [4c] [bb] [jute]
```

- `basis=N`: override default basis (signed integer, e.g. `basis=-140`, `basis=+50`)
- Default basis: `round(VN_FAQ_USD − RC_front_price)` (no logistics offset — raw market differential)
- Unknown tokens: ignored silently

### Output format

```
Robusta Quotation
Basis: RMN26 −105 (VN FAQ ref)

N = 3,487  (front)
U = 3,372  (+115)
X = 3,292  (+80)
F = 3,222  (+70)

Quality: Basis G2 [EUDR] [RFA] [4C]
Packing: Bulk | Big bags | Jute bags

Shipment & price:
  Jun-26  N−105
  Jul-26  N−75
  Aug-26  U+55
  Sep-26  U+85
  Oct-26  X+163
  Nov-26  X+193
  Dec-26  F+261
  Jan-27  F+291

/quote basis=+50 → adjusts all rows
/quote basis=-140 eudr rfa bb
```

### Contract legend

Unique RC contract letters in the 8-month window, in order of first appearance. Show last price and spread vs previous contract.

```python
seen = {}
for m in months:
    letter = SHIPMENT_TO_CONTRACT[m.month]
    if letter not in seen:
        seen[letter] = rc_prices[letter]
```

Front labeled `(front)`. Each subsequent: `(+{spread})` where `spread = round(prev_price − curr_price)`.

### Differential per shipment month

```python
SHIPMENT_TO_CONTRACT = {1:"H",2:"H",3:"K",4:"K",5:"N",6:"N",7:"U",8:"U",9:"X",10:"X",11:"F",12:"F"}

offset = 1 if today.day >= 14 else 0
cum_spread = 0
last_letter = None

for i, m in enumerate(8_months):
    letter = SHIPMENT_TO_CONTRACT[m.month]
    if last_letter and letter != last_letter:
        cum_spread += round(rc_prices[last_letter] - rc_prices[letter])
    last_letter = letter
    diff = basis + i * 30 + cum_spread
    display = f"{letter}{diff:+d}"   # e.g. "N−105", "U+55"
```

`i * 30`: carry cost accrual (30 USD/MT per month).

### Add-on stacking

| Keyword | Add to differential | Label |
|---|---|---|
| `eudr` | +50 | EUDR |
| `rfa` | +60 | RFA |
| `4c` | +15 | 4C |
| `bb` | +15 | Big bags |
| `jute` | +25 | Jute bags |

All add-ons applied uniformly across all shipment months. Multiple cert keywords combine in Quality label. `bb` and `jute` are mutually exclusive in practice but not enforced.

### Quality label assembly

```python
certs = [k.upper() for k in ['eudr','rfa','4c'] if k in args]
quality = "Basis G2" + (" " + " ".join(certs) if certs else "")

if 'bb' in args: packing = "Big bags"
elif 'jute' in args: packing = "Jute bags"
else: packing = "Bulk"
```

---

## 5. /cot Command

Full COT report for both markets.

```
COT Report (wk 20 May 2026)

── NY Arabica (KC) ──
MM net:      +18,420  ▲+1,240 WoW
MM longs:    52,300
MM shorts:   33,880
Producers:   −41,200  ▼−800 WoW
  shorts: 68,400 / longs: 27,200
OI:          312,400  ▲+4,100

── London Robusta (RC) ──
MM net:      −4,130   ▼−890 WoW
MM longs:    18,200
MM shorts:   22,330
Producers:   −28,400  ▲+600 WoW
  shorts: 44,100 / longs: 15,700
OI:          (data pending next release)
```

Source: `cot_recent.json`. Latest two rows with data → WoW delta.

---

## 6. /run Command

```
/run prices
/run cot
/run cecafe
/run kaffeesteuer
/run ecf
/run brief
```

Allowed scrapers map to workflow filenames:
```python
SCRAPER_WORKFLOWS = {
    "prices":      "scrape-prices.yml",
    "cot":         "scrape-cot.yml",
    "cecafe":      "scrape-cecafe.yml",
    "kaffeesteuer":"scrape-kaffeesteuer.yml",
    "ecf":         "scrape-ecf.yml",
    "brief":       "morning-brief.yml",
}
```

GitHub API call:
```python
import httpx
resp = httpx.post(
    f"https://api.github.com/repos/{GH_OWNER}/{GH_REPO}/actions/workflows/{workflow}/dispatches",
    headers={"Authorization": f"Bearer {GH_PAT}", "Accept": "application/vnd.github+json"},
    json={"ref": "main"},
)
```

Response to user:
- 204 → `"✓ Triggered prices scraper. Results in ~2 min."`
- 4xx/5xx → `"Failed to trigger (HTTP {status}). Check GH_PAT and workflow name."`
- Unknown scraper name → `"Unknown scraper. Options: prices, cot, cecafe, kaffeesteuer, ecf, brief"`

---

## 7. Authentication

Env var: `TELEGRAM_ALLOWED_IDS` = comma-separated Telegram chat IDs (e.g. `"123456789"`).

Every webhook request:
```python
def is_allowed(update: dict) -> bool:
    chat_id = str(update.get("message", {}).get("chat", {}).get("id", ""))
    allowed = os.getenv("TELEGRAM_ALLOWED_IDS", "").split(",")
    return chat_id in [x.strip() for x in allowed]
```

Denied requests: HTTP 200 returned (Telegram spec), no reply sent. Avoids retry storms.

Adding users: add chat ID to `TELEGRAM_ALLOWED_IDS` on Render, redeploy (or use Render env var live update).

---

## 8. Webhook Setup

`backend/telegram/setup.py` — one-time registration:
```python
import httpx, os
TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]
URL = os.environ["BACKEND_PUBLIC_URL"]  # e.g. https://coffee-intel.onrender.com
httpx.post(f"https://api.telegram.org/bot{TOKEN}/setWebhook",
           json={"url": f"{URL}/telegram/webhook"})
```

Run manually after deploy or hook into FastAPI `lifespan` startup (idempotent — Telegram ignores duplicate `setWebhook` to same URL).

---

## 9. Error Handling

| Scenario | Behavior |
|---|---|
| JSON file missing/corrupt | Return `"Data unavailable. Run /run <scraper> to refresh."` |
| RC front price missing | `/quote` returns `"RC front price not available."` |
| COT data empty | `/cot` returns `"No COT data available yet."` |
| GitHub API timeout | `/run` returns `"Trigger timed out. Try again."` |
| Telegram sendMessage fails | Log error, do not raise (morning brief) |
| Unrecognized command | `"Unknown command. /help for list."` |

---

## 10. New Environment Variables Required

| Variable | Purpose |
|---|---|
| `GH_PAT` | GitHub fine-grained PAT, Actions:write scope |
| `GH_OWNER` | GitHub repo owner (e.g. `loicscanu`) |
| `GH_REPO` | GitHub repo name (e.g. `Coffee-intel-map`) |
| `TELEGRAM_ALLOWED_IDS` | Comma-separated allowed chat IDs |
| `BACKEND_PUBLIC_URL` | Render public URL for webhook registration |

Existing: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `DATABASE_URL`.

---

## 11. Out of Scope

- Per-user preferences or state persistence
- Inline keyboard buttons / rich Telegram UI
- Multiple chat groups (allowlist covers future addition)
- Rate limiting (single user, not needed now)
