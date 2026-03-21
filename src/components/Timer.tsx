import { useState, useEffect } from "react";
import { ClockIcon } from "./icons";

export function Timer({ deadline }: { deadline: number }) {
  const [text, setText] = useState("");
  useEffect(() => {
    const update = () => {
      const diff = deadline - Date.now();
      if (diff <= 0) {
        setText("TIME'S UP");
        return true;
      }
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
      className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-alt border border-border"
      aria-live="polite"
    >
      <ClockIcon size={14} className="text-[#555]" />
      <span className="font-display text-sm text-brand-orange tracking-wider" aria-label={`Turn timer: ${text}`}>
        {text}
      </span>
    </div>
  );
}
