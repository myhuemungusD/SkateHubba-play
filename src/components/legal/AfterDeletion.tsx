/**
 * What account deletion keeps, shared by the Privacy Policy (section 6) and
 * the public Data Deletion page so the two can never disagree. The source of
 * truth is `api/account/_userDataRegistry.ts`: every "retain" and "anonymize"
 * entry there has a line here.
 */
export function AfterDeletionList() {
  return (
    <ul>
      <li>
        <strong className="text-white">Erased right away:</strong> Your profile, username, sign-in account, clips,
        comments, chat messages, votes, private and crew spots, notifications you sent or received, push tokens,
        location records, stats, achievements, Closet items and wallet, reports and appeals you filed, block list, and
        trick-training labels. Finished games you played are deleted with their videos.
      </li>
      <li>
        <strong className="text-white">Kept with your name removed:</strong> Games still in progress end as a forfeit to
        your opponent, with your uploads deleted. Games you refereed, dice matches, Closet trades, the ownership history
        of numbered Closet items, and public spots you added stay for the other people in them, with your account
        replaced by a placeholder.
      </li>
      <li>
        <strong className="text-white">Kept, linked to your account ID:</strong> Ban records, so a ban cannot be escaped
        by re-registering; reports other people filed about you; the admin action log and the Closet custody log; and,
        for verified pros, quiz answer keys and records of which skaters you blessed. A daily anti-farming XP counter
        holds only a date and a count.
      </li>
      <li>
        <strong className="text-white">Backups:</strong> Copies in our daily database backups expire within 7 days.
      </li>
      <li>
        <strong className="text-white">Analytics and error reports:</strong> Events already sent to PostHog and Sentry
        stay under a pseudonymous ID made from your account ID. After deletion that ID no longer leads to an account.
      </li>
    </ul>
  );
}
