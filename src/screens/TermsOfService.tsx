import { PolicySection } from "../components/legal/PolicySection";
import { Btn } from "../components/ui/Btn";

const EFFECTIVE_DATE = "October 22, 2026";
const CONTACT_EMAIL = "legal@skatehubba.com";

export function TermsOfService({ onBack }: { onBack: () => void }) {
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

      <article className="max-w-2xl mx-auto px-5 py-8">
        <h1 className="font-display text-4xl text-white mb-1">Terms of Service</h1>
        <p className="font-body text-sm text-faint mb-8">Effective date: {EFFECTIVE_DATE}</p>

        <PolicySection title="1. Acceptance of Terms">
          <p>
            By creating an account or using SkateHubba S.K.A.T.E. ("the App"), you agree to be bound by these Terms of
            Service ("Terms"). If you do not agree, do not use the App. SkateHubba ("we", "us") may update these Terms
            at any time; continued use after changes constitutes acceptance.
          </p>
        </PolicySection>

        <PolicySection title="2. Eligibility &amp; Age Requirements">
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
        </PolicySection>

        <PolicySection title="3. Your Account">
          <ul>
            <li>You are responsible for maintaining the confidentiality of your account credentials.</li>
            <li>You must provide accurate information when creating your account.</li>
            <li>You are responsible for all activity that occurs under your account.</li>
            <li>You may not share your account with others or create accounts for automated or non-human use.</li>
          </ul>
        </PolicySection>

        <PolicySection title="4. Game Rules &amp; Fair Play">
          <p>
            SkateHubba S.K.A.T.E. is an async trick battle game. Players are expected to judge honestly whether they
            landed a trick. By submitting a result you certify it is accurate. A game may have a referee, and a disputed
            trick may be decided by the referee or by a community vote; that decision is final for the game. Abuse of
            the judging system (e.g. claiming landed tricks you missed, or voting in bad faith) may result in account
            suspension.
          </p>
        </PolicySection>

        <PolicySection title="5. User-Generated Content">
          <p>
            You retain ownership of the videos, photos, comments, messages and other material you post ("Content"). By
            posting Content, you grant SkateHubba a worldwide, royalty-free, non-exclusive licence to store, display,
            and deliver it within the App: to your opponents and referee, in the community feed, on your profile and
            spots, to players voting on a disputed trick, and in chat. Landed game clips are posted to the feed
            automatically. This licence ends when you delete the Content or your account, except where the Privacy
            Policy says a copy is kept. We will not use your Content for advertising.
          </p>
          <p>
            If you are 18 or older you may separately opt in, in Settings, to let us use clips you film and the trick
            you pick to train a future trick recognizer. That permission is off unless you turn it on. It is not part of
            the licence above. If you turn it off, we stop using your clips for training, including clips you already
            shared, and we mark those records excluded. Deleting your account deletes them. Players under 18 cannot opt
            in.
          </p>
          <p>You must not upload Content that:</p>
          <ul>
            <li>Is illegal, harmful, threatening, abusive, or defamatory.</li>
            <li>Infringes intellectual property rights of third parties.</li>
            <li>Contains nudity, graphic violence, or sexually explicit material.</li>
            <li>Shows or encourages reckless acts that put other people in danger.</li>
          </ul>
          <p>We reserve the right to remove Content and suspend accounts that violate these rules.</p>
          <p>
            <strong className="text-white">Zero tolerance for objectionable content and abusive behaviour.</strong>{" "}
            SkateHubba has a zero-tolerance policy toward objectionable content and abusive users. You can report
            content or another user, and you can block a user so they can no longer interact with you. We review reports
            and will remove violating Content and the users who post it, and may report unlawful activity to the
            appropriate authorities. We aim to act on reports of objectionable content within 24 hours.
          </p>
        </PolicySection>

        <PolicySection title="6. Hubba Bucks &amp; Closet Items">
          <p>
            Hubba Bucks and Closet items are in-app items for use inside SkateHubba only. They have no cash value,
            cannot be exchanged for money, and may not be sold or traded outside the App. We may change or remove them,
            and they end when your account is deleted.
          </p>
        </PolicySection>

        <PolicySection title="7. Prohibited Conduct">
          <p>You agree not to:</p>
          <ul>
            <li>Use the App for any unlawful purpose or in violation of these Terms.</li>
            <li>Attempt to gain unauthorised access to other accounts or our systems.</li>
            <li>Reverse-engineer, decompile, or attempt to extract the source code of the App.</li>
            <li>Use automated scripts, bots, or tools to interact with the App.</li>
            <li>Impersonate another person or entity.</li>
            <li>Harass, threaten, or intimidate other users.</li>
          </ul>
        </PolicySection>

        <PolicySection title="8. Account Termination">
          <p>
            You may delete your account at any time from the Account Settings screen in the App. We may suspend or
            terminate your account without notice if you violate these Terms. Upon termination, your right to use the
            App ceases and we will delete your data in accordance with our Privacy Policy.
          </p>
        </PolicySection>

        <PolicySection title="9. Disclaimer of Warranties">
          <p>
            THE APP IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED.
            SKATEHUBBA DOES NOT WARRANT THAT THE APP WILL BE UNINTERRUPTED, ERROR-FREE, OR FREE OF VIRUSES OR OTHER
            HARMFUL COMPONENTS. YOUR USE OF THE APP IS AT YOUR SOLE RISK.
          </p>
        </PolicySection>

        <PolicySection title="10. Limitation of Liability">
          <p>
            TO THE MAXIMUM EXTENT PERMITTED BY LAW, SKATEHUBBA SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL,
            SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES ARISING FROM YOUR USE OF OR INABILITY TO USE THE APP, EVEN IF WE
            HAVE BEEN ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.
          </p>
          <p>
            OUR TOTAL LIABILITY TO YOU FOR ANY CLAIM SHALL NOT EXCEED THE GREATER OF (A) THE AMOUNT YOU PAID TO
            SKATEHUBBA IN THE TWELVE MONTHS PRECEDING THE CLAIM OR (B) USD $10.
          </p>
        </PolicySection>

        <PolicySection title="11. Governing Law">
          <p>
            These Terms are governed by the laws of the jurisdiction in which SkateHubba is incorporated, without regard
            to conflict-of-law principles. Any disputes shall be resolved in the courts of that jurisdiction.
          </p>
        </PolicySection>

        <PolicySection title="12. Changes to These Terms">
          <p>
            We may modify these Terms at any time. Material changes will be indicated by updating the effective date at
            the top of this page. Continued use of the App after changes constitutes your acceptance of the new Terms.
          </p>
        </PolicySection>

        <PolicySection title="13. Contact">
          <p>
            Questions about these Terms? Email us at <span className="text-brand-orange">{CONTACT_EMAIL}</span>.
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
