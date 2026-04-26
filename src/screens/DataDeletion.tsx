import { Btn } from "../components/ui/Btn";

const CONTACT_EMAIL = "privacy@skatehubba.com";

export function DataDeletion({ onBack }: { onBack: () => void }) {
  return (
    <div className="min-h-dvh bg-background/90 text-white">
      <div className="px-5 pt-safe pb-4 border-b border-[#222] flex items-center gap-4">
        <Btn onClick={onBack} variant="ghost" className="shrink-0">
          ← Back
        </Btn>
        <img src="/logo.webp" alt="" draggable={false} className="h-6 w-auto select-none" aria-hidden="true" />
      </div>

      <article className="max-w-2xl mx-auto px-5 py-8">
        <h1 className="font-display text-4xl text-white mb-1">Data Deletion</h1>
        <p className="font-body text-sm text-faint mb-8">
          Your data, your choice. Here&apos;s how to delete your information.
        </p>

        <Section title="Download a Copy of Your Data">
          <p>
            Under the GDPR&apos;s right to data portability (Article 20) and CCPA, you can download a machine-readable
            copy of everything we store about you. When signed in, scroll to the bottom of the lobby and tap{" "}
            <strong className="text-white">&quot;Download My Data&quot;</strong>. We package your profile, game history,
            landed clips, reports you filed, and the list of users you blocked into a single JSON file that downloads to
            your device.
          </p>
        </Section>

        <Section title="Delete Your Account (In-App)">
          <p>
            The fastest way to delete all your data is directly in the app. When signed in, scroll to the bottom of the
            lobby and tap <strong className="text-white">&quot;Delete Account&quot;</strong>. This permanently removes:
          </p>
          <ul>
            <li>Your user profile and username</li>
            <li>Your sign-in credentials</li>
            <li>All game records where you are a participant</li>
            <li>Your leaderboard stats</li>
          </ul>
          <p>
            Video recordings linked to your games are automatically deleted within 90 days of the game ending. Upon
            account deletion, remaining videos are queued for removal.
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
            age verification gate before creating an account.
          </p>
          <p>
            If you are a parent or guardian and believe your child under 13 has provided personal information to
            SkateHubba, please contact us immediately at <span className="text-brand-orange">{CONTACT_EMAIL}</span>. We
            will delete the information within <strong className="text-white">48 hours</strong> of verification.
          </p>
        </Section>

        <Section title="What Happens After Deletion">
          <ul>
            <li>Your account is permanently removed and cannot be recovered.</li>
            <li>Your username becomes available for others to claim.</li>
            <li>Game data is removed from our database within 30 days.</li>
            <li>Video recordings are deleted within 90 days.</li>
            <li>Anonymised analytics data (which cannot identify you) may be retained for product improvement.</li>
          </ul>
        </Section>

        <Section title="Contact">
          <p>
            Questions about data deletion? Email us at <span className="text-brand-orange">{CONTACT_EMAIL}</span>.
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
