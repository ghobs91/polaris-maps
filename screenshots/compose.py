#!/usr/bin/env python3
"""Compose App Store screenshots for Polaris Maps in the styled card format.

Renders 1320x2868 (6.9" iPhone) cards: purple background, white title, icon,
and the raw app screenshot inside a phone bezel.

Usage: python3 screenshots/compose.py
Raw captures: screenshots/raw/*.png ; outputs: screenshots/out/*.png
"""

import json
import os
from PIL import Image, ImageDraw, ImageFont

BASE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(BASE)
RAW = os.path.join(BASE, "raw")
OUT = os.path.join(BASE, "out")
os.makedirs(OUT, exist_ok=True)

W, H = 1320, 2868
PURPLE = (108, 92, 231)  # #6C5CE7
PURPLE_DARK = (92, 76, 214)
WHITE = (255, 255, 255)
INK = (26, 26, 46)

FONT_ROUNDED = "/System/Library/Fonts/SFNSRounded.ttf"
FONT_SF = "/System/Library/Fonts/SFNS.ttf"
ICON_FONT = os.path.join(
    ROOT,
    "node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/MaterialCommunityIcons.ttf",
)
GLYPHMAP = os.path.join(
    ROOT,
    "node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/MaterialCommunityIcons.json",
)
GLYPHS = json.load(open(GLYPHMAP))


def font(size, weight="Bold", rounded=True):
    path = FONT_ROUNDED if rounded else FONT_SF
    f = ImageFont.truetype(path, size)
    try:
        f.set_variation_by_name(weight)
    except Exception:
        pass
    return f


def icon_font(size):
    return ImageFont.truetype(ICON_FONT, size)


def rounded_mask(size, radius):
    mask = Image.new("L", size, 0)
    d = ImageDraw.Draw(mask)
    d.rounded_rectangle([0, 0, size[0] - 1, size[1] - 1], radius=radius, fill=255)
    return mask


def draw_centered_text(draw, text, f, y, fill, line_gap=6):
    lines = text.split("\n")
    ascent, descent = f.getmetrics()
    line_h = ascent + descent + line_gap
    total = line_h * len(lines)
    cy = y - total / 2
    for line in lines:
        w = draw.textlength(line, font=f)
        draw.text(((W - w) / 2, cy), line, font=f, fill=fill)
        cy += line_h
    return total


def compose(card):
    img = Image.new("RGB", (W, H), PURPLE)
    d = ImageDraw.Draw(img)

    # Subtle top-down light gradient for depth.
    grad = Image.new("L", (W, H), 0)
    gd = ImageDraw.Draw(grad)
    span = int(H * 0.5)
    for yy in range(span):
        a = int(34 * (1 - yy / span) ** 1.5)
        gd.line([(0, yy), (W, yy)], fill=a)
    img.paste(Image.new("RGB", (W, H), WHITE), (0, 0), grad)

    # Title + icon in the top band.
    title_font = font(96, "Heavy")
    draw_centered_text(d, card["title"], title_font, 250, WHITE)

    ic = card.get("icon")
    if ic:
        glyph = GLYPHS.get(ic)
        if glyph:
            f = icon_font(112)
            ch = chr(glyph)
            w = d.textlength(ch, font=f)
            d.text(((W - w) / 2, 360), ch, font=f, fill=WHITE)

    # Phone bezel.
    screen_w = 1040
    screen_h = round(screen_w * 2868 / 1320)
    x = (W - screen_w) // 2
    y = 560
    bezel = 24
    r_bezel = 128
    r_screen = 104

    d.rounded_rectangle(
        [x - bezel, y - bezel, x + screen_w + bezel, y + screen_h + bezel],
        radius=r_bezel,
        fill=(10, 10, 12),
    )
    d.rounded_rectangle(
        [x - bezel, y - bezel, x + screen_w + bezel, y + screen_h + bezel],
        radius=r_bezel,
        outline=(46, 46, 54),
        width=3,
    )

    raw = Image.open(card["raw"]).convert("RGB").resize((screen_w, screen_h), Image.LANCZOS)
    img.paste(raw, (x, y), rounded_mask((screen_w, screen_h), r_screen))

    # Optional callout bubble.
    co = card.get("callout")
    if co:
        cf = font(58, "Bold")
        pad_x, pad_y = 56, 44
        tmp = ImageDraw.Draw(Image.new("RGB", (10, 10)))
        lines = co["text"].split("\n")
        asc, desc = cf.getmetrics()
        line_h = asc + desc + 4
        bw = int(max(tmp.textlength(l, font=cf) for l in lines)) + pad_x * 2
        bh = line_h * len(lines) + pad_y * 2
        bx = (W - bw) // 2
        by = y + int(screen_h * co.get("at", 0.42))
        d.rounded_rectangle(
            [bx + 6, by + 10, bx + bw + 6, by + bh + 10], radius=40, fill=(0, 0, 0, 40)
        )
        d.rounded_rectangle([bx, by, bx + bw, by + bh], radius=40, fill=(255, 255, 255))
        cy = by + pad_y
        for line in lines:
            w = tmp.textlength(line, font=cf)
            d.text((bx + (bw - w) / 2, cy), line, font=cf, fill=INK)
            cy += line_h

    img.save(os.path.join(OUT, card["out"]))
    print("wrote", card["out"])


def compose_ipad(card):
    """Render a 2064x2752 iPad card (same style, larger canvas)."""
    w, h = 2064, 2752
    img = Image.new("RGB", (w, h), PURPLE)
    d = ImageDraw.Draw(img)

    grad = Image.new("L", (w, h), 0)
    gd = ImageDraw.Draw(grad)
    span = int(h * 0.5)
    for yy in range(span):
        a = int(34 * (1 - yy / span) ** 1.5)
        gd.line([(0, yy), (w, yy)], fill=a)
    img.paste(Image.new("RGB", (w, h), WHITE), (0, 0), grad)

    tf = font(132, "Heavy")
    lines = card["title"].split("\n")
    asc, desc = tf.getmetrics()
    line_h = asc + desc + 8
    total = line_h * len(lines)
    cy = 250 - total / 2
    for line in lines:
        tw = d.textlength(line, font=tf)
        d.text(((w - tw) / 2, cy), line, font=tf, fill=WHITE)
        cy += line_h

    glyph = GLYPHS.get(card.get("icon"))
    if glyph:
        f = icon_font(156)
        ch = chr(glyph)
        tw = d.textlength(ch, font=f)
        d.text(((w - tw) / 2, 430), ch, font=f, fill=WHITE)

    sw = 1500
    sh = round(sw * h / w)
    x = (w - sw) // 2
    y = 660
    bez = 26
    d.rounded_rectangle([x - bez, y - bez, x + sw + bez, y + sh + bez], radius=96, fill=(10, 10, 12))
    d.rounded_rectangle(
        [x - bez, y - bez, x + sw + bez, y + sh + bez], radius=96, outline=(46, 46, 54), width=3
    )
    raw = Image.open(card["raw"]).convert("RGB").resize((sw, sh), Image.LANCZOS)
    img.paste(raw, (x, y), rounded_mask((sw, sh), 74))
    img.save(os.path.join(OUT, card["out"]))
    print("wrote", card["out"])


IPAD_CARDS = [
    {
        "out": "ipad-01-explore.png",
        "raw": os.path.join(RAW, "ipad-map.png"),
        "title": "Explore\nin 3D",
        "icon": "cube-outline",
    },
]

CARDS = [
    {
        "out": "01-live-traffic.png",
        "raw": os.path.join(RAW, "live-traffic.png"),
        "title": "Live traffic,\ncrowd-sourced",
        "icon": "traffic-light",
    },
    {
        "out": "02-transit.png",
        "raw": os.path.join(RAW, "transit.png"),
        "title": "Every mode,\none trip",
        "icon": "train",
    },
    {
        "out": "03-satellite.png",
        "raw": os.path.join(RAW, "satellite.png"),
        "title": "Satellite\nimagery",
        "icon": "satellite-variant",
    },
    {
        "out": "04-street-level.png",
        "raw": os.path.join(RAW, "street-level.png"),
        "title": "Walk the street\nbefore you go",
        "icon": "panorama",
    },
    {
        "out": "05-best-route.png",
        "raw": os.path.join(RAW, "navigation.png"),
        "title": "The best route,\nright now",
        "icon": "routes",
    },
    {
        "out": "06-place-details.png",
        "raw": os.path.join(RAW, "place-details.png"),
        "title": "Rich details,\nwithout the clutter",
        "icon": "map-marker-star",
    },
    {
        "out": "07-offline-maps.png",
        "raw": os.path.join(RAW, "regions.png"),
        "title": "Download\noffline maps",
        "icon": "download",
    },
    {
        "out": "08-carplay.png",
        "raw": os.path.join(RAW, "carplay.png"),
        "title": "CarPlay\nready",
        "icon": "car",
    },
]

if __name__ == "__main__":
    for c in CARDS:
        if os.path.exists(c["raw"]):
            compose(c)
        else:
            print("MISSING", c["raw"])
    for c in IPAD_CARDS:
        if os.path.exists(c["raw"]):
            compose_ipad(c)
        else:
            print("MISSING", c["raw"])
