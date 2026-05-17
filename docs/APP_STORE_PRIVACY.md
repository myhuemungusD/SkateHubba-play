# App Store Privacy Questionnaire — Delta Per Release

This file tracks the App Store Connect / Google Play Data Safety
questionnaire updates required when a release changes what data
SkateHubba collects, processes, or stores. Update on every PR that
touches a permission, a third-party SDK, or a user-facing data flow.

---

## PR-B — Avatar Upload (audit I1)

Adds the ability for a signed-in user to upload a custom profile
picture from their device camera or photo library. Image is screened
on-device by NSFWjs before upload; storage is in Firebase Storage at
`users/{uid}/avatar.webp` and served via `firebasestorage.googleapis.com`.

### App Store Connect — Privacy Questionnaire

Update **App Privacy → Data Types** to declare the following:

- [ ] **Photos / Videos**
  - Linked to user: **Yes** (avatar is associated with the user account).
  - Used for tracking: **No**.
  - Purposes: **App Functionality** (the avatar renders on the user's
    profile and on their public clip feed).
  - Collection method: User-initiated upload via in-app picker.
- [ ] **Camera**
  - Permission rationale: see `NSCameraUsageDescription` in Info.plist —
    "SkateHubba needs camera access to record your tricks, capture skate
    spots, and take a profile picture."
- [ ] **Photo Library (read)**
  - Permission rationale: see `NSPhotoLibraryUsageDescription` —
    "SkateHubba saves your recorded clips to your library and lets you
    choose a profile picture from your photos."

### Google Play — Data Safety

Update **Data Safety → Data Collection** with:

- [ ] **Photos and videos** (collected, linked to account, optional).
  - Purpose: **Account management** (profile picture).
  - Encrypted in transit: **Yes** (HTTPS via Firebase Storage CDN).
  - User can request data deletion: **Yes** (via Settings → Data
    Deletion → Delete Account; cascade includes the avatar binary).
- [ ] **Permissions Declaration:**
  - `android.permission.CAMERA` — already declared for trick recording;
    no changes required for PR-B.
  - `android.permission.READ_MEDIA_IMAGES` — already declared.

### Native binaries to rebuild

PR-B does NOT require an iOS or Android binary change beyond the
plist copy update. The `@capacitor/camera` plugin only registers
JavaScript bindings; native runtime support for camera + photo
library is already present from the trick-recording feature.

After merging:

- [ ] Update App Store Connect privacy answers above.
- [ ] Update Google Play Data Safety form above.
- [ ] Run `npx cap sync` if a native rebuild is queued for any reason.

---
