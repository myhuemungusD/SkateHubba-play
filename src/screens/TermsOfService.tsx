import { Btn } from "../components/ui/Btn";

const EFFECTIVE_DATE = "March 20, 2026";
const CONTACT_EMAIL = "legal@skatehubba.com";

export function TermsOfService({ onBack }: { onBack: () => void }) {
  return (
    <div className="min-h-dvh bg-background/90 text-white">
      <div className="px-5 pt-safe pb-4 border-b border-[#222] flex items-center gap-4">
        <Btn onClick={onBack} variant="ghost" className="shrink-0">
          ← Back
        </Btn>
        <img src="/logonew.webp" alt="" draggable={false} className="h-6 w-auto select-none" aria-hidden="true" />
      </div>

      <article className="max-w-2xl mx-auto px-5 py-8">
        <h1 className="font-display text-4xl text-white mb-1">Terms of Service</h1>
        <p className="font-body text-sm text-faint mb-8">Effective date: {EFFECTIVE_DATE}</p>

        <Section title="1. Acceptance of Terms">
          <p>
            By creating an account or using SkateHubba S.K.A.T.E. ("the App"), you agree to be bound by these Terms of
            Service ("Terms"). If you do not agree, do not use the App. SkateHubba ("we", "us") may update these Terms
            at any time; continued use after changes constitutes acceptance.
          </p>
        </Section>

        <Section title="2. Eligibility &amp; Age Requirements">
          <p>
            You must be at least 13 years old to use the App. All users are required to complete an age verification
            gate before creating an account.{" "}
            <strong className="text-white">Users under 13 are prohibited from using SkateHubba</strong>, in compliance
            with the Children&apos;s Online Privacy Protection Act (COPPA).
          </p>
          <p>
            If you are between 13 and 17, you must have verifiable permission from a parent or legal guardian before
            using the App. During account creation you will be asked to confirm that a parent or guardian has reviewed
            our Privacy Policy and these Terms and consents to your use of SkateHubba. Parents or guardians may revoke
            consent at any time by contacting <span className="text-brand-orange">{CONTACT_EMAIL}</span>.
          </p>
        </Section>

        <Section title="3. Your Account">
          <ul>
            <li>You are responsible for maintaining the confidentiality of your account credentials.</li>
            <li>You must provide accurate information when creating your account.</li>
            <li>You are responsible for all activity that occurs under your account.</li>
            <li>You may not share your account with others or create accounts for automated or non-human use.</li>
          </ul>
        </Section>

        <Section title="4. Game Rules &amp; Fair Play">
          <p>
            SkateHubba S.K.A.T.E. is an async trick battle game. Players are expected to self-judge honestly whether
            they landed a trick. By submitting a result you certify it is accurate. Abuse of the self-judging system
            (e.g. claiming landed tricks you missed) may result in account suspension.
          </p>
        </Section>

        <Section title="5. User-Generated Content">
          <p>
            You retain ownership of the video recordings you upload ("Content"). By uploading Content, you grant
            SkateHubba a worldwide, royalty-free, non-exclusive licence to store, display, and deliver your Content to
            your game opponents within the App. We will not use your Content for advertising or share it publicly
            outside of your game.
          </p>
          <p>You must not upload Content that:</p>
          <ul>
            <li>Is illegal, harmful, threatening, abusive, or defamatory.</li>
            <li>Infringes intellectual property rights of third parties.</li>
            <li>Contains nudity, graphic violence, or sexually explicit material.</li>
            <li>Depicts dangerous activities that could endanger yourself or others.</li>
          </ul>
          <p>We reserve the right to remove Content and suspend accounts that violate these rules.</p>
        </Section>

        <Section title="6. Prohibited Conduct">
          <p>You agree not to:</p>
          <ul>
            <li>Use the App for any unlawful purpose or in violation of these Terms.</li>
            <li>Attempt to gain unauthorised access to other accounts or our systems.</li>
            <li>Reverse-engineer, decompile, or attempt to extract the source code of the App.</li>
            <li>Use automated scripts, bots, or tools to interact with the App.</li>
            <li>Impersonate another person or entity.</li>
            <li>Harass, threaten, or intimidate other users.</li>
          </ul>
        </Section>

        <Section title="7. Account Termination">
          <p>
            You may delete your account at any time from the Account Settings screen in the App. We may suspend or
            terminate your account without notice if you violate these Terms. Upon termination, your right to use the
            App ceases and we will delete your data in accordance with our Privacy Policy.
          </p>
        </Section>

        <Section title="8. Disclaimer of Warranties">
          <p>
            THE APP IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED.
            SKATEHUBBA DOES NOT WARRANT THAT THE APP WILL BE UNINTERRUPTED, ERROR-FREE, OR FREE OF VIRUSES OR OTHER
            HARMFUL COMPONENTS. YOUR USE OF THE APP IS AT YOUR SOLE RISK.
          </p>
        </Section>

        <Section title="9. Limitation of Liability">
          <p>
            TO THE MAXIMUM EXTENT PERMITTED BY LAW, SKATEHUBBA SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL,
            SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES ARISING FROM YOUR USE OF OR INABILITY TO USE THE APP, EVEN IF WE
            HAVE BEEN ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.
          </p>
          <p>
            OUR TOTAL LIABILITY TO YOU FOR ANY CLAIM SHALL NOT EXCEED THE GREATER OF (A) THE AMOUNT YOU PAID TO
            SKATEHUBBA IN THE TWELVE MONTHS PRECEDING THE CLAIM OR (B) USD $10.
          </p>
        </Section>

        <Section title="10. Governing Law">
          <p>
            These Terms are governed by the laws of the jurisdiction in which SkateHubba is incorporated, without regard
            to conflict-of-law principles. Any disputes shall be resolved in the courts of that jurisdiction.
          </p>
        </Section>

        <Section title="11. Changes to These Terms">
          <p>
            We may modify these Terms at any time. Material changes will be indicated by updating the effective date at
            the top of this page. Continued use of the App after changes constitutes your acceptance of the new Terms.
          </p>
        </Section>

        <Section title="12. Contact">
          <p>
            Questions about these Terms? Email us at <span className="text-brand-orange">{CONTACT_EMAIL}</span>.
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
