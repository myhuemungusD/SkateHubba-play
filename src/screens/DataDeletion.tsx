import { AfterDeletionList } from "../components/legal/AfterDeletion";
import { PolicySection as Section } from "../components/legal/PolicySection";
import { Btn } from "../components/ui/Btn";
import { LegalTopBar } from "../components/legal/LegalTopBar";

const CONTACT_EMAIL = "privacy@skatehubba.com";

export function DataDeletion({ onBack }: { onBack: () => void }) {
  return (
    <div className="min-h-dvh bg-background/90 text-white">
      <LegalTopBar onBack={onBack} />

      <article className="max-w-2xl mx-auto px-5 py-8">
        <h1 className="font-display text-4xl text-white mb-1">Data Deletion</h1>
        <p className="font-body text-sm text-faint mb-8">
          Your data, your choice. Here&apos;s how to delete your information.
        </p>

        <Section title="Download a Copy of Your Data">
          <p>
            Under the GDPR&apos;s right to data portability (Article 20) and CCPA, you can download a machine-readable
            copy of the main data tied to your account. When signed in, open Settings and, under{" "}
            <strong className="text-white">&quot;Your data &amp; sign out&quot;</strong>, tap{" "}
            <strong className="text-white">&quot;Download my data&quot;</strong>. We package your profile and username,
            your games, the clips you posted and your votes on clips, the spots you added, including ones no longer on
            the map, your notifications and nudges, the players you blocked, reports you filed, and moderation decisions
            and appeals about your account into a single JSON file that downloads to your device.
          </p>
          <p>
            The file does not yet include everything we hold. Your sign-in details, date of birth and parental consent,
            comments, spot check-ins and spot chat messages are left out, for example. To get a copy of those, email{" "}
            <span className="text-brand-orange">{CONTACT_EMAIL}</span>.
          </p>
        </Section>

        <Section title="Delete Your Account (In-App)">
          <p>
            The fastest way to delete your data is directly in the app, on the web or iPhone. When signed in, open
            Settings and, under <strong className="text-white">&quot;Your data &amp; sign out&quot;</strong>, tap{" "}
            <strong className="text-white">&quot;Delete account&quot;</strong>. Deletion runs on our servers as soon as
            you confirm. What happens to each kind of data is listed under &quot;What Happens After Deletion&quot;
            below.
          </p>
        </Section>

        <Section title="Request Deletion by Email">
          <p>
            If you cannot access your account or prefer to request deletion via email, contact us at{" "}
            <span className="text-brand-orange">{CONTACT_EMAIL}</span> with the subject line{" "}
            <strong className="text-white">&quot;Data Deletion Request&quot;</strong> and include:
          </p>
          <ul>
            <li>The email address associated with your account</li>
            <li>Your username (if you remember it)</li>
          </ul>
          <p>
            We will process your request within <strong className="text-white">30 days</strong> and confirm deletion via
            email.
          </p>
        </Section>

        <Section title="CCPA Rights (California Residents)">
          <p>Under the California Consumer Privacy Act (CCPA), California residents have the right to:</p>
          <ul>
            <li>
              <strong className="text-white">Know</strong> what personal information we collect and how it is used.
            </li>
            <li>
              <strong className="text-white">Delete</strong> personal information we have collected (subject to certain
              exceptions).
            </li>
            <li>
              <strong className="text-white">Opt-out</strong> of the sale of personal information. SkateHubba does{" "}
              <strong className="text-white">not sell</strong> personal information.
            </li>
            <li>
              <strong className="text-white">Non-discrimination</strong> for exercising your CCPA rights.
            </li>
          </ul>
          <p>
            To exercise any of these rights, email <span className="text-brand-orange">{CONTACT_EMAIL}</span> or use the
            in-app account deletion feature.
          </p>
        </Section>

        <Section title="Children's Data (COPPA)">
          <p>
            SkateHubba does not knowingly collect personal information from children under 13. All users must pass an
            age verification gate before creating an account. If someone enters a birth date under 13, we stop sign-up
            and delete any sign-in account already created (for example with Google or Apple).
          </p>
          <p>
            If you are a parent or guardian and believe your child under 13 has provided personal information to
            SkateHubba, please contact us immediately at <span className="text-brand-orange">{CONTACT_EMAIL}</span>. We
            will delete the information within <strong className="text-white">48 hours</strong> of verification.
          </p>
        </Section>

        <Section title="What Happens After Deletion">
          <p>
            Your account is permanently removed and cannot be recovered, and your username becomes available for others
            to claim.
          </p>
          <AfterDeletionList />
        </Section>

        <Section title="Contact">
          <p>
            Questions about data deletion? Email us at <span className="text-brand-orange">{CONTACT_EMAIL}</span>.
          </p>
        </Section>
      </article>

      <div className="px-5 pb-12 flex justify-center">
        <Btn onClick={onBack} variant="ghost">
          Back to app
        </Btn>
      </div>
    </div>
  );
}
