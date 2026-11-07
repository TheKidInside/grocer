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

1. Create an API key at https://console.anthropic.com (set a monthly spend limit).
2. In the app: Settings (gear) -> paste the key -> Save.

The key stays on your device and is sent only to Anthropic.

## Test

```
py -3 tests\e2e.py http://localhost:8790/
```

Drives the real UI in headless Chromium with a fake AI module, so it costs nothing.

See [docs/HOW_IT_WORKS.md](docs/HOW_IT_WORKS.md) for a walkthrough of the code.
