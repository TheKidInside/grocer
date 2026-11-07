# Larder

A grocery tracker for the phone: know what's in the pantry, what's running low,
what to buy, and what groceries cost.

- **Pantry** - items with quantity, unit, location, expiry; +/- as you use things.
- **List** - built automatically from anything low or out, with an estimated cost; add extras by hand.
- **Scan** - photograph a receipt (restocks the pantry and logs the spend) or groceries themselves (names, counts, sizes, best-before dates). Photos are read by Claude using your own Anthropic API key.
- **Spend** - monthly total, 6-month trend, by category, by store, and price changes per item.

No build step and no server: static files, data stored in the browser.

## Run locally

```
start.cmd        # http://localhost:8790
```

## Set up photo scanning

Two readers, picked in Settings (gear) -> "Read photos with":

| | Claude (Anthropic) | Qwen on this PC |
|---|---|---|
| Works on | any device, incl. phone | only the PC running it |
| Cost | a few cents a scan | free |
| Accuracy | best | good; misreads some multi-buy and weighed lines |
| Setup | API key from https://console.anthropic.com (set a spend limit) | run `C:\Artificial	ools\llm\start-qwen.cmd` (loads the vision file `--mmproj`) |

The API key stays on your device and is sent only to Anthropic. Qwen photos never leave the PC.
The first time the hosted page calls Qwen, the browser may ask to allow access to devices on your local network: allow it.

## Test

```
py -3 tests\e2e.py http://localhost:8790/
```

Drives the real UI in headless Chromium with a fake AI module, so it costs nothing.

See [docs/HOW_IT_WORKS.md](docs/HOW_IT_WORKS.md) for a walkthrough of the code.
