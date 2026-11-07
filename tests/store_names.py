"""Store-name detection on header lines as OCR tends to read them.
Usage: py -3 tests\\store_names.py [base_url]"""
import sys
from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding="utf-8")
BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8790/"
CASES = {
    "Puregold Price Club, Inc": "Puregold",
    "Puregola Price Cluo, Inc": "Puregold",
    "SM SUPERMARKET": "SM Supermarket",
    "Savemore Market": "Savemore",
    "WOOLWORTHS": "Woolworths",
    "W00LWORTHS METRO": "Woolworths",
    "S&R MEMBERSHIP SHOPPING": "S&R Membership Shopping",
    "Shop 4 Station Rd Blacktown": "Shop 4 Station Rd Blacktown",
    "GROCERWAY": "Grocerway",
    "FRESHWAY MARKET": "Freshway Market",
}
JS = """async (header) => {
  const o = await import('./ocr.js');
  const nl = String.fromCharCode(10);
  return o.parseReceiptText(header + nl + 'MILK 2L 3.80' + nl + 'TOTAL 3.80').store;
}"""
bad = 0
with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page()
    page.goto(BASE)
    for header, want in CASES.items():
        got = page.evaluate(JS, header)
        ok = got == want
        bad += not ok
        print(f"{'ok ' if ok else 'BAD'} {header:30} -> {got}")
    b.close()
print("PASSED" if not bad else f"{bad} wrong")
sys.exit(1 if bad else 0)
