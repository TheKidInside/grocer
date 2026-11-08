# Grocer

A grocery tracker for the phone: know what's in the pantry, what's running low,
what to buy, and what groceries cost.

- **Home** - this week's grocery spend against your weekly budget, what to use soon, and what is running low.
- **Pantry** - items with quantity, unit, location, expiry; +/- as you use things; filter by fridge/freezer/pantry, expiring or low.
- **List** - built automatically from anything low or out, grouped by aisle, with an estimated cost against what is left of the week's budget; add extras by hand ("2 lemons").
- **Cart** (on the List tab) - in the store, photograph each item with its shelf price tag: Grocer reads the item, price and store, keeps a running total, and ticks the item off the list. Check out saves the trip to the pantry and spending in one go (instead of scanning that trip's receipt).
- **Scan** (the round button in the middle) - photograph a receipt (restocks the pantry and logs the spend), scan barcodes, or with an AI reader photograph the groceries themselves (names, counts, sizes, best-before dates).
- **Spend** - week, month or year: total vs the period before, a trend chart with the budget line, by category, price rises and drops, by store, and every trip.

No build step and no server: static files, data stored in the browser.

## Run locally

```
start.cmd        # http://localhost:8790
```

## Reading receipts and groceries

Four readers, picked in Settings (gear) -> "Read photos with":

| | On this device (no AI) - default | Gemini (Google) | Claude (Anthropic) | Qwen on this PC |
|---|---|---|---|---|
| Works on | any device, incl. phone | any device | any device | only the PC running it |
| Cost | free | a cent or less a scan (free allowance) | a few cents a scan | free |
| Receipts | text read on the phone + rules; learns your corrections | very good (77/77 on a long Puregold receipt) | best | good |
| Shelf tags (cart) | finds the tag, reads the price; names can garble | ~6 s, reads the pack too | reads the pack too | reads the pack too |
| Groceries | barcode scanning + Open Food Facts | photo of the whole bench | photo of the whole bench | photo of the whole bench |
| Setup | none | API key from https://aistudio.google.com | API key from https://console.anthropic.com | run `C:\Artificial\tools\llm\start-qwen.cmd` |

Keys are typed into Settings on each device and never leave it except to their own service. `tests\gemini_live.py` checks the real Gemini API (key from the `GEMINI_KEY` environment variable).

- **No AI:** the first receipt downloads the text reader (a few MB, once). Fix a line once on the review screen and the same line matches automatically next time. Barcodes not in Open Food Facts are named once and remembered.
- The API key stays on your device and is sent only to Anthropic. Qwen photos never leave the PC; the browser may ask to allow "local network access" for it.

## Test

```
py -3 tests\e2e.py http://localhost:8790/            # whole app; fake AI, real on-device receipt reading
py -3 tests\camera_barcode.py http://localhost:8790/  # camera barcode scan via a fake webcam
```

Both drive the real UI in headless Chromium and cost nothing.

See [docs/HOW_IT_WORKS.md](docs/HOW_IT_WORKS.md) for a walkthrough of the code.
