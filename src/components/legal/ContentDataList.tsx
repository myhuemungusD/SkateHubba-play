/** Privacy Policy section 2, part one: what you give us and what you post. */
export function ContentDataList() {
  return (
    <ul>
      <li>
        <strong className="text-white">Account data:</strong> Email address and the username you choose during sign-up.
      </li>
      <li>
        <strong className="text-white">Authentication data:</strong> If you sign in with Google or Apple, we receive
        your email address (with Apple, this can be a private relay address), an account identifier, and the name on
        that account (with Google, also the address of your profile photo). Firebase Authentication keeps that name and
        photo address on your sign-in record, and we use the name to suggest a username. Your SkateHubba profile shows
        only the username you choose. If you signed in with Apple in our iPhone app and delete your account there, we
        also revoke SkateHubba&apos;s access to your Apple ID; on the web you can remove it in your Apple ID settings.
      </li>
      <li>
        <strong className="text-white">Phone number (only if you turn on two-step sign-in):</strong> If you add SMS
        two-step verification, Firebase Authentication stores your phone number and sends sign-in codes to it. We use it
        for nothing else.
      </li>
      <li>
        <strong className="text-white">Date of birth:</strong> Collected once during the age-verification gate at
        sign-up. We use it to confirm you meet our minimum age requirement and to comply with COPPA. It is stored in a
        private, owner-only part of your profile and is never shown to other users.
      </li>
      <li>
        <strong className="text-white">Game data:</strong> Trick names, game results, scores, and turn history. If you
        referee a game, the players can see your username and your calls. Votes you cast on disputed tricks are stored
        with your account ID and count toward the public tally.
      </li>
      <li>
        <strong className="text-white">Video recordings:</strong> Videos you record in-app to set or match tricks,
        including their sound, are uploaded to Firebase Storage. When a trick is landed in a game, the set and the
        landing clips are posted to the community feed automatically, where any signed-in user can see them. Clips you
        upload from your camera roll are checked automatically with Google Cloud Video Intelligence: a clip that looks
        explicit is rejected, and a clip where no skateboarding is detected goes to a person for review. You get a
        notice with the reason and can appeal it in Settings.
      </li>
      <li>
        <strong className="text-white">Profile content:</strong> Your username, profile photo and banner image, bio,
        links, pinned clips, and game record are public: anyone with a link to your profile can see them, even without
        signing in. Other signed-in users can also see your XP, achievements, and Closet items.
      </li>
      <li>
        <strong className="text-white">Messages and comments:</strong> Messages you post in a spot&apos;s chat and
        comments you leave on clips and spots, stored with your username and the time. Other signed-in users can read
        them.
      </li>
      <li>
        <strong className="text-white">Spots:</strong> Spots you add to the map are public, with their name, photos and
        location, and are linked to your account. Private and crew spots can be seen only by you and the crew members
        you add.
      </li>
      <li>
        <strong className="text-white">Reports, appeals and blocks:</strong> When you report a user, a clip, a game or a
        spot-chat message, we store your account ID, the reported account and username, the reason, any description you
        add (up to 500 characters), and the related game, clip or dispute. We also keep the statements we send you about
        moderation decisions on your content, the appeals you file, and the list of users you block.
      </li>
      <li>
        <strong className="text-white">Closet and dice:</strong> Your Hubba Bucks balance and transaction history, the
        items you own, trades with other skaters, designs you make in Closet Studio, and your dice match stats and Rep.
      </li>
      <li>
        <strong className="text-white">Trick-training labels (only if you opt in):</strong> The storage path of a clip,
        the trick you picked (including stance and obstacle), whether the clip was a set or a match, and whether it
        landed. We also store a snapshot of your consent. This is off unless you turn it on.
      </li>
    </ul>
  );
}
