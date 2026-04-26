"""Regenerate every SkateHubba brand asset from canonical source PNGs.

This is a one-shot reproducibility tool, not a build step. Run it whenever
the source artwork in scripts/brand-source/ changes.

    python3 scripts/generate-brand-assets.py

Requirements: Pillow (pip install Pillow), pngquant (apt install pngquant).
pngquant is optional — if missing, palette PNGs from Pillow are used as-is.

Sources (scripts/brand-source/):
    fiery-badge.png        1536x1024 RGBA — the fiery orange hero
    black-badge.png        1536x1024 RGBA — black-circle SkateHubba badge
    landscape-light.png    1536x1024 RGB  — white-circle badge (used in-app on
                                            the dark #0A0A0A header for max
                                            contrast at small heights)

Outputs:
    public/logonew.webp                    — in-app horizontal mark (used app-wide)
    public/icon-192.png, icon-512.png      — PWA "any" icons
    public/icon-maskable-192/512.png       — PWA "maskable" icons (80% safe zone)
    public/apple-touch-icon.png            — iOS home-screen (180x180)
    public/favicon-16.png, favicon-32.png  — browser tab icons
    public/favicon.ico                     — multi-res .ico (16+32)
    public/og-image.png                    — 1200x630 social card (Open Graph + Twitter)
    resources/icon.png                     — Capacitor master (1024x1024 RGB, opaque)
    resources/splash.png                   — Capacitor master (2732x2732 RGB, opaque)
    ios/.../AppIcon-512@2x.png             — iOS app icon (1024x1024 RGB, App Store grade)
    ios/.../Splash.imageset/*.png          — iOS launch splash (2732x2732 RGB) x3
    docs/screenshots/logo-black.png        — README hero (light mode)
    docs/screenshots/logo-white.webp       — README hero (dark mode)
"""
from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "scripts" / "brand-source"
PUBLIC = ROOT / "public"
IOS_ICON = ROOT / "ios" / "App" / "App" / "Assets.xcassets" / "AppIcon.appiconset"
IOS_SPLASH = ROOT / "ios" / "App" / "App" / "Assets.xcassets" / "Splash.imageset"
RESOURCES = ROOT / "resources"
DOCS = ROOT / "docs" / "screenshots"

BG = (0x0A, 0x0A, 0x0A)  # matches index.html theme_color and tailwind bg-[#0A0A0A]


def load(name: str) -> Image.Image:
    return Image.open(SRC / name).convert("RGBA")


def crop_center_square(img: Image.Image) -> Image.Image:
    w, h = img.size
    side = min(w, h)
    return img.crop(((w - side) // 2, (h - side) // 2, (w + side) // 2, (h + side) // 2))


def flatten(img: Image.Image, bg: tuple[int, int, int] = BG) -> Image.Image:
    if img.mode != "RGBA":
        return img.convert("RGB")
    out = Image.new("RGB", img.size, bg)
    out.paste(img, mask=img.split()[3])
    return out


def palette(img: Image.Image, colors: int) -> Image.Image:
    return img.convert("P", palette=Image.ADAPTIVE, colors=colors)


def write_png(img: Image.Image, path: Path, *, optimize: bool = True) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, "PNG", optimize=optimize)
    _pngquant(path)


def write_rgb_png(img: Image.Image, path: Path) -> None:
    """Write a strict RGB PNG with sRGB profile — required by Apple App Store.

    No palette, no alpha, no pngquant pass (palette mode is rejected). Used for
    iOS AppIcon-1024 and the Capacitor masters.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    rgb = img.convert("RGB") if img.mode != "RGB" else img
    rgb.save(path, "PNG", optimize=True)


def _pngquant(path: Path) -> None:
    """Lossless-ish quantization pass; no-op if pngquant isn't installed."""
    if not shutil.which("pngquant"):
        return
    tmp = path.with_suffix(path.suffix + ".tmp")
    try:
        subprocess.run(
            ["pngquant", "--quality=90-100", "--speed=1", "--strip", "--force",
             "--output", str(tmp), str(path)],
            check=True, capture_output=True,
        )
        if tmp.stat().st_size < path.stat().st_size:
            tmp.replace(path)
        else:
            tmp.unlink(missing_ok=True)
    except subprocess.CalledProcessError:
        tmp.unlink(missing_ok=True)


def maskable(square: Image.Image, size: int, scale: float = 0.80) -> Image.Image:
    """80% safe zone on solid-bg canvas — survives Android adaptive mask."""
    inner = int(round(size * scale))
    logo = square.resize((inner, inner), Image.LANCZOS)
    canvas = Image.new("RGBA", (size, size), BG + (255,))
    canvas.paste(logo, ((size - inner) // 2, (size - inner) // 2), logo)
    return flatten(canvas)


def og_card(fiery: Image.Image, w: int = 1200, h: int = 630) -> Image.Image:
    """1200x630 social card: fiery logo on dark theme bg, opaque RGB."""
    canvas = Image.new("RGBA", (w, h), BG + (255,))
    # Fit the logo to ~85% of the card height, preserving aspect ratio.
    src_w, src_h = fiery.size
    target_h = int(h * 0.85)
    target_w = int(src_w * target_h / src_h)
    if target_w > int(w * 0.92):
        target_w = int(w * 0.92)
        target_h = int(src_h * target_w / src_w)
    logo = fiery.resize((target_w, target_h), Image.LANCZOS)
    canvas.paste(logo, ((w - target_w) // 2, (h - target_h) // 2), logo)
    return flatten(canvas)


def splash_canvas(fiery: Image.Image, size: int = 2732, scale: float = 0.32) -> Image.Image:
    """Native splash: dark canvas with centered logo at ~32% of canvas.

    Square 2732x2732 is Capacitor's universal splash size — iOS crops/letterboxes
    it for each device. Keep the logo small enough that it stays centered after
    aggressive crops on tall iPhones (e.g., 1290x2796 on iPhone 15 Pro Max).
    """
    canvas = Image.new("RGBA", (size, size), BG + (255,))
    src_w, src_h = fiery.size
    target_w = int(size * scale)
    target_h = int(src_h * target_w / src_w)
    logo = fiery.resize((target_w, target_h), Image.LANCZOS)
    canvas.paste(logo, ((size - target_w) // 2, (size - target_h) // 2), logo)
    return flatten(canvas)


def main() -> None:
    fiery = load("fiery-badge.png")
    black = load("black-badge.png")
    landscape = load("landscape-light.png")

    # Square 1024 source for icons (cropped from black-badge)
    square_rgba = crop_center_square(black).resize((1024, 1024), Image.LANCZOS)
    square_rgb = flatten(square_rgba)

    # In-app horizontal mark (every screen renders this). Uses the white-circle
    # variant so the badge stays visible on the app's dark #0A0A0A surfaces
    # even at h-4 (16px). The image's black framing blends with the header.
    landscape.save(PUBLIC / "logonew.webp", "WEBP", quality=92, method=6)

    # PWA "any" icons
    icon_192 = palette(square_rgb.resize((192, 192), Image.LANCZOS), 64)
    icon_512 = palette(square_rgb.resize((512, 512), Image.LANCZOS), 128)
    write_png(icon_192, PUBLIC / "icon-192.png")
    write_png(icon_512, PUBLIC / "icon-512.png")

    # PWA "maskable" icons (80% safe zone on solid bg)
    write_png(palette(maskable(square_rgba, 192), 64), PUBLIC / "icon-maskable-192.png")
    write_png(palette(maskable(square_rgba, 512), 128), PUBLIC / "icon-maskable-512.png")

    # iOS canonical apple-touch-icon (180x180)
    apple = square_rgb.resize((180, 180), Image.LANCZOS)
    write_png(palette(apple, 64), PUBLIC / "apple-touch-icon.png")

    # Browser tab favicons
    fav32 = square_rgb.resize((32, 32), Image.LANCZOS)
    fav16 = square_rgb.resize((16, 16), Image.LANCZOS)
    write_png(palette(fav32, 64), PUBLIC / "favicon-32.png")
    write_png(palette(fav16, 32), PUBLIC / "favicon-16.png")
    fav32.save(PUBLIC / "favicon.ico", sizes=[(16, 16), (32, 32)])

    # OG/Twitter social card
    write_png(og_card(fiery), PUBLIC / "og-image.png")

    # iOS app icon: strict RGB, no alpha, no palette — App Store reviewers
    # have rejected indexed PNGs. Don't run pngquant on this file.
    write_rgb_png(square_rgb, IOS_ICON / "AppIcon-512@2x.png")

    # Capacitor masters — input for `npx @capacitor/assets generate` if the
    # team ever wants per-density auto-generation. Strict RGB / opaque.
    write_rgb_png(square_rgb, RESOURCES / "icon.png")
    splash = splash_canvas(fiery)
    write_rgb_png(splash, RESOURCES / "splash.png")

    # iOS launch splash (2732x2732 universal). Contents.json declares 1x/2x/3x
    # all pointing at this size — Xcode picks per-device.
    for filename in (
        "splash-2732x2732.png",
        "splash-2732x2732-1.png",
        "splash-2732x2732-2.png",
    ):
        write_rgb_png(splash, IOS_SPLASH / filename)

    # README hero (downsized so the repo isn't bloated by the 2 MB source)
    hero_w = 600
    hero = fiery.resize(
        (hero_w, int(fiery.size[1] * hero_w / fiery.size[0])), Image.LANCZOS,
    )
    write_png(flatten(hero), DOCS / "logo-black.png")
    hero.save(DOCS / "logo-white.webp", "WEBP", quality=90, method=6)

    # Report
    print("Generated:")
    for p in [
        PUBLIC / "logonew.webp",
        PUBLIC / "icon-192.png",
        PUBLIC / "icon-512.png",
        PUBLIC / "icon-maskable-192.png",
        PUBLIC / "icon-maskable-512.png",
        PUBLIC / "apple-touch-icon.png",
        PUBLIC / "favicon-16.png",
        PUBLIC / "favicon-32.png",
        PUBLIC / "favicon.ico",
        PUBLIC / "og-image.png",
        RESOURCES / "icon.png",
        RESOURCES / "splash.png",
        IOS_ICON / "AppIcon-512@2x.png",
        IOS_SPLASH / "splash-2732x2732.png",
        IOS_SPLASH / "splash-2732x2732-1.png",
        IOS_SPLASH / "splash-2732x2732-2.png",
        DOCS / "logo-black.png",
        DOCS / "logo-white.webp",
    ]:
        print(f"  {p.stat().st_size:>8}  {p.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
