# Two-step verification (TOTP) — console step

The Settings screen can enroll an authenticator app (TOTP) and remove it.
Firebase Auth only allows that after TOTP is turned on for the project.
That switch lives in the Firebase / Google Cloud console. It is not a
code change, a Cloud Function, or a Vercel setting. Do not deploy
functions to turn it on.

Until it is on, the app shows **Two-step verification isn't available yet.**
The client detects `auth/operation-not-allowed` (TOTP provider disabled)
and `auth/operation-not-supported-in-this-environment` (Identity Platform
not enabled on the project).

## What Jason does by hand

1. Open the [Firebase console](https://console.firebase.google.com/) and
   select the SkateHubba project.
2. Go to **Authentication → Sign-in method**.
3. If the page asks you to upgrade to **Identity Platform**, do that.
   TOTP is an Identity Platform feature. The upgrade is a Google Cloud
   billing / project setting. Confirm the cost in the console before
   accepting it. This repo cannot do that step.
4. In **Authentication → Sign-in method**, open **Advanced** (or
   **Multi-factor authentication**) and enable **TOTP** as a second
   factor. SMS is not required for the in-app setup screen.
5. Leave the authorized domains as they are unless Auth itself reports
   a domain error. Do not change Vercel environment variables for this.

Official reference: [Enable TOTP multi-factor authentication](https://firebase.google.com/docs/auth/web/totp-mfa).

After TOTP is enabled, a signed-in player opens **Settings → Security**,
scans the QR code (or types the manual key) in an authenticator app, and
enters the 6-digit code. Enrollment and removal both ask for a recent
sign-in (password, Google, or Apple) when Firebase returns
`auth/requires-recent-login`.
