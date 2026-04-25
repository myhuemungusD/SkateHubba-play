import { Btn } from "../../../components/ui/Btn";
import { SkateboardIcon } from "../../../components/icons";

interface Props {
  message: string;
  onBack: () => void;
}

export function PlayerProfileError({ message, onBack }: Props) {
  return (
    <div className="min-h-dvh flex flex-col items-center justify-center px-6 bg-background/80">
      <SkateboardIcon size={32} className="mb-4 text-faint" />
      <p className="font-body text-sm text-faint mb-4">{message}</p>
      <Btn onClick={onBack} variant="ghost">
        Back to Lobby
      </Btn>
    </div>
  );
}
