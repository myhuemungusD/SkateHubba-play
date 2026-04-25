import { Btn } from "../../../components/ui/Btn";

interface Props {
  username: string;
  uid: string;
  onChallenge: (uid: string, username: string) => void;
}

export function ChallengeButton({ username, uid, onChallenge }: Props) {
  return (
    <Btn onClick={() => onChallenge(uid, username)} className="w-full mb-4">
      Challenge @{username}
    </Btn>
  );
}
