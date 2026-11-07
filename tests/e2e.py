"""End-to-end smoke test for Larder, driven through the real UI.

Claude is never called: ai.js is swapped for a fake module that returns a fixed
receipt / item list, so the test is free and repeatable.

Usage:  py -3 tests\\e2e.py [base_url] [screenshot_dir]
        (serve the app first: start.cmd, or py -3 -m http.server 8790)
"""
import base64
import json
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8790/"
SHOTS = Path(sys.argv[2]) if len(sys.argv) > 2 else None

FAKE_AI = """
export class AIError extends Error {}
export async function prepareImage(file) {
  return { preview: 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2260%22 height=%22100%22/>', block: {} };
}
export async function readReceipt(key, images, items) {
  const milk = items.find(i => i.name === 'Milk');
  return { store: 'Test Mart', date: '2026-11-06', total: 20.5, lines: [
    { receipt_text: 'FC MILK 2L', name: 'Milk', category: 'Dairy & Eggs', qty: 2, unit: 'L', line_total: 3.8, match_id: milk ? milk.id : '', skip: false },
    { receipt_text: globalThis.__printed || 'SOURDOUGH', name: 'Sourdough bread', category: 'Bakery', qty: 1, unit: 'pcs', line_total: 6.5, match_id: '', skip: false },
    { receipt_text: 'BAG 0.15', name: 'Bag', category: 'Other', qty: 1, unit: 'pcs', line_total: 0.15, match_id: 'bogus', skip: true },
  ]};
}
export async function readItems(key, images, items) {
  if (globalThis.__count) {
    const milk = items.find(i => i.name === 'Milk');
    return { items: [1, 2].map(q => ({ name: 'Milk', brand: '', size: '', category: 'Dairy & Eggs', location: 'Fridge', qty: q, unit: 'L', expires: '2026-02-30', match_id: milk.id })) };
  }
  return { items: [
    { name: 'Peanut butter', brand: 'Bega', size: '375 g', category: 'Pantry', location: 'Pantry', qty: 2, unit: 'pcs', expires: '2027-03-01', match_id: '' },
  ]};
}
"""

errors = []
sys.stdout.reconfigure(encoding="utf-8")


def check(cond, msg):
    if not cond:
        raise AssertionError(msg)
    print("ok -", msg)


with sync_playwright() as p:
    browser = p.chromium.launch()
    # service workers off so the fake ai.js route also applies on the hosted (https) site
    page = browser.new_page(viewport={"width": 390, "height": 844}, service_workers="block")
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.route("**/ai.js", lambda r: r.fulfill(status=200, content_type="text/javascript", body=FAKE_AI))
    page.goto(BASE)
    page.evaluate("localStorage.clear(); sessionStorage.clear()")
    page.reload()

    # Pantry: empty state -> demo data
    check(page.get_by_text("Your pantry is empty").is_visible(), "empty state shows")
    page.get_by_role("button", name="Load demo data").click()
    check(page.locator(".row").count() == 7, "demo loads 7 items")
    bananas = page.locator(".row", has_text="Bananas")
    check(bananas.locator(".pill.out").count() == 1, "bananas marked Out")
    if SHOTS:
        page.screenshot(path=str(SHOTS / "pantry.png"), full_page=True)

    # +/- on a kg item steps by 0.25
    rice = page.locator(".row", has_text="Rice")
    rice.get_by_role("button", name="Add some Rice").click()
    check("4.25" in page.locator(".row", has_text="Rice").inner_text(), "rice + steps 0.25 kg")

    # Search filters without losing focus
    page.fill("#search", "milk")
    check(page.locator("#pantry-list .row").count() == 1, "search filters to milk")
    check(page.evaluate("document.activeElement.id") == "search", "search keeps focus")
    page.fill("#search", "")

    # Add an item via the modal
    page.get_by_role("button", name="+ Add item").click()
    page.fill("input[name=name]", "Coffee beans")
    page.select_option("select[name=category]", "Drinks")
    page.fill("input[name=qty]", "0")
    page.get_by_role("button", name="Save").click()
    check(page.locator(".row", has_text="Coffee beans").count() == 1, "item added")

    # List: low/out items appear automatically; badge counts them
    page.locator(".tabs button[data-tab=list]").click()
    badge = page.locator("#list-badge").inner_text()
    check(badge == "4", f"badge shows 4 to buy (got {badge})")
    check(page.locator("h3", has_text="Out of stock").is_visible(), "out-of-stock section")
    page.fill("#extra-form input[name=name]", "Birthday candles")
    page.press("#extra-form input[name=name]", "Enter")
    check(page.locator(".row", has_text="Birthday candles").count() == 1, "extra added")
    page.locator("label.row", has_text="Bananas").locator("input").check()
    check(page.locator("label.row.done", has_text="Bananas").count() == 1, "tick strikes bananas")
    if SHOTS:
        page.screenshot(path=str(SHOTS / "list.png"), full_page=True)
    page.get_by_role("button", name="Restock ticked (1)").click()
    check(page.locator("label.row", has_text="Bananas").count() == 0, "bananas leave the list after restock")

    # Scan a receipt (fake AI) -> review -> apply
    page.locator(".tabs button[data-tab=scan]").click()
    check(page.get_by_role("button", name="Scan barcodes").is_visible(), "no-AI reader is the default (barcodes offered)")
    page.locator("#open-settings").click()
    page.select_option("select[name=provider]", "anthropic")
    page.locator("#modal-body").get_by_role("button", name="Save").click()
    check(page.get_by_text("needs an Anthropic API key").is_visible(), "no-key notice")
    page.locator("#open-settings").click()
    page.fill("input[name=apiKey]", "sk-ant-test")
    page.select_option("select[name=currency]", "AUD")
    page.locator("#modal-body").get_by_role("button", name="Save").click()
    with page.expect_file_chooser() as fc:
        page.get_by_role("button", name="Choose photos").first.click()
    fc.value.set_files({"name": "r.jpg", "mimeType": "image/jpeg", "buffer": b"x"})
    page.get_by_text("Check the receipt").wait_for()
    check(page.locator(".review-line").count() == 3, "3 receipt lines to review")
    check(page.locator(".review-line.skipped").count() == 1, "bag line pre-unticked")
    totals = page.locator("#scan-totals").inner_text()
    check("10.30" in totals and "10.20" in totals, f"totals split ticked/adjustments ({totals!r})")
    page.locator(".review-line").nth(1).locator("[data-field=lineTotal]").fill("7")
    check("10.80" in page.locator("#scan-totals").inner_text(), "editing a line updates totals live")
    if SHOTS:
        page.screenshot(path=str(SHOTS / "receipt-review.png"), full_page=True)
    page.get_by_role("button", name="Save to pantry & spending").click()

    # Spend view after receipt
    page.get_by_text("Test Mart").first.wait_for()
    check(page.locator(".big").inner_text().replace("A", "").strip().endswith("20.50"), "month total = receipt total")
    check(page.locator(".bar-row", has_text="Adjustments").count() == 1, "adjustments bar present")
    check(page.locator(".row", has_text="Milk").count() == 1, "price change shows for milk")
    page.get_by_role("button", name="Add a trip by hand").click()
    page.fill("input[name=store]", "Market")
    page.fill("input[name=total]", "12")
    page.locator("#modal-body").get_by_role("button", name="Add").click()
    check("32.50" in page.locator(".big").inner_text(), "manual trip adds to month")
    if SHOTS:
        page.screenshot(path=str(SHOTS / "spend.png"), full_page=True)

    # Pantry reflects receipt
    page.locator(".tabs button[data-tab=pantry]").click()
    check("2.5" in page.locator(".row", has_text="Milk").inner_text(), "milk 0.5 + 2 = 2.5 L")
    check(page.locator(".row", has_text="Sourdough bread").count() == 1, "new item from receipt")
    check(page.locator(".row", has_text="Bag").count() == 0, "skipped line not added")

    # Items photo in "count" mode
    page.locator(".tabs button[data-tab=scan]").click()
    with page.expect_file_chooser() as fc:
        page.get_by_role("button", name="Choose photos").nth(1).click()
    fc.value.set_files({"name": "i.jpg", "mimeType": "image/jpeg", "buffer": b"x"})
    page.get_by_text("Check the groceries").wait_for()
    page.get_by_role("button", name="Save to pantry").click()
    check(page.locator(".row", has_text="Peanut butter").count() == 1, "item photo adds peanut butter")

    # Renames are remembered: rename on the review screen, then the next scan uses your name
    def scan_items():
        page.locator(".tabs button[data-tab=scan]").click()
        with page.expect_file_chooser() as fc:
            page.get_by_role("button", name="Choose photos").nth(1).click()
        fc.value.set_files({"name": "i.jpg", "mimeType": "image/jpeg", "buffer": b"x"})
        page.get_by_text("Check the groceries").wait_for()
    scan_items()
    first = page.locator("[data-field=name]").first
    check(first.input_value() == "Bega Peanut butter 375g", f"same product feeds the existing item ({first.input_value()})")
    first.fill("Peanut Butter Crunchy")
    page.get_by_role("button", name="Save to pantry").click()
    check(page.locator(".row", has_text="Peanut Butter Crunchy").count() == 1 and page.locator(".row", has_text="Bega").count() == 0,
          "renaming on the review screen renames the pantry item")
    scan_items()
    first = page.locator("[data-field=name]").first
    picked = page.locator("[data-field=match]").first.locator("option:checked").inner_text()
    check(first.input_value() == "Peanut Butter Crunchy" and picked.startswith("Peanut Butter Crunchy"), f"next scan uses the remembered name ({first.input_value()}, {picked})")
    page.get_by_role("button", name="Save to pantry").click()
    check(page.locator(".row", has_text="Peanut Butter Crunchy").count() == 1, "no duplicate item after the rename")
    check(page.evaluate("JSON.parse(localStorage.getItem('larder.v1')).renames['BEGA PEANUT BUTTER 375G']") == "Peanut Butter Crunchy", "rename stored in data")

    # Receipts too, even when the same product is printed differently next time
    def scan_receipt(printed):
        page.evaluate(f"globalThis.__printed = {printed!r}")
        page.locator(".tabs button[data-tab=scan]").click()
        with page.expect_file_chooser() as fc:
            page.get_by_role("button", name="Choose photos").first.click()
        fc.value.set_files({"name": "r.jpg", "mimeType": "image/jpeg", "buffer": b"x"})
        page.get_by_text("Check the receipt").wait_for()
        return page.locator(".review-line").nth(1)
    page.locator(".tabs button[data-tab=pantry]").click()
    page.locator(".row", has_text="Sourdough bread").locator("[data-act=edit-item]").click()
    page.fill("input[name=name]", "Gardenia Sourdough")
    page.locator("#modal-body").get_by_role("button", name="Save").click()
    line = scan_receipt("SRDGH LOAF LGE")
    name = line.locator("[data-field=name]").input_value()
    picked = line.locator("[data-field=match] option:checked").inner_text()
    check(name == "Gardenia Sourdough" and picked.startswith("Gardenia Sourdough"), f"receipt: pantry rename used for a differently printed line ({name}, {picked})")
    line.locator("[data-field=name]").fill("Sourdough Big Loaf")
    page.get_by_role("button", name="Save to pantry & spending").click()
    page.get_by_text("Test Mart").first.wait_for()
    line = scan_receipt("SOURDO XL 800G")
    name = line.locator("[data-field=name]").input_value()
    check(name == "Sourdough Big Loaf", f"receipt: review-screen rename used next time ({name})")
    page.get_by_role("button", name="Save to pantry & spending").click()
    page.get_by_text("Test Mart").first.wait_for()
    page.locator(".tabs button[data-tab=pantry]").click()
    check(page.locator(".row", has_text="Sourdough").count() == 1 and page.locator(".row", has_text="Sourdough Big Loaf").count() == 1,
          "receipt: one sourdough item, under your latest name")

    # Count mode: two lines matched to one item add up instead of overwriting
    page.evaluate("globalThis.__count = true")
    page.locator(".tabs button[data-tab=scan]").click()
    with page.expect_file_chooser() as fc:
        page.get_by_role("button", name="Choose photos").nth(1).click()
    fc.value.set_files({"name": "i.jpg", "mimeType": "image/jpeg", "buffer": b"x"})
    page.get_by_text("Check the groceries").wait_for()
    page.get_by_role("button", name="Everything on hand (count)").click()
    page.get_by_role("button", name="Save to pantry").click()
    milk_row = page.locator(".row", has_text="Milk").inner_text()
    check("3" in milk_row and "Expire" not in milk_row, f"count mode sums matched lines, bad date ignored ({milk_row!r})")

    # Pure rules: sub-cent unit prices and unit changes
    r = page.evaluate("""async () => { const S = await import('./store.js');
      const it = S.newItem({ name: 'Cheese', unit: 'kg' }); S.recordPrice(it, 12, '2026-11-01', '');
      const g = S.newItem({ name: 'Feta', unit: 'g' }); S.recordPrice(g, 6 / 500, '2026-11-01', '');
      S.changeUnit(it, 'g');
      return [g.lastPrice, it.lastPrice, S.validDate('2026-02-30'), S.convertQty(2, 'L', 'mL'), S.defaultLow(6, 'pcs')]; }""")
    check(r == [0.012, 0.012, '', 2000, 2], f"price precision, unit change, date + unit rules ({r})")

    # Dark theme + persistence across reload
    page.locator("#open-settings").click()
    page.locator("[data-act=theme][data-theme=dark]").click()
    page.locator("#modal-body").get_by_role("button", name="Cancel").click()
    page.reload()
    check(page.evaluate("document.documentElement.dataset.theme") == "dark", "dark theme persists")
    check(page.locator(".row").count() == 10, "data persists after reload")
    if SHOTS:
        page.screenshot(path=str(SHOTS / "pantry-dark.png"), full_page=True)
        page.set_viewport_size({"width": 1280, "height": 900})
        page.locator(".tabs button[data-tab=spend]").click()
        page.screenshot(path=str(SHOTS / "spend-desktop-dark.png"), full_page=True)

    # A malformed / hostile saved state must not break the app or run script
    page.evaluate("""localStorage.setItem('larder.v1', JSON.stringify({
      items: [{ id: '"><img src=x onerror="window.__xss=1">', name: null, qty: 'abc' }, 5, null],
      purchases: 'nope', extras: [{ name: 'x' }], settings: { theme: 'light' } }))""")
    page.reload()
    page.locator(".tabs button[data-tab=pantry]").click()
    page.locator(".row").first.wait_for()
    check(page.locator(".row").count() == 1, "bad records dropped, odd item rebuilt")
    page.locator(".tabs button[data-tab=spend]").click()
    page.locator(".tabs button[data-tab=list]").click()
    check(page.evaluate("window.__xss") is None, "hostile id does not execute")

    # Qwen reader: the REAL ai.js talking to a fake OpenAI-compatible server
    qpage = browser.new_page(viewport={"width": 390, "height": 844}, service_workers="block")
    qpage.on("pageerror", lambda e: errors.append(str(e)))
    sent = {}
    def fake_qwen(route):
        sent["body"] = route.request.post_data_json
        content = json.dumps({"store": "Qwen Mart", "date": "2026-11-05", "total": 9.5, "lines": [
            {"receipt_text": "TIN TOM 2 @ 2.50", "name": "Tinned tomatoes", "category": "Pantry", "qty": 2.4, "unit": "can",
             "line_total": 5, "match_id": "", "skip": False},
            {"receipt_text": "BAG", "name": "Bag", "category": "Other", "qty": 1, "unit": "bag", "line_total": 0.15, "match_id": "", "skip": True}]})
        route.fulfill(status=200, content_type="application/json",
                      body=json.dumps({"choices": [{"finish_reason": "stop", "message": {"role": "assistant", "content": content}}]}))
    qpage.route("http://127.0.0.1:9/v1/chat/completions", fake_qwen)
    qpage.goto(BASE)
    qpage.locator("#open-settings").click()
    qpage.select_option("select[name=provider]", "local")
    qpage.fill("input[name=localUrl]", "http://127.0.0.1:9/v1/")
    qpage.locator("#modal-body").get_by_role("button", name="Save").click()
    qpage.locator(".tabs button[data-tab=scan]").click()
    check(qpage.get_by_text("Reading photos with Qwen").is_visible(), "Qwen notice on scan tab")
    png = qpage.evaluate("(() => { const c = document.createElement('canvas'); c.width = 40; c.height = 60; return c.toDataURL('image/png').split(',')[1]; })()")
    with qpage.expect_file_chooser() as fc:
        qpage.get_by_role("button", name="Choose photos").first.click()
    fc.value.set_files({"name": "r.png", "mimeType": "image/png", "buffer": base64.b64decode(png)})
    qpage.get_by_text("Check the receipt").wait_for()
    body = sent["body"]
    check(body["response_format"]["type"] == "json_schema" and body["messages"][0]["content"][0]["type"] == "image_url",
          "Qwen request carries the photo and the JSON schema")
    check(qpage.locator("[data-field=qty]").first.input_value() == "2", "countable qty rounded (2.4 cans -> 2)")
    check(qpage.locator("[data-head=store]").input_value() == "Qwen Mart", "Qwen result reaches the review screen")

    # ---------- No-AI reader: receipt text rules (pure) ----------
    dpage = browser.new_page(viewport={"width": 390, "height": 844}, service_workers="block")
    dpage.on("pageerror", lambda e: errors.append(str(e)))
    dpage.goto(BASE)
    parsed = dpage.evaluate("""async () => {
      const { parseReceiptText } = await import('./ocr.js');
      const text = `FRESHWAY MARKET
12 King St
ABN 12 345 678 901
06/11/2026 17:42 REG 03
FC MILK 2L 3.80
BANANAS CAVENDISH
0.856 kg @ $3.90/kg 3.34
EGGS FREE RANGE 12PK 7:20
TIN TOMATOES 400G
2 @ $2.50 5.00
REUSABLE BAG 0.15
LOYALTY DISCOUNT -1.00
SUBTOTAL 49.99
TOTAL 48.99
EFTPOS 48.99
GST INCLUDED IN TOTAL 2:22`;
      const match = (name) => /milk/i.test(name) ? { id: 'milk', unit: 'L' } : null;
      return parseReceiptText(text, { match }); }""")
    got = [(l["name"], l["qty"], l["unit"], l["line_total"], l["skip"], l["match_id"]) for l in parsed["lines"]]
    check(parsed["date"] == "2026-11-06" and parsed["total"] == 48.99 and parsed["store"] == "Freshway Market", f"receipt header ({parsed['store']}, {parsed['date']}, {parsed['total']})")
    check(got == [("Full Cream Milk 2L", 2, "L", 3.8, False, "milk"), ("Bananas Cavendish", 0.856, "kg", 3.34, False, ""),
                  ("Eggs Free Range 12pk", 1, "pcs", 7.2, False, ""), ("Tin Tomatoes 400g", 2, "pcs", 5, False, ""),
                  ("Reusable Bag", 1, "pcs", 0.15, True, ""), ("Loyalty Discount", 1, "pcs", -1, True, "")], f"receipt lines {got}")
    extra = dpage.evaluate("""async () => {
      const { parseReceiptText, parseReceiptPhotos } = await import('./ocr.js');
      const S = await import('./store.js');
      const r = parseReceiptText(`SHOP
MILK 3 x 1.50 4.50
BANANAS
0.856 kg NET @ $3.90/kg 3.34
BIRTHDAY CARD 4.50
CASHEWS 300G 7.00
VISA CARD 19.34
TOTAL (14 ITEMS) 19.34`, {});
      return {
        lines: r.lines.map(l => [l.name, l.qty, l.unit, l.line_total]), total: r.total,
        merged: parseReceiptPhotos([`SHOP ONE
4800361415293 MILO 48G
1 x 148.00 148.00 V
A ITEM
1 x 2.00 2.00 V`, `A ITEM
1 x 2.00 2.00 V
B THING
2 x 3.00 6.00 V
TOTAL 156.00`]),
        pure: parseReceiptPhotos([`Puregold Price Club
Trans. Date: 2026-11-07 13:45:35
Cashier: CRISTY LYN
¥ 4800361415293 MILO ACTV-TWIN48GX
¥ 1 x 148.00 148.90 V k: 5
4801668605981 DP ADB S-PNNYHNG A
3 % 38.00 114.00 V
0748485913018 BIRCHTREE FC29G7+1
Xk 67.80 67.80 V
4806502721452 GAR HF W-BREAD400G
1x 80.25 §0.25 V
4806505668853 CHEERS TRASH BAGS
2 x 40.25 80.50 V
Wototal 9,114.33
Total Discount 0.00
Total Amt Due Pnp 9,114.33
BDO CREDIT 9,114.33`]),
        packs: [S.packQty('380 g', 'g'), S.packQty('6 x 375 mL', 'L'), S.packQty('2 L', 'pcs'), S.packQty('1.5kg', 'g')],
        keys: [S.aliasKey('MILK 1.5L 3.20'), S.aliasKey('MILK 0.6L 1.90'), S.aliasKey('TIN TOM 2 @ $2.50 5.00')],
        choc: S.guessCategory('MILK CHOCOLATE 200G'),
      }; }""")
    check(extra["lines"] == [["Milk", 3, "pcs", 4.5], ["Bananas", 0.856, "kg", 3.34], ["Birthday Card", 1, "pcs", 4.5], ["Cashews 300g", 1, "pcs", 7]]
          and extra["total"] == 19.34, f"parser: '3 x', 'kg NET @', product words like CARD/CASH, TOTAL (n ITEMS) ({extra['lines']}, {extra['total']})")
    m = extra["merged"]
    check([(l["name"], l["qty"], l["line_total"]) for l in m["lines"]] == [("Milo Chocolate Drink 48g", 1, 148), ("A Item", 1, 2), ("B Thing", 2, 6)]
          and m["total"] == 156 and m["lines"][0]["barcode"] == "4800361415293", f"overlapping photos merged, barcode kept ({m['lines']})")
    got = [(l["name"], l["qty"], l["line_total"], l["skip"]) for l in extra["pure"]["lines"]]
    check([g[:3] for g in got] == [("Milo Chocolate Drink Actv Twin 48g", 1, 148), ("Datu Puti Adobo", 3, 114), ("Birch Tree Powdered Milk Full Cream 29g", 1, 67.8),
                                   ("Gardenia Wheat Bread High Fiber 400g", 1, 80.25), ("Cheers Trash Bags", 2, 80.5)],
          f"Puregold layout + PH names expanded: code+name line, qty line, VAT flag, stray marks, OCR'd x, digit slips ({got})")
    check(not got[4][3], "trash bags are an item, not a bag charge")
    pg = extra["pure"]
    check(pg["total"] == 9114.33 and pg["date"] == "2026-11-07", f"total despite 'Wototal' + thousands separator ({pg['total']}, {pg['date']})")
    check(extra["packs"] == [380, 2.25, None, 1500], f"pack sizes ({extra['packs']})")
    check(extra["keys"][0] != extra["keys"][1] and extra["keys"][2] == "TIN TOM", f"learned-line keys ({extra['keys']})")
    check(extra["choc"] == "Snacks", "milk chocolate is a snack, not milk")
    ph = dpage.evaluate("""async () => { const { expandName, fullName } = await import('./phnames.js');
      return { names: ['PF CB210G', 'HNTSPRK BNS230G DP', 'ALASKA COND 545G', 'WKHCAKEW-SYRUP400G', 'DOWNY GARDEN BLOOM 1.4L',
        'CREAMSILK COND STD 180ML', 'LUCKY ME PANCIT CANTON CHILIMANSI 60G', 'MYSKYFLK25GX24S', 'GG TRTI CHESSE 25G'].map(t => expandName(t)?.name),
        plain: ['BANANAS CAVENDISH', 'TIN TOMATOES 400G', 'CANDLES 6S', 'LICORICE 200G', 'EGGS FREE RANGE 12PK'].map(t => expandName(t)),
        full: [fullName('Bega', 'Vegemite', '380 g'), fullName('Bega', 'Bega Vegemite 380g', '380 g')] }; }""")
    check(ph["names"] == ["Purefoods Corned Beef 210g", "Hunt's Pork & Beans 230g", "Alaska Condensed Milk 545g", "White King Pancake Mix Syrup 400g",
                          "Downy Fabric Conditioner Garden Bloom 1.4L", "Cream Silk Conditioner 180mL", "Lucky Me Pancit Canton Chilimansi 60g",
                          "SkyFlakes Crackers 25g x24", "Granny Goose Tortillos Cheese 25g"], f"PH receipt names expanded: brand + product + variant + size ({ph['names']})")
    check(ph["plain"] == [None] * 5, f"ordinary names left alone ({ph['plain']})")
    check(ph["full"] == ["Bega Vegemite 380g"] * 2, f"brand + size added once ({ph['full']})")
    check(dpage.evaluate("import('./barcode.js').then(b => b.validGtin('01234565'))"), "UPC-E barcodes accepted")
    cats = dpage.evaluate("""async () => { const S = await import('./store.js');
      return ['FC MILK 2L', 'TIN TOMATOES 400G', 'NAPPIES SZ4', 'SOURDOUGH LOAF', 'BANANAS', 'beverages sports-drinks'].map(S.guessCategory); }""")
    check(cats == ["Dairy & Eggs", "Pantry", "Baby", "Bakery", "Produce", "Drinks"], f"category guesses {cats}")
    check(dpage.evaluate("import('./barcode.js').then(b => [b.validGtin('9300650658516'), b.validGtin('9300650658517'), b.validGtin('12345')])") == [True, False, False], "barcode check digit")

    # ---------- No-AI reader: real on-device text reading of a receipt photo ----------
    dpage.evaluate("localStorage.clear(); sessionStorage.clear()")
    dpage.reload()
    dpage.get_by_role("button", name="Load demo data").click()
    dpage.locator(".tabs button[data-tab=scan]").click()
    with dpage.expect_file_chooser() as fc:
        dpage.get_by_role("button", name="Choose photos").first.click()
    fc.value.set_files(str(Path(__file__).with_name("fixtures") / "receipt.jpg"))
    dpage.get_by_text("Check the receipt").wait_for(timeout=120000)
    names = [x.input_value() for x in dpage.locator("[data-field=name]").all()]
    matched = [x.locator("option:checked").inner_text() for x in dpage.locator("[data-field=match]").all()]
    check(dpage.locator("[data-head=total]").input_value() == "48.99", "on-device read: total 48.99")
    check(len(names) == 8 and "Tin Tomatoes 400g" in names, f"on-device read: 8 lines ({names})")
    check(matched[0].startswith("Milk") and matched[3].startswith("Eggs") and matched[5].startswith("Nappies"), f"on-device read: pantry matches ({matched})")
    check(dpage.locator("[data-field=qty]").nth(0).input_value() == "2", "2L milk bottle counts as 2 L")
    dpage.get_by_role("button", name="Save to pantry & spending").click()
    dpage.get_by_text("Freshway Market").first.wait_for()
    # The hard receipt (long, faint, tilted, uneven light): straightened + black/white first
    dpage.locator(".tabs button[data-tab=scan]").click()
    with dpage.expect_file_chooser() as fc:
        dpage.get_by_role("button", name="Choose photos").first.click()
    fc.value.set_files(str(Path(__file__).with_name("fixtures") / "hard_receipt.jpg"))
    dpage.get_by_text("Check the receipt").wait_for(timeout=120000)
    truth = json.loads((Path(__file__).with_name("fixtures") / "hard_receipt.json").read_text())
    paid = {round(float(x.input_value()), 2) for x in dpage.locator("[data-field=lineTotal]").all()}
    hits = sum(1 for it in truth["items"] if round(it["price"], 2) in paid)
    check(hits >= 26 and float(dpage.locator("[data-head=total]").input_value()) == truth["total"], f"hard receipt: {hits}/28 prices, total right")
    dpage.get_by_role("button", name="Discard").click()

    # Second time, the tomatoes line was learned: it matches the item created the first time
    dpage.locator(".tabs button[data-tab=scan]").click()
    with dpage.expect_file_chooser() as fc:
        dpage.get_by_role("button", name="Choose photos").first.click()
    fc.value.set_files(str(Path(__file__).with_name("fixtures") / "receipt.jpg"))
    dpage.get_by_text("Check the receipt").wait_for(timeout=120000)
    tom = dpage.locator(".review-line", has=dpage.locator(".receipt-text", has_text="TIN TOMATOES")).locator("[data-field=match] option:checked").inner_text()
    check(tom.startswith("Tin Tomatoes"), f"learned line matches next time ({tom})")
    dpage.get_by_role("button", name="Discard").click()

    # ---------- No-AI reader: barcodes typed in, looked up in a faked Open Food Facts ----------
    def fake_off(route):
        code = route.request.url.split("/product/")[1].split(".json")[0]
        body = {"status": 1, "product": {"product_name": "Vegemite", "brands": "Bega", "quantity": "380 g", "categories_tags": ["en:spreads", "en:yeast-extract-spreads"]}}             if code == "9300650658516" else {"status": 0}
        route.fulfill(status=200, content_type="application/json", body=json.dumps(body))
    dpage.route("https://world.openfoodfacts.org/**", fake_off)
    dpage.get_by_role("button", name="Scan barcodes").click()
    for code in ["9300650658516", "9300650658516", "4800361339148"]:
        dpage.fill("#bc-manual", code)
        dpage.locator("[data-act=bc-manual]").click()
    dpage.fill("#bc-manual", "1234")
    dpage.locator("[data-act=bc-manual]").click()
    dpage.get_by_role("button", name="Done").click()
    dpage.get_by_text("Check the groceries").wait_for()
    names = [x.input_value() for x in dpage.locator("[data-field=name]").all()]
    qtys = [x.input_value() for x in dpage.locator("[data-field=qty]").all()]
    check(names == ["Bega Vegemite 380g", "Barcode 4800361339148"] and qtys == ["2", "1"], f"barcodes: found + unknown, repeat scan counts up ({names}, {qtys})")
    dpage.locator("[data-field=name]").nth(1).fill("Pancit canton")
    dpage.get_by_role("button", name="Save to pantry").click()
    check(dpage.locator(".row", has_text="Pancit canton").count() == 1 and dpage.locator(".row", has_text="Vegemite").count() == 1, "barcode items added")
    dpage.locator(".tabs button[data-tab=scan]").click()
    dpage.get_by_role("button", name="Scan barcodes").click()
    dpage.fill("#bc-manual", "4800361339148")
    dpage.locator("[data-act=bc-manual]").click()
    check("Pancit canton" in dpage.locator("#bc-list").inner_text(), "unknown barcode remembered after naming it")
    dpage.get_by_role("button", name="Cancel").click()

    browser.close()

check(not errors, f"no console errors {errors}")
print("ALL PASSED")
