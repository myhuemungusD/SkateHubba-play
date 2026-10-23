import { PolicySection } from "./PolicySection";

/** Privacy Policy section 5: every outside service that receives personal data. */
export function ProcessorsSection() {
  return (
    <PolicySection title="5. Third-Party Services">
      <p>We use the following service providers, each with their own privacy policies:</p>
      <ul>
        <li>
          <strong className="text-white">Google Firebase</strong> (Authentication, Firestore database, Storage, Cloud
          Functions, Cloud Messaging for notifications, and App Check) — Google LLC, USA.
        </li>
        <li>
          <strong className="text-white">Google reCAPTCHA v3</strong> (App Check on the web) and{" "}
          <strong className="text-white">Google Play Integrity</strong> (App Check on Android) — Google LLC, USA.
        </li>
        <li>
          <strong className="text-white">Google Cloud Video Intelligence</strong> (automatic explicit-content and
          is-this-skateboarding checks on uploaded clips) — Google LLC, USA.
        </li>
        <li>
          <strong className="text-white">Apple</strong> (Sign in with Apple if you use it; on iPhone, Apple Push
          Notification service and App Attest or DeviceCheck) — Apple Inc., USA.
        </li>
        <li>
          <strong className="text-white">Vercel</strong> (hosting and edge network; with your consent, Vercel Analytics
          and Speed Insights) — Vercel Inc., USA.
        </li>
        <li>
          <strong className="text-white">PostHog</strong> (product analytics — funnels, retention, and feature usage) —
          PostHog Inc., USA. Only active after you accept the consent banner. We do not enable session recording or
          autocapture, and events carry only a pseudonymous ID.
        </li>
        <li>
          <strong className="text-white">Sentry</strong> (error tracking) — Functional Software Inc., USA.
        </li>
        <li>
          <strong className="text-white">Mapbox</strong> (map display) — Mapbox Inc., USA. When you open the map, your
          device requests map tiles from Mapbox, which receives your IP address and the area being shown. Mapbox&apos;s
          map library also sends usage events about the map to Mapbox.
        </li>
      </ul>
    </PolicySection>
  );
}
