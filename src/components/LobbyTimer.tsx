import { useState, useEffect } from "react";
import { ClockIcon } from "./icons";

/**
 * Compact countdown timer shown on active game cards in the lobby.
 * Displays remaining time and turns red when under 2 hours.
 */
export function LobbyTimer({ deadline, isMyTurn }: { deadline: number; isMyTurn: boolean }) {
  const [label, setLabel] = useState("");
  const [urgent, setUrgent] = useState(false);

  useEffect(() => {
    if (deadline <= 0) return;

    const update = () => {
      const diff = deadline - Date.now();
      if (diff <= 0) {
        setLabel("Expired");
        setUrgent(true);
        return true;
      }
      const h = Math.floor(diff / 3_600_000);
      const m = Math.floor((diff % 3_600_000) / 60_000);
      setUrgent(diff < 2 * 3_600_000); // under 2 hours
      if (h > 0) {
        setLabel(`${h}h ${m}m`);
      } else {
        const s = Math.floor((diff % 60_000) / 1_000);
        setLabel(`${m}m ${s}s`);
      }
      return false;
    };

    if (update()) return;
    const id = window.setInterval(() => {
      if (update()) clearInterval(id);
    }, 1_000);
    return () => clearInterval(id);
  }, [deadline]);

  if (!label || deadline <= 0) return null;

  return (
    <span
      className={`font-display text-[10px] tracking-wider leading-none ${
        urgent ? "text-brand-red animate-pulse" : isMyTurn ? "text-[#888]" : "text-[#555]"
      }`}
      aria-label={`Time remaining: ${label}`}
    >
      <ClockIcon size={10} className="inline -mt-px mr-0.5" />
      {label}
    </span>
  );
}
