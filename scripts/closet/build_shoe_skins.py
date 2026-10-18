#!/usr/bin/env python3
"""Build Mike White shoe skins + polished cards from his art.

Run manually (python3 + numpy + Pillow):  python3 scripts/closet/build_shoe_skins.py
Inputs : public/assets/closet/mike-white/mike-white-*.webp (side views, toe right)
Outputs: public/assets/closet/mike-white/card/<slug>.webp   polished 2D card, every design
         public/assets/closet/mike-white/skin/<slug>.webp   1024x512 side texture (360 skins)
         src/lib/closet/shoe360Skins.json                   silhouette profiles for the loft
Multi-view sheets (design/closet/mike-white/<slug>/*.png, MULTI below) are split
into views, cut out, and packed into a 2048x1024 atlas at skin/<slug>.webp:
  outer (0,0,1024,512) | top (1024,0,2048,512, heel left, toe right)
  inner (0,512,1024,1024) | front (1024,512,1536,1024) | back (1536,512,2048,1024)
Every side view is stored toe-right. Missing views are listed in "needs" and the
viewer falls back to the side art for those faces.
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
DESIGN = os.path.join(ROOT, "design/closet/mike-white")
# slug -> list of (sheet file, view names left to right, side views drawn toe-left)
MULTI = {
    "heel-loop-white-red": [
        ("sheet-a-front-outer-back.png", ["front", "outer", "back"], {"outer"}),
        ("sheet-b-inner-top.png", ["inner", "top"], set()),
    ],
    # Rendered 5-view sheet; replaced Mike's first 3-view drawing. Its top view is
    # already heel-left ("top-landscape").
    "claw-runner": [
        ("sheet-b-5-views-labeled.png", {"outer": (22, 45, 803, 432), "inner": (840, 45, 1512, 432),
                                         "top": (420, 577, 1170, 855), "front": (45, 502, 360, 927),
                                         "back": (1207, 510, 1500, 927)}, {"outer", "top-landscape"}),
    ],
    # Labeled 2D sheet on grey: explicit boxes (x0, y0, x1, y1) that leave the text labels out.
    "dip-sets": [
        ("sheet-a-5-views-labeled.png", {"outer": (0, 112, 623, 435), "inner": (900, 128, 1523, 435),
                                         "top": (645, 8, 885, 630), "front": (240, 518, 570, 915),
                                         "back": (968, 525, 1268, 923)}, {"outer"}),
    ],
    "mw-patch-brown": [
        ("sheet-a-5-views-labeled.png", {"outer": (28, 28, 741, 409), "inner": (797, 28, 1509, 409),
                                         "top": (637, 403, 900, 947), "front": (103, 491, 435, 928),
                                         "back": (1097, 497, 1434, 928)}, {"outer"}),
    ],
    # Top view only so far: card art now, 360 skin once a side view lands.
    "claw-runner-royal": [
        ("sheet-a-top.png", ["top"], set()),
    ],
}
# Items that already have Mike's original art: the sheet only adds the 360 skin.
SKIN_ONLY = {"dip-sets", "mw-patch-brown"}
ALL_VIEWS = ["outer", "inner", "top", "front", "back"]
ATLAS = {"outer": (0, 0, 1024, 512), "top": (1024, 0, 2048, 512), "inner": (0, 512, 1024, 1024),
         "front": (1024, 512, 1536, 1024), "back": (1536, 512, 2048, 1024)}
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

def split_sheet(path, n):
    """Cut a sheet into its n views: columns of shoe separated by white gaps."""
    im = Image.open(path)
    if im.mode in ("RGBA", "LA", "P"):
        im = im.convert("RGBA"); alpha = np.array(im)[..., 3]
        white = Image.new("RGBA", im.size, (255, 255, 255, 255)); white.alpha_composite(im)
        rgb = np.array(white.convert("RGB"))
    else:
        rgb = np.array(im.convert("RGB")); alpha = None
    fg = alpha > 64 if alpha is not None else ~background_mask(rgb)
    cols = fg.sum(axis=0) > 2
    runs, x = [], 0
    while x < len(cols):
        if cols[x]:
            x0 = x
            while x < len(cols) and cols[x]: x += 1
            runs.append([x0, x])
        else: x += 1
    while len(runs) > n:  # merge the closest neighbours (a gap inside one shoe)
        gaps = [runs[i + 1][0] - runs[i][1] for i in range(len(runs) - 1)]
        i = int(np.argmin(gaps)); runs[i] = [runs[i][0], runs[i + 1][1]]; del runs[i + 1]
    if len(runs) != n: raise SystemExit(f"{path}: found {len(runs)} views, expected {n}")
    out = []
    for x0, x1 in runs:
        sl = slice(max(0, x0 - 8), min(rgb.shape[1], x1 + 8))
        crop = np.pad(rgb[:, sl], ((8, 8), (8, 8), (0, 0)), constant_values=255)
        mask = None if alpha is None else np.pad(fg[:, sl], ((8, 8), (8, 8)))
        out.append((crop, mask))
    return out

def flood_from_border(free):
    h, w = free.shape
    seen = np.zeros((h, w), bool); q = deque()
    for y in range(h):
        for x in (0, w - 1):
            if free[y, x] and not seen[y, x]: seen[y, x] = True; q.append((y, x))
    for x in range(w):
        for y in (0, h - 1):
            if free[y, x] and not seen[y, x]: seen[y, x] = True; q.append((y, x))
    while q:
        y, x = q.popleft()
        for ny, nx in ((y+1,x),(y-1,x),(y,x+1),(y,x-1)):
            if 0 <= ny < h and 0 <= nx < w and free[ny, nx] and not seen[ny, nx]:
                seen[ny, nx] = True; q.append((ny, nx))
    return seen

def split_boxes(path, boxes):
    rgb = np.array(Image.open(path).convert("RGB"))
    return [(name, (np.pad(rgb[y0:y1, x0:x1], ((8, 8), (8, 8), (0, 0)), mode="edge"), None))
            for name, (x0, y0, x1, y1) in boxes.items()]

def cutout_array(rgb, mask=None, seal=9):
    """Cut a view off its sheet. Transparent sheets use their alpha. White sheets:
    the dark outline is the wall, dilated to seal small gaps so the fill can't
    leak into a white shoe."""
    if mask is not None:
        fg = ~flood_from_border(~mask)
        ys, xs = np.nonzero(fg)
        return rgb, fg, (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)
    border = np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]]).astype(int)
    bg = np.median(border, axis=0)
    ink = np.abs(rgb.astype(int) - bg).max(axis=2) > (22 if bg.min() < 240 else 23)
    wall = np.array(Image.fromarray((ink * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(seal))) > 127
    outside = flood_from_border(~wall)
    grow = np.array(Image.fromarray((outside * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(seal))) > 127
    fg = largest_component(~grow | (ink & ~outside))
    fg = ~flood_from_border(~fg)  # fill holes
    ys, xs = np.nonzero(fg)
    return rgb, fg, (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)

def build_multi(slug, manifest):
    views = {}
    landscape_top = False
    for fname, names, toe_left in MULTI[slug]:
        landscape_top |= "top-landscape" in toe_left
        path = os.path.join(DESIGN, slug, fname)
        parts = split_boxes(path, names) if isinstance(names, dict) else zip(names, split_sheet(path, len(names)))
        for name, (crop, mask) in parts:
            if name in toe_left:
                crop = crop[:, ::-1].copy(); mask = None if mask is None else mask[:, ::-1].copy()
            views[name] = cutout_array(crop, mask)
    if "outer" not in views and "inner" not in views:
        # No side view: no loft profile yet, so no skin. Card + layer art from what we have.
        rgb, fg, (x0, y0, x1, y1) = views[next(iter(views))]
        flat = np.where(fg[..., None], rgb, 255).astype(np.uint8)[y0:y1, x0:x1]
        Image.fromarray(np.pad(flat, ((24, 24), (24, 24), (0, 0)), constant_values=255)).save(
            os.path.join(SRC, f"mike-white-{slug}.webp"), quality=88, method=6)
        print("ok multi", slug, sorted(views), "needs", [v for v in ALL_VIEWS if v not in views], "(no skin yet)")
        return
    atlas = Image.new("RGB", (2048, 1024), (40, 40, 44))
    for name, (rgb, fg, box) in views.items():
        x0, y0, x1, y1 = box
        tex = bleed(rgb, fg)[y0:y1, x0:x1]
        im = Image.fromarray(tex)
        if name == "top" and not landscape_top: im = im.rotate(90, expand=True)  # heel (top of art) to the left
        ax0, ay0, ax1, ay1 = ATLAS[name]
        atlas.paste(im.resize((ax1 - ax0, ay1 - ay0), Image.LANCZOS), (ax0, ay0))
    atlas.save(os.path.join(SRC, "skin", f"{slug}.webp"), quality=84, method=6)
    # Profile from the inner side (drawn toe-right) when we have it, else the outer.
    rgb, fg, box = views.get("inner") or views["outer"]
    entry = profile(fg, box)
    entry["views"] = sorted(views, key=ALL_VIEWS.index)
    entry["needs"] = [v for v in ALL_VIEWS if v not in views]
    manifest["mike_white_" + slug.replace("-", "_")] = entry
    # Layer art + card source: the outer side, toe right, on white. Never replace
    # Mike's original art when the item already has it.
    if slug in SKIN_ONLY:
        print("ok multi", slug, entry["views"], "needs", entry["needs"]); return
    o_rgb, o_fg, (x0, y0, x1, y1) = views["outer"]
    flat = np.where(o_fg[..., None], o_rgb, 255).astype(np.uint8)[y0:y1, x0:x1]
    Image.fromarray(np.pad(flat, ((24, 24), (24, 24), (0, 0)), constant_values=255)).save(
        os.path.join(SRC, f"mike-white-{slug}.webp"), quality=88, method=6)
    print("ok multi", slug, entry["views"], "needs", entry["needs"])

def main():
    os.makedirs(os.path.join(SRC, "card"), exist_ok=True); os.makedirs(os.path.join(SRC, "skin"), exist_ok=True)
    manifest = {}
    for slug in MULTI: build_multi(slug, manifest)
    for path in sorted(glob.glob(os.path.join(SRC, "mike-white-*.webp"))):
        slug = os.path.basename(path)[len("mike-white-"):-5]
        rgb, fg, box = cutout(path)
        make_card(rgb, fg, box, slug in KEEP_FRAME).save(os.path.join(SRC, "card", f"{slug}.webp"), quality=86, method=6)
        if slug in SKINS and slug not in MULTI:
            x0, y0, x1, y1 = box
            tex = bleed(rgb, fg)[y0:y1, x0:x1]
            Image.fromarray(tex).resize((1024, 512), Image.LANCZOS).save(os.path.join(SRC, "skin", f"{slug}.webp"), quality=84, method=6)
            manifest["mike_white_" + slug.replace("-", "_")] = profile(fg, box)
        print("ok", slug)
    with open(os.path.join(ROOT, "src/lib/closet/shoe360Skins.json"), "w") as f:
        json.dump(manifest, f, separators=(",", ":")); f.write("\n")

if __name__ == "__main__":
    main()
