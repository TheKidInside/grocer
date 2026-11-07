"""Render a phone-photo-like supermarket receipt (slight tilt, grey background, noise)."""
import random
from PIL import Image, ImageDraw, ImageFont, ImageFilter

LINES = [
    ("FRESHWAY MARKET", None), ("12 King St, Parramatta", None), ("ABN 12 345 678 901", None), ("", None),
    ("06/11/2026  17:42   REG 03", None), ("", None),
    ("FC MILK 2L", "3.80"),
    ("BANANAS CAVENDISH", None), ("  0.856 kg @ $3.90/kg", "3.34"),
    ("SOURDOUGH LOAF 750G", "6.50"),
    ("EGGS FREE RANGE 12PK", "7.20"),
    ("TIN TOMATOES 400G", None), ("  2 @ $2.50", "5.00"),
    ("NAPPIES SZ4 54PK", "24.00"),
    ("REUSABLE BAG", "0.15"),
    ("LOYALTY DISCOUNT", "-1.00"),
    ("", None), ("TOTAL", "48.99"), ("EFTPOS", "48.99"), ("", None),
    ("GST INCLUDED IN TOTAL  2.22", None), ("THANK YOU FOR SHOPPING", None),
]

font = ImageFont.truetype("C:/Windows/Fonts/consola.ttf", 34)
W, lh = 760, 46
paper = Image.new("RGB", (W, 80 + lh * len(LINES)), (250, 248, 240))
d = ImageDraw.Draw(paper)
y = 40
for text, amt in LINES:
    d.text((40, y), text, font=font, fill=(35, 35, 35))
    if amt:
        tw = d.textlength(amt, font=font)
        d.text((W - 40 - tw, y), amt, font=font, fill=(35, 35, 35))
    y += lh

bg = Image.new("RGB", (1500, 1700), (92, 88, 80))
paper = paper.rotate(2.5, expand=True, fillcolor=(92, 88, 80), resample=Image.BICUBIC)
bg.paste(paper, ((1500 - paper.width) // 2, (1700 - paper.height) // 2))
random.seed(1)
px = bg.load()
for _ in range(60000):
    x, yy = random.randrange(bg.width), random.randrange(bg.height)
    r, g, b = px[x, yy]
    n = random.randint(-18, 18)
    px[x, yy] = (max(0, min(255, r + n)), max(0, min(255, g + n)), max(0, min(255, b + n)))
bg = bg.filter(ImageFilter.GaussianBlur(0.8))
out = __file__.replace("make_receipt.py", "receipt.jpg")  # tests/fixtures/receipt.jpg
bg.save(out, quality=82)
print(out)
