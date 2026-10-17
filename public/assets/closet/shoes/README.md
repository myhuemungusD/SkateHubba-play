# Mike White Signature Shoe Assets

## Source Art

Located at: `design/closet/mike-white-shoe.png` (branch: `assets/mike-white-shoe`)

- Original: 1774x887px PNG with transparency
- Features: Tan/white/navy colorway, yellow laces, black-on-yellow triangle logo
- Shows: Side pair + front pair

## Asset Requirements

### Card View (`mike-white-signature-card.png`)

**Current**: Placeholder (needs optimization)
**Target**:

- Clean transparent PNG/WebP
- Front view of single shoe
- Optimized/compressed (~50-100KB)
- Dimensions: ~400x400px
- Used in: Item cards, shop UI, trade previews

### Avatar View (`mike-white-signature-avatar.png`)

**Current**: Placeholder (needs optimization)
**Target**:

- Clean transparent PNG/WebP
- Side view of single shoe
- Optimized/compressed (~30-50KB)
- Dimensions: ~200x150px (fits Avatar2D feet slot)
- Used in: 2D avatar rendering on profiles

## Optimization Checklist

- [ ] Extract clean side view from source art
- [ ] Extract clean front view from source art
- [ ] Remove background, ensure clean transparency
- [ ] Compress with pngquant/optipng or convert to WebP
- [ ] Test rendering on Avatar2D component
- [ ] Test in item card UI

## Design Notes

- Pro signature item: credited to Mike White
- Slot: shoes
- Rarity: limited (pro signature tier)
- Source: earnable/drop only (never purchasable)
- Brand: Mike White (licensed signature)
