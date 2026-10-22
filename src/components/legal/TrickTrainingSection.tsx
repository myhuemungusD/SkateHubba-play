import { PolicySection } from "./PolicySection";

/** Privacy Policy section 10: the opt-in trick-recognition training data. */
export function TrickTrainingSection() {
  return (
    <PolicySection title="10. Trick recognition training">
      <p>
        SkateHubba may one day recognize tricks from video. That work is not running yet. If it does, it will only learn
        from clips of people who asked us to use them.
      </p>
      <ul>
        <li>
          <strong className="text-white">Opt-in, default off.</strong> The Settings switch &quot;Help train
          SkateHubba&apos;s trick AI&quot; starts off. Nothing you film is used for training unless you turn it on.
          After your first finished game we may ask once. You can ignore that question.
        </li>
        <li>
          <strong className="text-white">What we keep.</strong> If you opt in, we store a training label for each set
          and match clip: where the video lives, the trick, stance, and obstacle you picked, whether you were setting or
          matching, how the turn ended, and whether you had opted in at the time.
        </li>
        <li>
          <strong className="text-white">Turning it off.</strong> You can switch it off at any time. We then stop using
          your clips for training, including clips you already shared. Those labels are marked excluded.
        </li>
        <li>
          <strong className="text-white">Deletion.</strong> Deleting your account deletes your training labels along
          with the rest of your data.
        </li>
        <li>
          <strong className="text-white">Age.</strong> Players under 18 cannot opt in. Players under 13 cannot use
          SkateHubba at all.
        </li>
      </ul>
    </PolicySection>
  );
}
