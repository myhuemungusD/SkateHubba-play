import { useState, useEffect } from "react";
import { ClockIcon } from "./icons";

export function Timer({ deadline }: { deadline: number }) {
  const [text, setText] = useState("");
  const [urgent, setUrgent] = useState(false);
  useEffect(() => {
    const update = () => {
      const diff = deadline - Date.now();
      if (diff <= 0) {
        setText("TIME'S UP");
        setUrgent(true);
        return true;
      }
      setUrgent(diff < 2 * 3_600_000);
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setText(`${h}h ${m}m ${s}s`);
      return false;
    };
    if (update()) return;
    const id = window.setInterval(() => {
      if (update()) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [deadline]);
  return (
    <div
      className={`flex items-center gap-2 px-3.5 py-2 rounded-xl border transition-all duration-300 ${
        urgent
          ? "bg-brand-red/[0.06] border-brand-red/30 shadow-[0_0_12px_rgba(255,61,0,0.08)]"
          : "bg-surface-alt border-border"
      }`}
      aria-live="polite"
    >
      <ClockIcon size={14} className={urgent ? "text-brand-red" : "text-subtle"} />
      <span
        className={`font-display text-sm tracking-wider tabular-nums ${urgent ? "text-brand-red" : "text-brand-orange"}`}
        aria-label={`Turn timer: ${text}`}
      >
        {text}
      </span>
    </div>
  );
}
