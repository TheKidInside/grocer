"""A harder receipt photo: long (28 items), faint thermal-grey print, tilted 4 degrees,
blurred, uneven lighting, shot small. Writes hard_receipt.jpg + hard_receipt.json (truth)."""
import json
import random
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageFont

random.seed(7)
ITEMS = [
    ("FC MILK 2L", 3.80), ("LITE MILK 1L", 2.10), ("GREEK YOGHURT 1KG", 6.50), ("TASTY CHEESE 500G", 8.00),
    ("FREE RANGE EGGS 12PK", 7.20), ("WHITE BREAD 700G", 3.40), ("SOURDOUGH LOAF", 6.50), ("CHICKEN THIGH FILLET", 13.68),
    ("BEEF MINCE 500G", 7.50), ("PASTA PENNE 500G", 1.95), ("RICE JASMINE 5KG", 15.00), ("TIN TOMATOES 400G", 5.00),
    ("PEANUT BUTTER 375G", 4.20), ("WEETBIX 575G", 4.80), ("BABY WIPES 80PK", 5.50), ("NAPPIES SZ4 54PK", 24.00),
    ("DISHWASHING LIQ 500ML", 3.25), ("TOILET PAPER 12PK", 9.00), ("TOOTHPASTE 110G", 4.00), ("APPLES PINK LADY", 4.47),
    ("CARROTS 1KG", 2.50), ("BROCCOLI", 2.98), ("POTATOES 2KG", 4.90), ("ONIONS BROWN 1KG", 3.20),
    ("ORANGE JUICE 2L", 5.60), ("COFFEE BEANS 1KG", 22.00), ("CHOC CHIP COOKIES", 3.50), ("FROZEN PEAS 1KG", 3.00),
]
total = round(sum(p for _, p in ITEMS) - 2.00 + 0.15, 2)
lines = [("GROCERWAY", None), ("Shop 4 Station Rd Blacktown", None), ("ABN 98 765 432 109", None), ("14/11/2026 10:05 REG 2", None), ("", None)]
lines += ITEMS[:8]
lines += [("CHICKEN THIGH FILLET", None), ("  1.140 kg @ $12.00/kg", 13.68)]
lines = [l for l in lines if l != ("CHICKEN THIGH FILLET", 13.68)]
lines += ITEMS[8:11] + [("TIN TOMATOES 400G", None), ("  2 @ $2.50", 5.00)] + ITEMS[12:]
lines += [("BAG", 0.15), ("MEMBER SAVINGS", -2.00), ("", None), ("TOTAL", total), ("VISA", total), ("GST INCLUDED 4.11", None)]

font = ImageFont.truetype("C:/Windows/Fonts/consola.ttf", 30)
W, lh = 700, 40
paper = Image.new("L", (W, 60 + lh * len(lines)), 236)
d = ImageDraw.Draw(paper)
y = 30
for text, amt in lines:
    ink = random.randint(95, 125)  # faint thermal print
    d.text((30, y), text, font=font, fill=ink)
    if amt is not None:
        s = f"{amt:.2f}"
        d.text((W - 30 - d.textlength(s, font=font), y), s, font=font, fill=ink)
    y += lh
paper = paper.rotate(4, expand=True, fillcolor=70, resample=Image.BICUBIC)
bg = Image.new("L", (paper.width + 120, paper.height + 160), 70)
bg.paste(paper, (60, 80))
# uneven light: darker towards the bottom right
shade = Image.linear_gradient("L").resize(bg.size).point(lambda v: 255 - v // 4)
bg = Image.composite(bg, Image.new("L", bg.size, 0), shade.point(lambda v: v))
bg = bg.filter(ImageFilter.GaussianBlur(1.3)).resize((bg.width * 3 // 4, bg.height * 3 // 4))
here = Path(__file__).parent
bg.convert("RGB").save(here / "hard_receipt.jpg", quality=70)
truth = {"total": total, "items": [{"name": n, "price": p} for n, p in ITEMS]}
(here / "hard_receipt.json").write_text(json.dumps(truth, indent=1))
print("hard_receipt.jpg", bg.size, "total", total)
