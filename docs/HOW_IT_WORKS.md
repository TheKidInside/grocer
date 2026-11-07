# Larder - How It Works (a learning walkthrough)

This doc explains **how the grocery tracker is built and why**, then walks the
code file by file. Read it next to the code; every section names the function it
describes.

> How to read it: **Part 1** is the mental model. **Part 2** is the few techniques
> that repeat everywhere. **Part 3** goes file by file. **Part 4** traces one
> receipt scan through every layer.

---

## Part 0 - Run it

```
start.cmd                                  # serves http://localhost:8790 and opens it
py -3 tests\e2e.py                         # drives the real UI in a headless browser
py -3 tests\e2e.py http://localhost:8790/ shots\   # same, plus screenshots
```

No build step, no `npm install`. It is a handful of static files. The only things fetched
from the internet are two Google Fonts and, when you scan a photo, the Anthropic
SDK from the jsDelivr CDN.

Why `start.cmd` instead of double-clicking `index.html`: the app uses ES modules
(`import ... from './store.js'`), and browsers refuse to load modules from
`file://`. Any static web server works; GitHub Pages is one.

---

## Part 1 - The big picture

### 1.1 Three layers

```
  DATA + RULES   store.js     the shape of the data, load/save, and the pure rules
                               (is this item low? how much should I buy?)
       │
  UI             app.js       four tabs rendered from one state object, plus events
       │
  READERS (lazy) ai.js        shrink a photo; Claude or Qwen read it, return JSON
                 ocr.js       no-AI receipts: read text on the device, rules -> lines
                 barcode.js   no-AI groceries: camera barcodes + Open Food Facts
```

All three readers return the **same shape** (`{store, date, total, lines[]}` for
a receipt), so the review screen never knows which one answered. Analogy: three
cashiers at different tills, one shared docket format.

**The rule: `store.js` knows nothing about the screen.** `statusOf`, `needOf`,
`stepOf` are plain functions of an item. That is why the shopping list never
needs its own storage: it is *computed* from the pantry every time it is drawn.

Analogy: the pantry is the bank balance; the shopping list is the "below minimum
balance" alert. You never store the alert, you derive it.

### 1.2 One state object, one save point

Everything the app knows sits in one object:

```js
{ items: [...], purchases: [...], extras: [...], checked: {...}, settings: {...} }
```

It is loaded once from `localStorage` (`load()`), changed in place by event
handlers, then written back by `commit()`. There is no other place data is
written. If you want to know "where could this value have changed?", search for
`commit()`.

### 1.3 The three numbers on every item

| Field | Meaning | Used for |
|---|---|---|
| `qty` | what is on hand now | the +/- buttons |
| `low` | alert level | `statusOf`: `qty <= low` means "Low"; `qty <= 0` means "Out" |
| `par` | ideal stock | `needOf`: buy `par - qty` to top back up |

`low = 0` means "only tell me when it's gone". Items created from a receipt or a
photo start at `low = 0, par = what you bought`, so they don't immediately appear
on the list; you tune them later.

### 1.4 Where the money comes from

Spending is recorded as **purchases** (trips), never guessed. A receipt scan
creates a purchase whose lines carry a category; the difference between the
receipt total and the ticked lines (discounts, bags, things you unticked) is
shown as "Adjustments", so the month total always equals what you actually paid.
Each receipt line also records a **price per unit** on the item (`recordPrice`),
which feeds the shopping-list estimate and the "Price changes" panel.

---

## Part 2 - Techniques that repeat

### 2.1 Render = string templates + `innerHTML`

Each tab is a function returning an HTML string (`viewPantry`, `viewList`,
`viewScan`, `viewSpend`). `render()` picks the current one and assigns it to
`#view`. Simple and fast enough for hundreds of items.

Two consequences you must respect:

- **Escape everything user-typed** with `esc()` before it goes into the string,
  or an item named `<img onerror=...>` would run code.
- **Re-rendering destroys focus.** So the search box does *not* call `render()`;
  it calls `refreshPantryList()`, which only replaces the list under it. Same
  idea on the receipt review: typing in a price updates only `#scan-totals`.

### 2.2 Event delegation

There is one `click` listener on `document`. Buttons say what they do with
`data-act="inc"` and carry `data-id`. The `switch (act)` in that listener is the
app's whole command table; read it top to bottom to see every action.

### 2.3 The modal

One `<dialog>` holds a `<form>`. `openModal(html, onSubmit)` fills it; pressing
Save fires `submit`, which calls `onSubmit(new FormData(form))`. Returning
`false` keeps the dialog open (used for validation).

### 2.4 Lazy loading the AI

`ai.js` is imported with `await import('./ai.js')` only when you scan. The
pantry, list and spend views therefore work offline and never download the SDK.

---

## Part 3 - File by file

### `store.js`
- `CATEGORIES`, `UNITS`, `LOCATIONS`, `CURRENCIES` - the fixed vocabularies. The
  AI schema uses the same lists as enums, so Claude can only answer with values
  the UI understands.
- `load()` merges saved data over an empty template, so adding a new field later
  never breaks old saves.
- `statusOf`, `needOf`, `stepOf` - the rules in 1.3. `stepOf` makes +/- move by
  1 for packs, 0.25 for kg/L, 100 for g/mL.
- `recordPrice` keeps the last 20 prices per item, to 6 decimals (a price per
  gram is often under a cent). `changeUnit` re-expresses prices when you switch
  an item from kg to g, so the price-change panel doesn't report a fake -99%.
- `convertQty` converts g/kg, mL/L and pcs/dozen; `defaultLow` gives scanned
  items an alert level of about a third of what you bought.
- `newItem` is the only constructor; it validates category/unit/location.
- `sanitize` rebuilds every record from untrusted data (old saves, imported
  backups) through `newItem`, so a broken backup can't crash every render. If
  saved data can't even be parsed, `load()` copies it to a `larder.v1.corrupt-*`
  key before starting fresh, so nothing is silently overwritten.

### `ocr.js` (no-AI receipts)
- `readReceiptText` loads Tesseract.js (an open-source text reader that runs in
  the browser; first use downloads it once) and reads each photo in turn.
- Before reading, `ai.prepareImage(..., { forText: true })` runs `textprep.js`:
  it **straightens** the photo (tries tilts from -12 to +12 degrees and keeps the
  one where text rows line up best) and turns it **black on white** by comparing
  each pixel with its own neighbourhood, which cancels shadows and faint
  thermal print. On the long, tilted, unevenly lit test receipt this took the
  reader from 15 to 28 of 28 prices (`tests/ocr_bench.py` measures it).
- `mergeTexts` joins photos of a long receipt and drops the overlapping lines.
- `parseReceiptText` is pure rules, so it is unit-tested with plain text:
  - a line ending in a price is an item (`PRICE_END`); OCR's `7:20` is read as 7.20;
  - a quantity line (`2 @ $2.50`, `0.856 kg @ $3.90/kg`) belongs to the name line
    above it (`pending`);
  - the `TOTAL` line ends the items; header/footer lines (ABN, times, GST,
    EFTPOS) are ignored; bags, discounts and loyalty lines come in unticked;
  - `fitQty` turns "FC MILK 2L" x1 into 2 L when the pantry counts milk in L.
- Matching (in app.js): `matchReceiptLine` first checks `state.aliases`, the
  table of lines you saved before (keyed by `aliasKey`, which strips prices and
  counts but keeps sizes like 2L). Then `bestNameMatch`: a pantry item matches
  when every word of its name appears in the line ("Milk" in "FC MILK 2L").
- Learning happens in `applyScan`: every saved receipt line writes
  `aliases[key] = item id`. Correct a match once; it sticks. This works for all
  three readers, not just the no-AI one.

### `barcode.js` (no-AI groceries)
- `startScanner` uses the browser's own `BarcodeDetector` where it exists
  (Android Chrome) and the ZXing library otherwise (iPhone Safari, desktop).
- `validGtin` checks the barcode's check digit (expanding short UPC-E codes
  first), so misreads and QR codes are ignored.
- `lookupProduct` asks Open Food Facts (free public database) for name, brand,
  size and categories. `guessCategory` (store.js) maps those to Larder's
  categories by keywords.
- In app.js, `openBarcodeScanner` collects scans into a list (same code twice =
  qty 2; holding one in view counts once), then hands them to the normal
  groceries review screen. Saving writes `barcodes[code] = item id` and
  `packs[code]` (what one scan adds - 380 for a 380 g jar when you count that
  item in grams), so a product scans straight to your item next time.
- Matching by name is shown as "matched by name - check" on the review screen,
  and refuses obvious cross-category hits ("Milk" vs MILK CHOCOLATE). Learned
  lines also match when the reader gets one or two letters different.

### `sw.js`
A service worker that makes the hosted app open offline (in a store with no
signal). Strategy is *stale-while-revalidate*: serve the cached file instantly,
fetch a fresh copy in the background for next time. So after a deploy, the new
version shows on the **second** load. It only registers on `https:`, so local
dev on `localhost` always gets fresh files.

### `app.js`
- **Pantry**: `viewPantry` -> `pantryList` -> `itemRow`. Grouped by category,
  filtered by search, location chip and "Low & out only".
- **List**: `listEntries()` is the derived shopping list. Ticks live in
  `state.checked` so they survive a reload mid-shop. `restockTicked` adds each
  ticked item's `need` to the pantry (for when you have no receipt).
- **Scan**: `pickPhotos` -> `startScan` -> `normalizeReceipt`/`normalizeItems`
  -> `receiptReview`/`itemsReview` -> `applyScan`. `ui.scan.token` guards
  against a slow response landing after you pressed Cancel.
- **Spend**: `viewSpend` builds the month total, 6-month bars, `byCategory`,
  by-store, `priceWatch`, and the trip list.
- **Settings**: API key, currency, theme, export/import/erase.

### `ai.js`
- `prepareImage` draws the photo onto a canvas no larger than 1568 px on the long
  edge and re-encodes it as JPEG. Claude would downscale anything larger anyway,
  so this cuts upload time and cost.
- `RECEIPT_SCHEMA` / `ITEMS_SCHEMA` are JSON Schemas sent as
  `output_config.format`. Structured outputs guarantee the reply parses and
  matches the schema - no "please answer in JSON" prompt hacks.
- The prompt includes the pantry as `id | name | unit | category` lines, so
  Claude can set `match_id` and express quantities in *your* unit.
- `call` picks the reader from Settings:
  - `callClaude` uses `claude-opus-5-5` with server-side refusal fallback
    enabled; if the API ever rejects the beta field, it retries once without it.
    The SDK is imported only on this path. Errors are mapped to plain-English
    messages in `toAIError`.
  - `callLocal` posts to a llama.cpp server's OpenAI-style
    `/v1/chat/completions` (Qwen3.5-9B with its vision file). The photo goes in
    as an `image_url` data URL and the same schema goes in `response_format`;
    llama.cpp compiles it into a grammar, so the model can only emit valid JSON.
    Same contract, different engine: the rest of the app can't tell which
    reader answered.
- `qtyUnit` (in app.js) rounds countable units to whole numbers, because a small
  model will happily say "3.4 bananas".

---

## Part 4 - One receipt, end to end

1. You tap **Scan -> Take photo**. `pickPhotos` creates a hidden
   `<input type=file capture=environment>` and clicks it; the phone camera opens.
2. `startScan` imports `ai.js`, shrinks the photo, shows the thumbnail and a
   spinner, then calls `readReceipt(apiKey, images, state.items)`.
3. Claude returns `{store, date, total, lines[]}`. `normalizeReceipt` cleans it:
   drops unknown `match_id`s, clamps qty, forces matched lines into the pantry
   item's unit, and pre-unticks lines Claude marked `skip` (bags, discounts).
4. `receiptReview` shows every line as editable fields. Typing updates
   `ui.scan.data` and the totals strip live.
5. **Save** runs `applyScan`: matched lines add to the existing item, unmatched
   ones create new items, each line records its unit price, and one purchase is
   appended with the receipt total. `commit()` saves; you land on **Spend**.

---

## Limits worth knowing

- **Two copies open at once** (browser tab + installed app) stay in step via the
  `storage` event: when one saves, the other reloads its state.
- **No-AI receipt reading** depends on photo quality: flat, well lit, whole
  receipt in frame. The review screen has a "Text read from the photo" panel to
  see what it saw.
- **Per-device data.** Phone and laptop each have their own pantry. Use Settings
  -> Export/Import to move data. Shared household sync would need a backend
  (Firebase, as in Stash/Patch).
- **The API key is stored in this browser's localStorage.** Fine for a personal
  device; anyone using that browser profile could read it. Set a monthly spend
  limit on the key in the Anthropic console.
