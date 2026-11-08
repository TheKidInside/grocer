"""Read real shelf-tag photos with the on-device reader and compare with what's printed.

Photos + answers live in tests/private/ (git-ignored): shelf-*.jpg and
shelf.json = {"shelf-argentina.jpg": {"price": 120, "store": "Puregold", "name": "..."}, ...}

Usage: py -3 tests\\shelf_tags.py [base_url]
"""
import base64
import json
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding="utf-8")
BASE = next((a for a in sys.argv[1:] if a.startswith("http")), "http://localhost:8790/")
PRIV = Path(__file__).parent / "private"
truth = json.loads((PRIV / "shelf.json").read_text(encoding="utf-8"))

JS = """async ({ b64 }) => {
  const tp = await import('./tagprep.js');
  const blob = await (await fetch('data:image/jpeg;base64,' + b64)).blob();
  const t0 = performance.now();
  const r = await tp.readShelfPhoto(new File([blob], 's.jpg', { type: 'image/jpeg' }), null);
  delete r.preview;
  r.ms = Math.round(performance.now() - t0);
  return r;
}"""

prices = stores = 0
with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_context(service_workers="block").new_page()
    page.goto(BASE)
    for name, want in truth.items():
        r = page.evaluate(JS, {"b64": base64.b64encode((PRIV / name).read_bytes()).decode()})
        ok_price = r["price"] == want["price"]
        ok_store = r["store"] == want.get("store", "")
        prices += ok_price
        stores += ok_store
        print(f"{'ok ' if ok_price else 'BAD'} {name}: price {r['price']} (want {want['price']}){' check' if r['check'] else ''}"
              f" | store {r['store']!r} | name {r['name']!r} ({want.get('name', '')}) | {r['ms']} ms")
    b.close()
print(f"\nprices right {prices}/{len(truth)}, stores right {stores}/{len(truth)}")
sys.exit(0 if prices == len(truth) else 1)
