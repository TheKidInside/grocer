"""Benchmark on-device receipt reading on the fixtures: how many true lines/prices
come out of parseReceiptText, per Tesseract page-layout mode and image prep.

Usage: py -3 tests\\ocr_bench.py [base_url]
"""
import base64
import json
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8790/"
FIX = Path(__file__).parent / "fixtures"
sys.stdout.reconfigure(encoding="utf-8")

JS = """async ({ img, psm, prep }) => {
  const ai = await import('./ai.js');
  const ocr = await import('./ocr.js');
  const blob = await (await fetch('data:image/jpeg;base64,' + img)).blob();
  const image = await ai.prepareImage(new File([blob], 'r.jpg', { type: 'image/jpeg' }), prep ? 3200 : 2400, { forText: prep });
  const t0 = performance.now();
  const text = await ocr.readReceiptText([image], null, psm);
  const parsed = ocr.parseReceiptText(text, {});
  return { ms: Math.round(performance.now() - t0), total: parsed.total, lines: parsed.lines.map(l => [l.name, l.line_total]), text };
}"""

with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page()
    page.goto(BASE)
    for name in ["receipt", "hard_receipt"]:
        img = base64.b64encode((FIX / f"{name}.jpg").read_bytes()).decode()
        truth = json.loads((FIX / f"{name}.json").read_text()) if (FIX / f"{name}.json").exists() else None
        for psm in [None, "6", "11"]:
            for prep in [False, True]:
                r = page.evaluate(JS, {"img": img, "psm": psm, "prep": prep})
                score = ""
                if truth:
                    got = {round(t, 2) for _, t in r["lines"]}
                    hits = sum(1 for it in truth["items"] if round(it["price"], 2) in got)
                    score = f"prices {hits}/{len(truth['items'])}, total {'OK' if abs(r['total'] - truth['total']) < 0.01 else r['total']}"
                print(f"{name:13} psm={psm or 'auto':4} prep={str(prep):5} lines={len(r['lines']):2} {score} ({r['ms']} ms)")
    b.close()
