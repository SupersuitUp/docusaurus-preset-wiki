#!/usr/bin/env python3
"""Favicon + PWA icon set, generated from wiki.config.json.

A favicon has to be recognisable at 16x16, where a photograph or a detailed mark
is a smudge. So this draws a MONOGRAM: the first one or two initials of the wiki
title, in the brand accent on the brand ground. Two glyphs is the ceiling. Four
letters at 16px is a grey blur, which is the failure this exists to avoid.

Generating the set from one script rather than exporting sizes by hand is the
point: a brand change reaches every size in one run, and no size is left behind
at the old colour.

    wiki icons                                # initials from wiki.config title
    python3 scripts/build-icons.py --mark 15  # override the glyphs

Writes static/img/{icon-512,icon-192,apple-touch-icon,favicon}.png and
static/favicon.ico. Requires Pillow and fonttools (`uv pip install pillow fonttools brotli`).
"""
import argparse, json, os, re, subprocess, sys
from PIL import Image, ImageDraw, ImageFont

# The wiki root is the cwd `wiki icons` runs in; this file ships inside node_modules.
ROOT = os.getcwd()
FONT_URL = ("https://github.com/google/fonts/raw/main/ofl/fraunces/"
            "Fraunces%5BSOFT%2CWONK%2Copsz%2Cwght%5D.ttf")


def hex_rgb(v, fallback):
    m = re.fullmatch(r"#?([0-9a-fA-F]{6})", str(v or ""))
    return tuple(int(m.group(1)[i:i + 2], 16) for i in (0, 2, 4)) if m else fallback


def initials(title):
    words = [w for w in re.split(r"[^A-Za-z0-9]+", title) if w]
    if not words:
        return "W"
    if len(words) == 1:
        return words[0][:2].upper() if not words[0].isdigit() else words[0][:2]
    return (words[0][0] + words[1][0]).upper()


def font(size):
    """Fraunces, instanced at a LOW optical size on purpose: the display cut's
    hairlines disappear at favicon scale. Variable fonts also default to their
    heaviest instance in some renderers, so pin the weight explicitly."""
    p = os.path.join(ROOT, "scripts/cache/Fraunces.ttf")
    if not os.path.exists(p):
        os.makedirs(os.path.dirname(p), exist_ok=True)
        subprocess.run(["curl", "-sL", "-o", p, FONT_URL], check=True)
        from fontTools.ttLib import TTFont
        from fontTools.varLib import instancer
        f = TTFont(p)
        f.flavor = None
        if "fvar" in f:
            f = instancer.instantiateVariableFont(f, {"wght": 700, "opsz": 9}, inplace=False)
        f.save(p)
    return ImageFont.truetype(p, size)


def main():
    cfg = {}
    cfg_path = os.path.join(ROOT, "wiki.config.json")
    if os.path.exists(cfg_path):
        cfg = json.load(open(cfg_path))
    og = cfg.get("og", {})

    ap = argparse.ArgumentParser()
    ap.add_argument("--mark", help="glyphs to draw (default: initials of the wiki title)")
    ap.add_argument("--bg", default=og.get("bg", "#0b0b0c"))
    ap.add_argument("--fg", default=og.get("accent", "#c9a227"))
    args = ap.parse_args()

    mark = (args.mark or initials(cfg.get("title", "Wiki")))[:2]
    bg, fg = hex_rgb(args.bg, (11, 11, 12)), hex_rgb(args.fg, (201, 162, 39))

    base = 512
    im = Image.new("RGB", (base, base), bg)
    d = ImageDraw.Draw(im)

    size = 300
    while size > 40:
        f = font(size)
        box = d.textbbox((0, 0), mark, font=f)
        if box[2] - box[0] <= base * 0.72 and box[3] - box[1] <= base * 0.62:
            break
        size -= 10
    box = d.textbbox((0, 0), mark, font=f)
    d.text(((base - (box[2] + box[0])) / 2, (base - (box[3] + box[1])) / 2), mark, font=f, fill=fg)

    out = os.path.join(ROOT, "static/img")
    os.makedirs(out, exist_ok=True)
    im.save(os.path.join(out, "icon-512.png"))
    im.resize((192, 192), Image.LANCZOS).save(os.path.join(out, "icon-192.png"))
    im.resize((180, 180), Image.LANCZOS).save(os.path.join(out, "apple-touch-icon.png"))
    im.resize((64, 64), Image.LANCZOS).save(os.path.join(out, "favicon.png"))
    im.resize((64, 64), Image.LANCZOS).save(
        os.path.join(ROOT, "static/favicon.ico"), sizes=[(16, 16), (32, 32), (48, 48)])

    proof = os.path.join(ROOT, "scripts/cache/favicon-16.png")
    im.resize((16, 16), Image.LANCZOS).resize((128, 128), Image.NEAREST).save(proof)
    print(f"wrote icon set for mark {mark!r} on {args.bg} / {args.fg}")
    print(f"OPEN {proof} AND CONFIRM THE MARK IS LEGIBLE. 16x16 is the only size that decides this.")


if __name__ == "__main__":
    main()
