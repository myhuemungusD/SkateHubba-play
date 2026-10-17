# Mike White Signature Shoe - Closet Item

## Overview

Pro signature shoe designed by Mike White. Limited edition (1000 supply), earnable/drop only, never purchasable.

## Item Details

- **ID**: `mike_white_signature_001`
- **Name**: Mike White Signature
- **Slot**: shoes
- **Rarity**: limited
- **Source**: pro_signature
- **Design**: Tan/White/Navy colorway, yellow laces, black-on-yellow triangle logo
- **Licensed**: Mike White signature license
- **Edition**: Limited (1000 supply)
- **Price**: Not purchasable (earn or drop only)

## Assets

- **Card View**: `/assets/closet/shoes/mike-white-signature-card.png` (1.4MB, needs optimization)
- **Avatar View**: `/assets/closet/shoes/mike-white-signature-avatar.png` (17KB)
- **Source Art**: `design/closet/mike-white-shoe.png` (branch: `assets/mike-white-shoe`)

### Asset Status

- ✅ Placeholder assets in place
- ⚠️ Card view needs compression (~50-100KB target)
- ⚠️ Assets need final cropping (side view for avatar, front for card)
- 📋 See `public/assets/closet/shoes/README.md` for optimization checklist

## Adding to Catalog

### Via Admin Tools (Recommended)

1. Enable closet feature flags
2. Navigate to Admin Catalog Tools screen
3. Use the item definition from `src/lib/closet/mikeWhiteShoe.ts`
4. Or call `closetAdmin` directly:

```ts
import { MIKE_WHITE_SIGNATURE_SHOE } from "./lib/closet/mikeWhiteShoe";

await closetAdmin({
  action: "createItem",
  params: {
    itemDefId: MIKE_WHITE_SIGNATURE_SHOE.itemDefId,
    item: MIKE_WHITE_SIGNATURE_SHOE,
  },
});
```

### Creating a Drop

To make this shoe available via Drop Day:

```ts
await closetAdmin({
  action: "createDrop",
  params: {
    dropId: "mike_white_shoe_drop_001",
    drop: {
      itemDefId: "mike_white_signature_001",
      startsAt: new Date("2026-11-01T00:00:00Z"),
      endsAt: new Date("2026-11-08T00:00:00Z"),
      drawEntryWindowEndsAt: null,
      stock: 250, // First 250 of 1000 total supply
      claimed: 0,
      requiresGames: 10, // Must have completed 10 games
      requiresAccountDays: 30, // Account must be 30+ days old
      isLive: false,
      isSoldOut: false,
      isDraw: false,
    },
  },
});
```

## Testing

All tests pass with 100% coverage:

```bash
npm test -- src/lib/closet/__tests__/mikeWhiteShoe.test.ts
```

## Feature Flags

This item respects the closet feature flags:

- `VITE_FEATURE_CLOSET_ENABLED` - Must be "true"
- `VITE_FEATURE_CLOSET_DROPS_ENABLED` - For Drop Day availability

Default: OFF (requires 100 finished games to enable)

## Avatar Rendering

The shoe will render on Avatar2D in the `shoes` slot (z-index 3 in SLOT_ORDER).
Layer order: accessory < deck < bottom < **shoes** < top < head

## Credits

- **Designer**: Mike White
- **Licensed**: Mike White signature license
- **Source Art**: Branch `assets/mike-white-shoe`
- **Added**: PR #718 (closet system)
