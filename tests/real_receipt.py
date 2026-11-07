"""Run real receipt photos through the on-device reader exactly as the app does
(prepareImage forText -> readReceiptText -> parseReceiptText) and report.

Photos live in tests/private/ (git-ignored: real receipts carry card and
store details and the repo is public).

Usage: py -3 tests\\real_receipt.py [base_url] [photo ...]   (default: tests/private/*.jpg together)
       add --text to print what the reader saw
"""
import base64
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding="utf-8")
args = [a for a in sys.argv[1:] if not a.startswith("--")]
BASE = args[0] if args and args[0].startswith("http") else "http://localhost:8790/"
files = [Path(a) for a in args if not a.startswith("http")] or sorted((Path(__file__).parent / "private").glob("*.jpg"))

JS = """async ({ imgs }) => {
  const ai = await import('./ai.js');
  const ocr = await import('./ocr.js');
  const images = [];
  for (const b64 of imgs) {
    const blob = await (await fetch('data:image/*;base64,' + b64)).blob();
    images.push(await ai.prepareImage(new File([blob], 'r.jpg', { type: 'image/jpeg' }), 3200, { forText: true }));
  }
  const t0 = performance.now();
  const texts = await ocr.readReceiptText(images, null);
  const text = texts.join(String.fromCharCode(10) + '=== next photo ===' + String.fromCharCode(10));
  const r = ocr.parseReceiptPhotos(texts, {});
  return { ms: Math.round(performance.now() - t0), text, cleaned: images.map(i => i.preview), store: r.store, date: r.date, total: r.total,
           lines: r.lines.map(l => [l.name, l.qty, l.line_total, l.skip, (l.barcode || '') + (l.check ? ' CHECK' : '')]), itemsCount: r.itemsCount };
}"""

with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page()
    page.goto(BASE)
    r = page.evaluate(JS, {"imgs": [base64.b64encode(f.read_bytes()).decode() for f in files]})
    b.close()

if "--dump" in sys.argv:
    for i, url in enumerate(r["cleaned"]):
        out = Path(__file__).parent / "private" / f"cleaned-{i + 1}.png"
        out.write_bytes(base64.b64decode(url.split(",")[1]))
        print("wrote", out)
if "--text" in sys.argv:
    print(r["text"])
    print("=" * 60)
for name, qty, total, skip, code in r["lines"]:
    print(f"{'[ ]' if skip else '[x]'} {name[:34]:34} x{qty:<4} {total:>9.2f}  {code}")
items = [l for l in r["lines"] if not l[3]]
print(f"\n{r['store']} | {r['date']} | total {r['total']:.2f} | {len(items)} item lines, "
      f"qty {sum(l[1] for l in items):g} (receipt says {r['itemsCount']}), sum {sum(l[2] for l in items):.2f} | {r['ms']} ms")
