#!/usr/bin/env python3
"""Build a dark contact sheet of the composed App Store screenshots."""

import glob
import os
from PIL import Image, ImageDraw

BASE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(BASE, "out")

CARDS = sorted(glob.glob(os.path.join(OUT, "*.png")))
CARDS = [c for c in CARDS if not os.path.basename(c).startswith("_")]

BG = (26, 26, 26)
H = 900
GAP = 26
MARGIN = 46
RADIUS = 46


def rounded(img, radius):
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, img.size[0] - 1, img.size[1] - 1], radius=radius, fill=255)
    out = img.convert("RGBA")
    out.putalpha(mask)
    return out


def row(cards, y):
    thumbs = []
    for c in cards:
        im = Image.open(c).convert("RGB")
        w = round(H * im.size[0] / im.size[1])
        thumbs.append(rounded(im.resize((w, H), Image.LANCZOS), RADIUS))
    total = sum(t.size[0] for t in thumbs) + GAP * (len(thumbs) - 1)
    x = (W - total) // 2
    for t in thumbs:
        sheet.paste(t, (x, y), t)
        x += t.size[0] + GAP


top = CARDS[:5]
bottom = CARDS[5:]
thumb_w = round(H * 1320 / 2868)
W = MARGIN * 2 + thumb_w * 5 + GAP * 4
sheet_h = MARGIN * 2 + H * 2 + GAP
sheet = Image.new("RGB", (W, sheet_h), BG)
row(top, MARGIN)
row(bottom, MARGIN + H + GAP)
sheet.save(os.path.join(OUT, "_contact-sheet.png"))
print("wrote _contact-sheet.png", sheet.size)
