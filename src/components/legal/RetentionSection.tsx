import { AfterDeletionList } from "./AfterDeletion";
import { PolicySection } from "./PolicySection";

/** Privacy Policy section 6: how long data lives, and what deletion keeps. */
export function RetentionSection() {
  return (
    <PolicySection title="6. Data Retention">
      <ul>
        <li>
          <strong className="text-white">While your account is active:</strong> We keep your data until you delete it or
          your account.
        </li>
        <li>
          <strong className="text-white">Game videos:</strong> Game videos may be deleted automatically 90 days after
          upload. We keep any video that a feed clip, a dispute or a report still uses.
        </li>
        <li>
          <strong className="text-white">Error logs:</strong> Kept in Sentry for up to 90 days.
        </li>
      </ul>
      <p>
        When you delete your account, our servers erase your data as soon as you confirm. Here is what that covers and
        what stays:
      </p>
      <AfterDeletionList />
    </PolicySection>
  );
}
