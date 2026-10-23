import { APP_CREDITS } from "../lib/appCredits";

/** Credits list for Settings. */
export function AppCredits() {
  return (
    <ul className="space-y-2" data-testid="app-credits">
      {APP_CREDITS.map((c) => (
        <li key={c.who} className="p-4 rounded-2xl glass-card">
          <p className="font-display text-sm text-white tracking-wide">{c.who}</p>
          <p className="font-body text-xs text-faint mt-1 break-words">{c.what}</p>
        </li>
      ))}
    </ul>
  );
}
