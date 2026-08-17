import { Btn } from "../../../components/ui/Btn";

/**
 * Replaces the Challenge button for a signed-out visitor on a shared
 * `/player/:uid` link.
 *
 * Without it the public profile is a dead end: the visitor sees a player's
 * record and has no way to act on it, which defeats the point of the link
 * being shareable in the first place. The copy names the player so the
 * intent survives the sign-up detour.
 */
interface Props {
  username: string;
  onSignUp: () => void;
}

export function SignUpToChallengeCta({ username, onSignUp }: Props) {
  return (
    <div className="mb-8" data-testid="signup-to-challenge-cta">
      <Btn onClick={onSignUp}>Sign up to challenge @{username}</Btn>
      <p className="font-body text-xs text-muted mt-3 text-center">
        Free account. Play S.K.A.T.E. by video against anyone, anywhere.
      </p>
    </div>
  );
}
