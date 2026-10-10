# Verification emails — what the app can see, and what Jason checks by hand

Project: `sk8hub-d7806`. Production host: `skatehubba.com`.

This is a console checklist. Nothing in this document changes Firebase, Vercel, or App Check settings.

## What happened on 10 October 2026

Three audit accounts were created about two hours before this was written:

- `jayham710+skatehubba.qa1.2e1130@gmail.com`
- `jayham710+skatehubba.qa2.2e1130@gmail.com`
- `jayham710+skatehubba.qa3.2e1130@gmail.com`

The app told each one a verification email had been sent. Nothing arrived in that Gmail inbox, including spam.

Play is gated on a verified email. `firestore.rules` requires `request.auth.token.email_verified == true` to create a game, and the challenge button sends unverified players back to the lobby. A new player who never receives the mail cannot play.

## What the code actually does

`signUp` in `src/services/auth.ts` awaits `sendEmailVerification`. The account is created either way.

- If that call **throws**, signup still succeeds and the result is `verificationEmailSent: false` plus the Firebase code (`verificationErrorCode`). The signup screen toasts that code. The verify banner reads the same failure from session storage, so it does not say a mail is waiting. Sentry gets the exception, the code, and the continue-URL host. This path did **not** run for the three audit accounts: they were told the mail was sent, and that sentence is only used when the call resolves.
- If that call **resolves**, Identity Toolkit accepted the request. That is not a delivery receipt. Gmail can still drop it. The banner now says "Firebase accepted the verification email" and "Acceptance is not delivery".
- A rejected continue URL (`auth/unauthorized-continue-uri` or `auth/invalid-continue-uri`) is retried once without `actionCodeSettings`. Any other error, including quota and App Check, is surfaced and reported. It is not swallowed.
- Resend lives on the verify banner: 60 seconds after a normal attempt, 5 minutes after `auth/too-many-requests` or `auth/quota-exceeded`. A resend with nobody signed in throws `auth/no-current-user` instead of resolving. Failures go to Sentry from `resendVerification`.

`getActionCodeSettings()` sets `url` to `VITE_APP_URL` or, if that is unset, `window.location.origin`, and `handleCodeInApp: false`. The host of that URL has to be an authorized domain or the first send is rejected and the fallback sends Firebase's own handler link.

There is **no custom SMTP, sender address, or email template in this repository**. Password reset uses the same continue URL. Delivery is entirely the Firebase Authentication email pipeline configured in the console.

App Check did not block these three signups. A 403 from `exchangeRecaptchaV3Token` is the headless/datacenter case documented in [APPCHECK_ROLLOUT.md](APPCHECK_ROLLOUT.md); Auth still created the accounts. If Identity Toolkit App Check were **Enforced**, `sendEmailVerification` would throw and the app would have shown a failure, not "accepted". It showed acceptance, so the send was not rejected.

## What Jason checks in the Firebase console

Open [the Firebase console](https://console.firebase.google.com) for project **sk8hub-d7806**. Do not flip enforcement while checking.

1. **Authentication → Templates → Email address verification**
   - Sender name and From address. The default is a `noreply@<project>.firebaseapp.com` address. Gmail frequently files or drops that sender, including past the spam folder (it never appears).
   - Reply-to, if set.
   - Whether the template is still the Firebase default or a custom one, and that the action link is still in the body.
   - **SMTP settings** on that same Templates page (or Authentication → Templates → SMTP). If a custom SMTP host is connected, check its send log and bounce log for these three addresses. If no custom SMTP is connected, Firebase's built-in sender is what shipped the mail — and that is the likely reason Gmail has nothing.

2. **Authentication → Settings → Authorized domains**
   - Must include `skatehubba.com` and `www.skatehubba.com`.
   - The continue URL host is `VITE_APP_URL` when that env var is set in Vercel Production, otherwise the origin the page was served from. A host that is missing makes `sendEmailVerification` throw `auth/unauthorized-continue-uri`. The app retries without a continue URL, so a missing domain does not by itself explain a _successful_ send that never arrives. Still confirm both hosts are listed so the link in the mail returns to the app.

3. **App Check → APIs → Identity Toolkit** (also listed as the Authentication / Identity Toolkit API)
   - Note whether it is **Unenforced** or **Enforced**. Leave it Unenforced unless the metrics for real browsers are clean. See [APPCHECK_ROLLOUT.md](APPCHECK_ROLLOUT.md).
   - Enforcement here is separate from Firestore and Storage. Enforced + a failed reCAPTCHA token makes `sendEmailVerification` fail with an App Check code. The banner now shows that code. These three accounts did not hit it.

4. **Authentication → Usage** (and the email quota on the Templates page, if shown)
   - `auth/quota-exceeded` and `auth/too-many-requests` are the codes the app treats as a five-minute wait. Three new accounts will not exhaust the daily built-in email quota by themselves. If the project is already over quota, every new player is stuck and the banner will say so on the next attempt.

5. **Authentication → Users**
   - Open each of the three addresses and confirm `emailVerified` is still false. That matches "the send was accepted and the link was never opened".
   - Delete or keep the `qa_tester_*` users separately. This checklist does not delete them.

After any template or SMTP change, create one fresh account on https://skatehubba.com and confirm the message arrives. The Resend button on the verify banner is the retry; it waits 60 seconds between attempts.
