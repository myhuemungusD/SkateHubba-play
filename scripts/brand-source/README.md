# Brand source artwork

Canonical source PNGs for every SkateHubba derived asset (favicons, PWA icons,
iOS AppIcon, iOS launch splash, OG card, README hero, in-app horizontal mark).

| File                  | Used for                                               |
| --------------------- | ------------------------------------------------------ |
| `fiery-badge.png`     | OG/Twitter social card, README hero, iOS launch splash |
| `black-badge.png`     | iOS AppIcon, PWA icons, favicons, apple-touch-icon     |
| `landscape-light.png` | In-app horizontal logo (`public/logonew.webp`)         |

## Regenerating derived assets

```bash
python3 scripts/generate-brand-assets.py
```

Requires Pillow (`pip install Pillow`) and pngquant (`apt install pngquant`)
for PNG quantization. pngquant is optional — outputs are still valid without
it, just larger.

The script writes into `public/`, `resources/`, `ios/App/App/Assets.xcassets/`,
and `docs/screenshots/`. iOS-bound assets (`AppIcon-512@2x.png`, splash files)
are written as strict RGB PNGs with no alpha channel — App Store review
rejects palette PNGs and images with transparency on app icons.

## Capacitor masters

`resources/icon.png` (1024×1024) and `resources/splash.png` (2732×2732) are
also generated here so `npx @capacitor/assets generate` can produce per-density
variants if/when the team wants Android icons too.
