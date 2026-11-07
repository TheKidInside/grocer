"""End-to-end smoke test for Larder, driven through the real UI.

Claude is never called: ai.js is swapped for a fake module that returns a fixed
receipt / item list, so the test is free and repeatable.

Usage:  py -3 tests\\e2e.py [base_url] [screenshot_dir]
        (serve the app first: start.cmd, or py -3 -m http.server 8790)
"""
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
    { receipt_text: 'SOURDOUGH', name: 'Sourdough bread', category: 'Bakery', qty: 1, unit: 'pcs', line_total: 6.5, match_id: '', skip: false },
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

    browser.close()

check(not errors, f"no console errors {errors}")
print("ALL PASSED")
