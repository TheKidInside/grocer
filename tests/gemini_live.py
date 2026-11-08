"""The REAL ai.js against the REAL Gemini API, through the UI: a shelf photo into
the cart, and (if present) the private Puregold receipt photos through Scan.

Costs a fraction of a cent per run. The key comes from the GEMINI_KEY
environment variable only - never put it in a file (this repo is public).

Usage: set GEMINI_KEY=...  then  py -3 tests\\gemini_live.py [base_url]
"""
import json
import os
import sys
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding="utf-8")
BASE = next((a for a in sys.argv[1:] if a.startswith("http")), "http://localhost:8790/")
KEY = os.environ.get("GEMINI_KEY", "").strip()
if not KEY:
    sys.exit("Set GEMINI_KEY first.")
PRIV = Path(__file__).parent / "private"


def check(cond, msg):
    if not cond:
        raise AssertionError(msg)
    print("ok -", msg)


with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_context(service_workers="block", viewport={"width": 400, "height": 860}).new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(BASE)
    page.evaluate("""(key) => { localStorage.clear(); localStorage.setItem('larder.v1', JSON.stringify({
      settings: { provider: 'gemini', geminiKey: key, currency: 'PHP' } })); }""", KEY)
    page.reload()

    # Shelf tag -> cart
    page.locator(".tabs button[data-tab=list]").click()
    t0 = time.time()
    with page.expect_file_chooser() as fc:
        page.get_by_role("button", name="Choose photo", exact=True).click()
    fc.value.set_files(str(PRIV / "shelf-royal.jpg"))
    page.locator("#modal h2").filter(has_text="Add to cart").wait_for(timeout=180000)
    name = page.locator("#modal input[name=name]").input_value()
    price = page.locator("#modal input[name=price]").input_value()
    store = page.locator("#modal input[name=store]").input_value()
    notice = page.locator("#modal .notice").all_inner_texts()
    print(f"   tag: {name!r} {price!r} {store!r} in {time.time() - t0:.1f}s {notice}")
    check(price in ("199", "199.00") and "pesto" in name.lower(), "Gemini reads the shelf tag in the browser")

    # Receipt (3 overlapping photos) -> review
    photos = sorted(PRIV.glob("puregold-*.jpg"))
    if photos:
        page.locator("#modal").get_by_role("button", name="Cancel").click()
        page.locator(".tabs button[data-tab=scan]").click()
        page.get_by_role("tab", name="Receipt", exact=True).click()
        t0 = time.time()
        with page.expect_file_chooser() as fc:
            page.get_by_role("button", name="Choose photos").first.click()
        fc.value.set_files([str(f) for f in photos])
        page.locator("h1", has_text="Check the receipt").or_(page.locator("h1", has_text="Couldn't read that")).wait_for(timeout=300000)
        if page.locator("h1", has_text="Couldn't read that").count():
            raise AssertionError("receipt: " + page.locator(".notice").inner_text())
        lines = page.locator(".review-line").count()
        total = page.locator("[data-head=total]").input_value()
        truth = json.loads((PRIV / "puregold.json").read_text())
        paid = sorted(round(float(x.input_value()), 2) for x in page.locator("[data-field=lineTotal]").all())
        want = sorted(round(x[1], 2) for x in truth["items"])
        hits = 0
        pool = list(paid)
        for w in want:
            if w in pool:
                pool.remove(w)
                hits += 1
        print(f"   receipt: {lines} lines, total {total}, {hits}/{len(want)} prices exact, in {time.time() - t0:.1f}s")
        check(lines >= 70 and abs(float(total) - truth["total"]) < 1, "Gemini reads the long Puregold receipt")
    check(not errors, f"no page errors {errors}")
    b.close()
