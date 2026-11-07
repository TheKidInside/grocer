"""Draw an EAN-13 barcode and write it as a Y4M video, for Chromium's fake camera
(--use-file-for-fake-video-capture). Lets the e2e test exercise the real camera
scanning path without a phone.  Usage: py -3 make_barcode_video.py 9300650658516"""
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"]
G = ["0100111", "0110011", "0011011", "0100001", "0011101", "0111001", "0000101", "0010001", "0001001", "0010111"]
R = ["1110010", "1100110", "1101100", "1000010", "1011100", "1001110", "1010000", "1000100", "1001000", "1110100"]
PARITY = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"]


def ean13_bits(code):
    d = [int(c) for c in code]
    bits = "101"
    for i, p in enumerate(PARITY[d[0]]):
        bits += (L if p == "L" else G)[d[1 + i]]
    bits += "01010"
    for x in d[7:]:
        bits += R[x]
    return bits + "101"


def main(code, out):
    W, H, module = 640, 480, 4
    img = Image.new("RGB", (W, H), "white")
    draw = ImageDraw.Draw(img)
    bits = ean13_bits(code)
    x0 = (W - len(bits) * module) // 2
    for i, b in enumerate(bits):
        if b == "1":
            draw.rectangle([x0 + i * module, 120, x0 + (i + 1) * module - 1, 340], fill="black")
    draw.text((x0, 350), code, fill="black", font=ImageFont.truetype("C:/Windows/Fonts/consola.ttf", 28))
    y = img.convert("L")
    frame_y = y.tobytes()
    frame_uv = bytes([128]) * ((W // 2) * (H // 2))
    with open(out, "wb") as f:
        f.write(f"YUV4MPEG2 W{W} H{H} F10:1 Ip A1:1 C420jpeg\n".encode())
        for _ in range(10):
            f.write(b"FRAME\n" + frame_y + frame_uv + frame_uv)


if __name__ == "__main__":
    code = sys.argv[1] if len(sys.argv) > 1 else "9300650658516"
    main(code, str(Path(__file__).with_name("barcode.y4m")))
    print("wrote barcode.y4m")
