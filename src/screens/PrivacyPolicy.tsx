import { ContentDataList } from "../components/legal/ContentDataList";
import { DeviceDataList } from "../components/legal/DeviceDataList";
import { PolicySection } from "../components/legal/PolicySection";
import { ProcessorsSection } from "../components/legal/ProcessorsSection";
import { RetentionSection } from "../components/legal/RetentionSection";
import { TrickTrainingSection } from "../components/legal/TrickTrainingSection";
import { Btn } from "../components/ui/Btn";
import type { Screen } from "../context/NavigationContext";

const EFFECTIVE_DATE = "October 22, 2026";
const CONTACT_EMAIL = "privacy@skatehubba.com";

export function PrivacyPolicy({ onBack, onNav }: { onBack: () => void; onNav?: (s: Screen) => void }) {
  return (
    <div className="min-h-dvh bg-background/90 text-white">
      <div className="px-5 pt-safe pb-4 border-b border-[#222] flex items-center gap-4">
        {/* Btn is w-full. In this row that width is the whole header, which
            pushes the logo past the viewport. w-fit sizes the control to its label. */}
        <div className="w-fit shrink-0">
          <Btn onClick={onBack} variant="ghost">
            ← Back
          </Btn>
        </div>
        <img src="/logonew.webp" alt="" draggable={false} className="h-6 w-auto select-none" aria-hidden="true" />
      </div>

      <article className="max-w-2xl mx-auto px-5 py-8 prose-invert">
        <h1 className="font-display text-4xl text-white mb-1">Privacy Policy</h1>
        <p className="font-body text-sm text-faint mb-8">Effective date: {EFFECTIVE_DATE}</p>

        <PolicySection title="1. Who We Are">
          <p>
            SkateHubba ("we", "our", "us") operates the SkateHubba S.K.A.T.E. game on the web at{" "}
            <span className="text-brand-orange">skatehubba.com</span> and in our iPhone and Android apps. This Privacy
            Policy covers all three and explains what personal data we collect, how we use it, and your rights.
          </p>
        </PolicySection>

        <PolicySection title="2. Data We Collect">
          <ContentDataList />
          <DeviceDataList />
        </PolicySection>

        <PolicySection title="3. How We Use Your Data">
          <ul>
            <li>To create and manage your account.</li>
            <li>To enable multiplayer S.K.A.T.E. games between users, including refereeing and dispute votes.</li>
            <li>To run the community feed, profiles, spots and chat, and to check uploaded clips.</li>
            <li>
              To send game notifications you turned on, and transactional emails (e.g. email verification, password
              reset) via Firebase.
            </li>
            <li>To stop faked check-ins, automated abuse and ban evasion.</li>
            <li>To detect and fix bugs using pseudonymised error reports.</li>
            <li>If you accept analytics, to understand product usage and improve the app.</li>
            <li>
              If you opt in, to teach a future trick recognizer from clips you filmed and the trick you named. We do not
              do this unless you turn the setting on.
            </li>
            <li>
              To review user reports of inappropriate content or behaviour (see &quot;Reports, appeals and blocks&quot;
              above). Reports are reviewed by our moderation team and kept confidential.
            </li>
          </ul>
          <p>We do not sell your data to third parties. We do not use your data for advertising.</p>
        </PolicySection>

        <PolicySection title="4. Legal Basis (GDPR)">
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
              <strong className="text-white">Legitimate interests:</strong> Security monitoring, preventing abuse and
              faked check-ins, moderation, and bug tracking.
            </li>
            <li>
              <strong className="text-white">Consent:</strong> Analytics, trick-recognition training, device location,
              and notifications. You may withdraw consent at any time.
            </li>
          </ul>
        </PolicySection>

        <ProcessorsSection />

        <RetentionSection />

        <PolicySection title="7. Your Rights">
          <p>Depending on your location, you may have the right to:</p>
          <ul>
            <li>
              Access the personal data we hold about you. In Settings, under Account, &quot;Download my data&quot; gives
              you a copy as a file.
            </li>
            <li>Correct inaccurate data.</li>
            <li>Delete your account and associated data (in the app: Settings, then Account, then Delete account).</li>
            <li>Object to or restrict certain processing.</li>
            <li>Data portability (receive your data in a machine-readable format).</li>
            <li>Lodge a complaint with your local data protection authority.</li>
          </ul>
          <p>
            To exercise any right, email us at <span className="text-brand-orange">{CONTACT_EMAIL}</span>. We will
            respond within 30 days.
          </p>
        </PolicySection>

        <PolicySection title="8. Cookies &amp; Tracking">
          <p>
            We do not use advertising cookies, cross-site tracking, or behavioural ad networks. Analytics run only after
            you accept the consent banner. Vercel Analytics and Speed Insights collect aggregated usage and
            loading-speed metrics without cookies. PostHog stores its identifier in your browser&apos;s local storage
            rather than in third-party cookies, has autocapture and session recording disabled, and receives only a
            pseudonymous ID. Firebase stores sign-in tokens in browser storage (IndexedDB / localStorage) to keep you
            signed in, and the app keeps the settings listed under &quot;Stored on your device&quot; in Section 2.
          </p>
        </PolicySection>

        <PolicySection title="9. Children's Privacy (COPPA Compliance)">
          <p>
            SkateHubba takes the privacy of children seriously and complies with the Children&apos;s Online Privacy
            Protection Act (COPPA).
          </p>
          <ul>
            <li>
              <strong className="text-white">Age verification:</strong> All users must complete an age verification gate
              before creating an account. If someone enters a birth date under 13, we stop sign-up and delete any
              sign-in account already created (for example with Google or Apple), along with anything saved for it.
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
        </PolicySection>

        <TrickTrainingSection />

        <PolicySection title="11. California Privacy Rights (CCPA/CPRA)">
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
              information. You can do this directly in the app (Settings, then Account, then Delete account) or by
              emailing <span className="text-brand-orange">{CONTACT_EMAIL}</span>.
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
        </PolicySection>

        <PolicySection title="12. Do Not Sell My Personal Information">
          <p>
            SkateHubba does <strong className="text-white">not sell</strong> personal information as defined under the
            CCPA. We do not share personal information with third parties for monetary or other valuable consideration.
            We only share data with our service providers (listed in Section 5) as necessary to operate the app.
          </p>
        </PolicySection>

        <PolicySection title="13. Changes to This Policy">
          <p>
            We may update this Privacy Policy from time to time. We will notify users of material changes by updating
            the effective date at the top of this page. Continued use of the app after changes constitutes acceptance of
            the updated policy.
          </p>
        </PolicySection>

        <PolicySection title="14. Contact">
          <p>
            Questions about this Privacy Policy? Email us at <span className="text-brand-orange">{CONTACT_EMAIL}</span>.
          </p>
        </PolicySection>
      </article>

      <div className="px-5 pb-12 flex justify-center">
        <Btn onClick={onBack} variant="ghost">
          ← Back to App
        </Btn>
      </div>
    </div>
  );
}
