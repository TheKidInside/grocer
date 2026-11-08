# Grocer

A grocery tracker for the phone: know what's in the pantry, what's running low,
what to buy, and what groceries cost.

- **Pantry** - items with quantity, unit, location, expiry; +/- as you use things.
- **List** - built automatically from anything low or out, with an estimated cost; add extras by hand.
- **Cart** (top of the List tab) - in the store, photograph each item with its shelf price tag: Grocer reads the item, price and store, keeps a running total, and ticks the item off the list. Check out saves the trip to the pantry and spending in one go (instead of scanning that trip's receipt).
- **Scan** - photograph a receipt (restocks the pantry and logs the spend) or groceries themselves (names, counts, sizes, best-before dates). Photos are read by Claude using your own Anthropic API key.
- **Spend** - monthly total, 6-month trend, by category, by store, and price changes per item.

No build step and no server: static files, data stored in the browser.

## Run locally

```
start.cmd        # http://localhost:8790
```

## Reading receipts and groceries

Three readers, picked in Settings (gear) -> "Read photos with":

| | On this device (no AI) - default | Claude (Anthropic) | Qwen on this PC |
|---|---|---|---|
| Works on | any device, incl. phone | any device | only the PC running it |
| Cost | free | a few cents a scan | free |
| Receipts | text read on the phone + rules; learns your corrections | best | good |
| Groceries | barcode scanning + Open Food Facts | photo of the whole bench | photo of the whole bench |
| Setup | none | API key from https://console.anthropic.com | run `C:\Artificial\tools\llm\start-qwen.cmd` |

- **No AI:** the first receipt downloads the text reader (a few MB, once). Fix a line once on the review screen and the same line matches automatically next time. Barcodes not in Open Food Facts are named once and remembered.
- The API key stays on your device and is sent only to Anthropic. Qwen photos never leave the PC; the browser may ask to allow "local network access" for it.

## Test

```
py -3 tests\e2e.py http://localhost:8790/            # whole app; fake AI, real on-device receipt reading
py -3 tests\camera_barcode.py http://localhost:8790/  # camera barcode scan via a fake webcam
```

Both drive the real UI in headless Chromium and cost nothing.

See [docs/HOW_IT_WORKS.md](docs/HOW_IT_WORKS.md) for a walkthrough of the code.
