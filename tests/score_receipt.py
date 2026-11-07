"""Score the on-device reader against a known receipt: lines found, exact prices,
missing lines and DUPLICATES, for several ways a person might pick the photos
(in order, reversed, shuffled, one photo picked twice).

Needs tests/private/<name>.json ({"total", "items": [[name, price], ...]}) and
tests/private/<name>-*.jpg (git-ignored: real receipts carry card details).

Usage: py -3 tests\\score_receipt.py [base_url] [name]     (default name: puregold)
"""
import base64
import json
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding="utf-8")
args = sys.argv[1:]
BASE = next((a for a in args if a.startswith("http")), "http://localhost:8790/")
NAME = next((a for a in args if not a.startswith(("http", "--"))), "puregold")
PRIV = Path(__file__).parent / "private"
truth = json.loads((PRIV / f"{NAME}.json").read_text())
photos = sorted([*PRIV.glob(f"{NAME}-*.jpg"), *PRIV.glob(f"{NAME}-*.png")])

READ = """async ({ imgs }) => {
  const ai = await import('./ai.js');
  const ocr = await import('./ocr.js');
  const images = [];
  for (const b64 of imgs) {
    const blob = await (await fetch('data:image/*;base64,' + b64)).blob();
    images.push(await ai.prepareImage(new File([blob], 'r.jpg', { type: 'image/jpeg' }), 3200, { forText: true }));
  }
  return ocr.readReceiptText(images, null);
}"""
PARSE = """async ({ texts }) => {
  const ocr = await import('./ocr.js');
  const r = ocr.parseReceiptPhotos(texts, {});
  return { total: r.total, guessed: !!r.totalGuessed, lines: r.lines.map(l => [l.receipt_text, l.name, l.line_total, l.skip, !!l.duplicate]) };
}"""


def bigrams(s):
    s = "".join(c for c in s.upper() if c.isalnum())
    return {s[i:i + 2] for i in range(len(s) - 1)}


def sim(a, b):
    x, y = bigrams(a), bigrams(b)
    return 2 * len(x & y) / (len(x) + len(y)) if x and y else 0.0


def score(lines):
    items = [l for l in lines if not l[3] and not l[4]]  # ticked, not flagged as duplicate
    matched = {}
    used_truth = set()
    for i, (text, name, price, *_ ) in enumerate(items):
        best, best_s = None, 0.0
        for t, (tname, tprice) in enumerate(truth["items"]):
            s = sim(text, tname) + (0.35 if abs(price - tprice) < 0.011 else 0)
            if s > best_s:
                best, best_s = t, s
        matched[i] = (best, best_s)
    found, dups, junk = set(), 0, 0
    exact = 0
    for i, (t, s) in matched.items():
        if s < 0.55:
            junk += 1
            if "--show" in sys.argv: print("  junk:", items[i][0], items[i][2])
        elif t in found:
            dups += 1
            if "--show" in sys.argv: print("  DUPLICATE:", items[i][0], items[i][2], "~", truth["items"][t])
        else:
            found.add(t)
            if abs(items[i][2] - truth["items"][t][1]) < 0.011:
                exact += 1
    return len(found), exact, len(truth["items"]) - len(found), dups, junk, len(items)


with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page()
    page.goto(BASE)
    texts = page.evaluate(READ, {"imgs": [base64.b64encode(f.read_bytes()).decode() for f in photos]})
    n = len(texts)
    orders = {
        "in order": list(range(n)),
        "reversed": list(reversed(range(n))),
        "shuffled": [1, 0, 2][:n] if n >= 2 else [0],
        "photo 2 twice": [0, 1, 1, 2][: n + 1] if n >= 2 else [0, 0],
        "all + photo 1 again": list(range(n)) + [0],
    }
    print(f"{NAME}: {len(truth['items'])} true lines, total {truth['total']:.2f}, {n} photos")
    print(f"{'photos picked':22} {'found':>6} {'exact':>6} {'missing':>8} {'DUPES':>6} {'junk':>5} {'lines':>6}  total")
    for label, order in orders.items():
        r = page.evaluate(PARSE, {"texts": [texts[i] for i in order]})
        f, e, m, d, j, total_lines = score(r["lines"])
        flagged = sum(1 for l in r["lines"] if l[4])
        print(f"{label:22} {f:6} {e:6} {m:8} {d:6} {j:5} {total_lines:6}  {r['total']:.2f}{' (guessed)' if r['guessed'] else ''}"
              f"{f'  [{flagged} flagged as repeats]' if flagged else ''}")
    b.close()
