#!/usr/bin/env python3
"""Build Mike White shoe skins + polished cards from his art.

Run manually (python3 + numpy + Pillow):  python3 scripts/closet/build_shoe_skins.py
Inputs : public/assets/closet/mike-white/mike-white-*.webp (side views, toe right)
Outputs: public/assets/closet/mike-white/card/<slug>.webp   polished 2D card, every design
         public/assets/closet/mike-white/skin/<slug>.webp   1024x512 side texture (360 skins)
         src/lib/closet/shoe360Skins.json                   silhouette profiles for the loft
To add a skin, put its slug in SKINS and rerun. Art in KEEP_FRAME (photos, split
backgrounds, multi-shoe sheets) keeps its original framing on the card and gets no skin.
"""
import json, os, glob
from collections import deque
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(ROOT, "public/assets/closet/mike-white")
SKINS = ["m-navy-gold", "m-red-grey", "m-blackout", "teeth-fire", "true-blues", "panda-wave", "redline", "creamsicle"]
KEEP_FRAME = {"signature-001", "dip-sets", "og-gum", "teeth-wave"}
COLS = 48
CARD = 512

def background_mask(rgb):
    h, w, _ = rgb.shape
    border = np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]]).astype(int)
    vals, counts = np.unique(border // 8, axis=0, return_counts=True)
    bg = vals[counts.argmax()] * 8 + 4
    near = (np.abs(rgb.astype(int) - bg).max(axis=2) < 34)
    seen = np.zeros((h, w), bool)
    q = deque()
    for y in range(h):
        for x in (0, w - 1):
            if near[y, x] and not seen[y, x]: seen[y, x] = True; q.append((y, x))
    for x in range(w):
        for y in (0, h - 1):
            if near[y, x] and not seen[y, x]: seen[y, x] = True; q.append((y, x))
    while q:
        y, x = q.popleft()
        for ny, nx in ((y+1,x),(y-1,x),(y,x+1),(y,x-1)):
            if 0 <= ny < h and 0 <= nx < w and near[ny, nx] and not seen[ny, nx]:
                seen[ny, nx] = True; q.append((ny, nx))
    return seen

def largest_component(fg):
    h, w = fg.shape
    lab = np.zeros((h, w), np.int32); best, best_n, cur = 0, 0, 0
    for sy, sx in zip(*np.nonzero(fg)):
        if lab[sy, sx]: continue
        cur += 1; n = 0; q = deque([(sy, sx)]); lab[sy, sx] = cur
        while q:
            y, x = q.popleft(); n += 1
            for ny, nx in ((y+1,x),(y-1,x),(y,x+1),(y,x-1)):
                if 0 <= ny < h and 0 <= nx < w and fg[ny, nx] and not lab[ny, nx]:
                    lab[ny, nx] = cur; q.append((ny, nx))
        if n > best_n: best, best_n = cur, n
    return lab == best

def cutout(path):
    rgb = np.array(Image.open(path).convert("RGB"))
    fg = ~background_mask(rgb)
    # Art pasted on an inset backdrop: the first pass only strips the margin.
    for _ in range(2):
        ys, xs = np.nonzero(fg)
        bx0, by0, bx1, by1 = xs.min(), ys.min(), xs.max() + 1, ys.max() + 1
        if fg[by0:by1, bx0:bx1].mean() < 0.9: break
        inner = rgb[by0 + 2:by1 - 2, bx0 + 2:bx1 - 2]
        full = np.ones(fg.shape, bool); full[by0 + 2:by1 - 2, bx0 + 2:bx1 - 2] = background_mask(inner)
        fg = ~full
    m = Image.fromarray((fg * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(3)).filter(ImageFilter.MaxFilter(3))
    fg = largest_component(np.array(m) > 127)
    # fill pinholes inside the silhouette
    inv = background_mask(np.dstack([(~fg * 255).astype(np.uint8)] * 3) ^ 255)
    fg = ~inv | fg
    ys, xs = np.nonzero(fg)
    box = (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)
    return rgb, fg, box

def bleed(rgb, mask, rounds=24):
    col = rgb.astype(float) * mask[..., None]; m = mask.astype(float)
    for _ in range(rounds):
        cb = np.array(Image.fromarray(np.clip(col, 0, 255).astype(np.uint8)).filter(ImageFilter.BoxBlur(3))).astype(float)
        mb = np.array(Image.fromarray((m * 255).astype(np.uint8)).filter(ImageFilter.BoxBlur(3))).astype(float) / 255
        fill = (m < 0.5) & (mb > 0.02)
        col[fill] = cb[fill] / mb[fill][:, None]
        m = np.where(fill, 1.0, m)
    return np.clip(col, 0, 255).astype(np.uint8)

def card_background():
    yy, xx = np.mgrid[0:CARD, 0:CARD] / CARD
    d = np.sqrt((xx - 0.5) ** 2 + (yy - 0.42) ** 2)
    base = np.array([38, 38, 42]) * (1 - d[..., None] * 0.9) + np.array([14, 14, 16]) * (d[..., None] * 0.9)
    return Image.fromarray(np.clip(base, 0, 255).astype(np.uint8)).convert("RGBA")

def make_card(rgb, fg, box, keep):
    bg = card_background()
    if keep:
        im = Image.fromarray(rgb).resize((CARD - 48, CARD - 48), Image.LANCZOS)
        bg.paste(im, (24, 24)); return bg.convert("RGB")
    x0, y0, x1, y1 = box
    rgba = np.dstack([rgb, (fg * 255).astype(np.uint8)])[y0:y1, x0:x1]
    shoe = Image.fromarray(rgba, "RGBA")
    s = min((CARD * 0.84) / shoe.width, (CARD * 0.62) / shoe.height)
    shoe = shoe.resize((max(1, int(shoe.width * s)), max(1, int(shoe.height * s))), Image.LANCZOS)
    px, py = (CARD - shoe.width) // 2, int(CARD * 0.52 - shoe.height / 2)
    sh = Image.new("L", (CARD, CARD), 0)
    ImageDraw.Draw(sh).ellipse((px + shoe.width * 0.06, py + shoe.height - 10, px + shoe.width * 0.94, py + shoe.height + 18), fill=150)
    sh = sh.filter(ImageFilter.GaussianBlur(12))
    bg = Image.composite(Image.new("RGBA", (CARD, CARD), (0, 0, 0, 255)), bg, sh)
    bg.alpha_composite(shoe, (px, py))
    return bg.convert("RGB")

def profile(fg, box):
    x0, y0, x1, y1 = box; h = y1 - y0; w = x1 - x0
    sub = fg[y0:y1, x0:x1]; top, bot = [], []
    for i in range(COLS):
        cx = min(w - 1, int((i + 0.5) / COLS * w))
        band = sub[:, max(0, cx - 2):cx + 3].any(axis=1)
        rows = np.nonzero(band)[0]
        if len(rows) == 0: top.append(0.0); bot.append(0.0); continue
        top.append(round(1 - rows.min() / h, 3)); bot.append(round(1 - (rows.max() + 1) / h, 3))
    return {"aspect": round(h / w, 4), "top": top, "bottom": bot}

def main():
    os.makedirs(os.path.join(SRC, "card"), exist_ok=True); os.makedirs(os.path.join(SRC, "skin"), exist_ok=True)
    manifest = {}
    for path in sorted(glob.glob(os.path.join(SRC, "mike-white-*.webp"))):
        slug = os.path.basename(path)[len("mike-white-"):-5]
        rgb, fg, box = cutout(path)
        make_card(rgb, fg, box, slug in KEEP_FRAME).save(os.path.join(SRC, "card", f"{slug}.webp"), quality=86, method=6)
        if slug in SKINS:
            x0, y0, x1, y1 = box
            tex = bleed(rgb, fg)[y0:y1, x0:x1]
            Image.fromarray(tex).resize((1024, 512), Image.LANCZOS).save(os.path.join(SRC, "skin", f"{slug}.webp"), quality=84, method=6)
            manifest["mike_white_" + slug.replace("-", "_")] = profile(fg, box)
        print("ok", slug)
    with open(os.path.join(ROOT, "src/lib/closet/shoe360Skins.json"), "w") as f:
        json.dump(manifest, f, separators=(",", ":")); f.write("\n")

if __name__ == "__main__":
    main()
