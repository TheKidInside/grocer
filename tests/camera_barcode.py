"""Camera barcode scanning through a fake webcam showing an EAN-13 (Vegemite).
Exercises the real startScanner path (ZXing on desktop Chromium, the same
library iPhones use). Open Food Facts is faked.

Usage: py -3 tests\\camera_barcode.py [base_url]
"""
import json
import subprocess
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8790/"
HERE = Path(__file__).parent
video = HERE / "fixtures" / "barcode.y4m"
if not video.exists():
    subprocess.run([sys.executable, str(HERE / "fixtures" / "make_barcode_video.py")], check=True)

with sync_playwright() as p:
    b = p.chromium.launch(args=[
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
        f"--use-file-for-fake-video-capture={video}",
    ])
    ctx = b.new_context(permissions=["camera"], viewport={"width": 390, "height": 844}, service_workers="block")
    page = ctx.new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.route("https://world.openfoodfacts.org/**", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(
        {"status": 1, "product": {"product_name": "Vegemite", "brands": "Bega", "quantity": "380 g", "categories_tags": ["en:spreads"]}} if "9300650658516" in r.request.url else {"status": 0})))
    page.goto(BASE)
    page.evaluate("localStorage.clear(); sessionStorage.clear()")
    page.reload()
    page.locator(".tabs button[data-tab=scan]").click()
    page.get_by_role("button", name="Scan barcodes").click()
    page.wait_for_function("document.getElementById('bc-list')?.innerText.includes('Vegemite')", timeout=30000)
    print("camera read:", page.locator("#bc-list").inner_text().strip())
    page.fill("#bc-manual", "4800361339148")
    page.press("#bc-manual", "Enter")
    enter_ok = page.locator("#modal").evaluate("d => d.open") and "4800361339148" in page.locator("#bc-list").inner_text()
    print("Enter adds the typed code and keeps the scanner open:", enter_ok)
    page.get_by_role("button", name="Done").click()
    page.get_by_text("Check the groceries").wait_for()
    tracks = page.evaluate("document.getElementById('bc-video')?.srcObject?.getVideoTracks?.().length ?? 0")
    print("camera stopped after Done:", tracks == 0)
    print("errors:", errs)
    ok = not errs and tracks == 0 and enter_ok
    b.close()
print("PASSED" if ok else "FAILED")
sys.exit(0 if ok else 1)
