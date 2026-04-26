import { Btn } from "../components/ui/Btn";
import type { Screen } from "../context/NavigationContext";

const EFFECTIVE_DATE = "March 20, 2026";
const CONTACT_EMAIL = "privacy@skatehubba.com";

export function PrivacyPolicy({ onBack, onNav }: { onBack: () => void; onNav?: (s: Screen) => void }) {
  return (
    <div className="min-h-dvh bg-background/90 text-white">
      <div className="px-5 pt-safe pb-4 border-b border-[#222] flex items-center gap-4">
        <Btn onClick={onBack} variant="ghost" className="shrink-0">
          ← Back
        </Btn>
        <img src="/logo.webp" alt="" draggable={false} className="h-6 w-auto select-none" aria-hidden="true" />
      </div>

      <article className="max-w-2xl mx-auto px-5 py-8 prose-invert">
        <h1 className="font-display text-4xl text-white mb-1">Privacy Policy</h1>
        <p className="font-body text-sm text-faint mb-8">Effective date: {EFFECTIVE_DATE}</p>

        <Section title="1. Who We Are">
          <p>
            SkateHubba ("we", "our", "us") operates the SkateHubba S.K.A.T.E. web application at{" "}
            <span className="text-brand-orange">skatehubba.com</span>. This Privacy Policy explains what personal data
            we collect, how we use it, and your rights.
          </p>
        </Section>

        <Section title="2. Data We Collect">
          <ul>
            <li>
              <strong className="text-white">Account data:</strong> Email address, display name (optional), and username
              you choose during sign-up.
            </li>
            <li>
              <strong className="text-white">Authentication data:</strong> If you sign in with Google, we receive your
              Google profile (name, email, profile photo URL) from Google OAuth.
            </li>
            <li>
              <strong className="text-white">Game data:</strong> Trick names, game results, scores, and turn history
              associated with your account.
            </li>
            <li>
              <strong className="text-white">Video recordings:</strong> Videos you record in-app to set or match tricks.
              These are uploaded to Firebase Storage and linked to your game sessions.
            </li>
            <li>
              <strong className="text-white">Usage data:</strong> Anonymous event data (e.g. game created, sign-in
              method) collected via Vercel Analytics. This data does not identify you personally and does not use
              cookies.
            </li>
            <li>
              <strong className="text-white">Error data:</strong> Crash reports and stack traces collected via Sentry.
              Email addresses and other PII are stripped before transmission.
            </li>
          </ul>
        </Section>

        <Section title="3. How We Use Your Data">
          <ul>
            <li>To create and manage your account.</li>
            <li>To enable multiplayer S.K.A.T.E. games between users.</li>
            <li>To send transactional emails (e.g. email verification, password reset) via Firebase.</li>
            <li>To detect and fix bugs using anonymised error reports.</li>
            <li>To understand aggregate product usage and improve the app.</li>
            <li>
              To review user reports of inappropriate content or behaviour. When you flag an opponent, we store your
              user ID, the reported user&apos;s ID, the game ID, and the reason you provided. Reports are reviewed by
              our moderation team and kept confidential.
            </li>
          </ul>
          <p>We do not sell your data to third parties. We do not use your data for advertising.</p>
        </Section>

        <Section title="4. Legal Basis (GDPR)">
          <p>
            If you are located in the European Economic Area (EEA), we process your personal data under the following
            legal bases:
          </p>
          <ul>
            <li>
              <strong className="text-white">Contract:</strong> Processing necessary to provide the game service you
              signed up for.
            </li>
            <li>
              <strong className="text-white">Legitimate interests:</strong> Security monitoring, bug tracking, and
              aggregate analytics.
            </li>
            <li>
              <strong className="text-white">Consent:</strong> Where we ask for consent (e.g. optional analytics), you
              may withdraw it at any time.
            </li>
          </ul>
        </Section>

        <Section title="5. Third-Party Services">
          <p>We use the following sub-processors, each with their own privacy policies:</p>
          <ul>
            <li>
              <strong className="text-white">Google Firebase</strong> (Authentication, Firestore database, Storage) —
              Google LLC, USA.
            </li>
            <li>
              <strong className="text-white">Vercel</strong> (hosting, edge network, analytics) — Vercel Inc., USA.
            </li>
            <li>
              <strong className="text-white">Sentry</strong> (error tracking) — Functional Software Inc., USA.
            </li>
          </ul>
        </Section>

        <Section title="6. Data Retention">
          <ul>
            <li>
              <strong className="text-white">Account &amp; game data:</strong> Retained while your account is active.
              Deleted within 30 days of account deletion.
            </li>
            <li>
              <strong className="text-white">Video recordings:</strong> Retained for 90 days after a game ends, then
              automatically deleted.
            </li>
            <li>
              <strong className="text-white">Error logs:</strong> Retained for 90 days in Sentry.
            </li>
          </ul>
        </Section>

        <Section title="7. Your Rights">
          <p>Depending on your location, you may have the right to:</p>
          <ul>
            <li>Access the personal data we hold about you.</li>
            <li>Correct inaccurate data.</li>
            <li>Delete your account and associated data (available directly in the app under Account Settings).</li>
            <li>Object to or restrict certain processing.</li>
            <li>Data portability (receive your data in a machine-readable format).</li>
            <li>Lodge a complaint with your local data protection authority.</li>
          </ul>
          <p>
            To exercise any right, email us at <span className="text-brand-orange">{CONTACT_EMAIL}</span>. We will
            respond within 30 days.
          </p>
        </Section>

        <Section title="8. Cookies &amp; Tracking">
          <p>
            We do not use advertising cookies or third-party trackers. Vercel Analytics collects anonymised, aggregated
            usage metrics without using cookies or fingerprinting. Firebase may store authentication tokens in browser
            storage (IndexedDB / localStorage) to keep you signed in.
          </p>
        </Section>

        <Section title="9. Children's Privacy (COPPA Compliance)">
          <p>
            SkateHubba takes the privacy of children seriously and complies with the Children&apos;s Online Privacy
            Protection Act (COPPA).
          </p>
          <ul>
            <li>
              <strong className="text-white">Age verification:</strong> All users must complete an age verification gate
              before creating an account. Users under 13 are blocked from registering and no personal information is
              collected or retained from them.
            </li>
            <li>
              <strong className="text-white">Parental consent (ages 13–17):</strong> Users between 13 and 17 must
              confirm that a parent or legal guardian has reviewed this Privacy Policy and our Terms of Service and
              consents to their use of SkateHubba before creating an account.
            </li>
            <li>
              <strong className="text-white">Data collected from minors:</strong> We collect the same categories of data
              from users aged 13–17 as from adults (see Section 2). We do not collect more data than is reasonably
              necessary to provide the game service.
            </li>
            <li>
              <strong className="text-white">No behavioural advertising:</strong> We do not serve targeted or
              behavioural advertising to any users, including minors.
            </li>
            <li>
              <strong className="text-white">Parental rights:</strong> Parents or guardians of users under 18 may review
              their child&apos;s personal information, request its deletion, or revoke consent by emailing{" "}
              <span className="text-brand-orange">{CONTACT_EMAIL}</span>. We will respond within 48 hours.
            </li>
            <li>
              <strong className="text-white">Deletion:</strong> If we discover that we have collected personal
              information from a child under 13, we will delete it within 48 hours. Parents may also request deletion at
              any time.
            </li>
          </ul>
        </Section>

        <Section title="10. California Privacy Rights (CCPA/CPRA)">
          <p>
            If you are a California resident, the California Consumer Privacy Act (CCPA), as amended by the California
            Privacy Rights Act (CPRA), grants you additional rights:
          </p>
          <ul>
            <li>
              <strong className="text-white">Right to know:</strong> You may request details about the categories and
              specific pieces of personal information we have collected about you.
            </li>
            <li>
              <strong className="text-white">Right to delete:</strong> You may request deletion of your personal
              information. You can do this directly in the app (Account Settings → Delete Account) or by emailing{" "}
              <span className="text-brand-orange">{CONTACT_EMAIL}</span>.
            </li>
            <li>
              <strong className="text-white">Right to opt-out of sale:</strong> SkateHubba does{" "}
              <strong className="text-white">not sell</strong> your personal information to third parties and has never
              done so.
            </li>
            <li>
              <strong className="text-white">Right to non-discrimination:</strong> We will not discriminate against you
              for exercising any of your CCPA rights.
            </li>
            <li>
              <strong className="text-white">Right to correct:</strong> You may request correction of inaccurate
              personal information.
            </li>
          </ul>
          <p>
            To exercise any of these rights, email <span className="text-brand-orange">{CONTACT_EMAIL}</span>. We will
            verify your identity and respond within 45 days.
          </p>
          {onNav && (
            <p>
              For more details, see our{" "}
              <button type="button" onClick={() => onNav("datadeletion")} className="text-brand-orange hover:underline">
                Data Deletion page
              </button>
              .
            </p>
          )}
        </Section>

        <Section title="11. Do Not Sell My Personal Information">
          <p>
            SkateHubba does <strong className="text-white">not sell</strong> personal information as defined under the
            CCPA. We do not share personal information with third parties for monetary or other valuable consideration.
            We only share data with our service providers (listed in Section 5) as necessary to operate the app.
          </p>
        </Section>

        <Section title="12. Changes to This Policy">
          <p>
            We may update this Privacy Policy from time to time. We will notify users of material changes by updating
            the effective date at the top of this page. Continued use of the app after changes constitutes acceptance of
            the updated policy.
          </p>
        </Section>

        <Section title="13. Contact">
          <p>
            Questions about this Privacy Policy? Email us at <span className="text-brand-orange">{CONTACT_EMAIL}</span>.
          </p>
        </Section>
      </article>

      <div className="px-5 pb-12 flex justify-center">
        <Btn onClick={onBack} variant="ghost">
          ← Back to App
        </Btn>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="font-display text-xl text-white tracking-wider mb-3">{title}</h2>
      <div className="font-body text-sm text-dim leading-relaxed space-y-2">{children}</div>
    </section>
  );
}
