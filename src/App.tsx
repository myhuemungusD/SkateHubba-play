import { useState, useEffect, useRef, useCallback, useId, Component, type ReactNode } from "react";
import { Analytics } from "@vercel/analytics/react";
import * as Sentry from "@sentry/react";
import { useAuth } from "./hooks/useAuth";
import { signUp, signIn, signOut, resetPassword, resendVerification, signInWithGoogle, resolveGoogleRedirect, deleteAccount } from "./services/auth";
import {
  createProfile,
  isUsernameAvailable,
  getUidByUsername,
  deleteUserData,
  type UserProfile,
} from "./services/users";
import {
  createGame,
  setTrick,
  submitMatchResult,
  forfeitExpiredTurn,
  subscribeToMyGames,
  subscribeToGame,
  type GameDoc,
} from "./services/games";
import { uploadVideo } from "./services/storage";
import { firebaseReady } from "./firebase";

/* ═══════════════════════════════════════════
 *  ERROR BOUNDARY
 * ═══════════════════════════════════════════ */

class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string }) {
    console.error("ErrorBoundary caught:", error.message, info.componentStack);
    Sentry.captureException(error, { extra: info });
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-dvh flex flex-col items-center justify-center px-6 bg-[#0A0A0A]">
          <span className="font-display text-lg tracking-[0.35em] text-brand-orange mb-4">SKATEHUBBA™</span>
          <h1 className="font-display text-3xl text-white mb-2">Something broke</h1>
          <p className="font-body text-sm text-[#888] mb-6 text-center max-w-sm">
            {this.state.error.message}
          </p>
          <button
            onClick={() => { this.setState({ error: null }); window.location.reload(); }}
            className="px-6 py-3 rounded-xl bg-brand-orange text-white font-display tracking-wider"
          >
            Reload App
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

/* ═══════════════════════════════════════════
 *  BRAND TOKENS
 * ═══════════════════════════════════════════ */

const BG = "#0A0A0A";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Guard against open-redirect or XSS via crafted video URLs stored in Firestore. */
function isFirebaseStorageUrl(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url);
    // Use exact match or strict subdomain regex — .endsWith() is bypassable via
    // domains like "firebasestorage.googleapis.com.evil.com"
    return (
      protocol === "https:" &&
      (hostname === "firebasestorage.googleapis.com" ||
        /^[a-z0-9-]+\.firebasestorage\.app$/.test(hostname))
    );
  } catch {
    return false;
  }
}

/** Returns 1 (weak) | 2 (fair) | 3 (strong) — used for signup password indicator. */
function pwStrength(pw: string): 1 | 2 | 3 {
  if (pw.length < 8) return 1;
  const hasUpper = /[A-Z]/.test(pw);
  const hasDigit = /[0-9]/.test(pw);
  const hasSymbol = /[^a-zA-Z0-9]/.test(pw);
  if (pw.length >= 12 && (hasUpper || hasDigit) && hasSymbol) return 3;
  if (pw.length >= 8 && (hasUpper || hasDigit || hasSymbol)) return 2;
  return 1;
}

const LETTERS = ["S", "K", "A", "T", "E"];

/** Build a placeholder GameDoc for optimistic UI before the real-time listener syncs. */
function newGameShell(
  gameId: string,
  myUid: string,
  myUsername: string,
  opponentUid: string,
  opponentUsername: string,
): GameDoc {
  // Capture deadline at shell-creation time so the Timer counts down correctly
  // while waiting for the real Firestore document to arrive.
  const shellDeadline = Date.now() + 86400000;
  return {
    id: gameId,
    player1Uid: myUid,
    player2Uid: opponentUid,
    player1Username: myUsername,
    player2Username: opponentUsername,
    p1Letters: 0,
    p2Letters: 0,
    status: "active",
    currentTurn: myUid,
    phase: "setting",
    currentSetter: myUid,
    currentTrickName: null,
    currentTrickVideoUrl: null,
    matchVideoUrl: null,
    turnDeadline: { toMillis: () => shellDeadline } as unknown as GameDoc["turnDeadline"],
    turnNumber: 1,
    winner: null,
    createdAt: null,
    updatedAt: null,
  };
}

/* ═══════════════════════════════════════════
 *  SHARED UI COMPONENTS
 * ═══════════════════════════════════════════ */

function Btn({
  children, onClick, variant = "primary", disabled, className = "", type = "button",
}: {
  children: ReactNode; onClick?: () => void; variant?: string; disabled?: boolean; className?: string;
  type?: "button" | "submit";
}) {
  const base =
    "w-full rounded-xl font-display tracking-wider text-center transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange";
  const variants: Record<string, string> = {
    primary: "bg-brand-orange text-white py-4 text-xl",
    secondary: "bg-surface-alt border border-border text-white py-3.5 text-lg",
    success: "bg-brand-green text-black py-4 text-xl font-bold",
    danger: "bg-brand-red text-white py-4 text-xl",
    ghost: "bg-transparent border border-border text-[#888] py-3 text-lg",
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`${base} ${variants[variant ?? "primary"]} ${className}`}
    >
      {children}
    </button>
  );
}

function Field({
  label, value, onChange, placeholder, type = "text", maxLength, note, fieldError, icon, autoComplete, autoFocus,
}: {
  label?: string; value: string; onChange: (v: string) => void;
  placeholder?: string; type?: string; maxLength?: number; note?: string; fieldError?: string; icon?: string;
  autoComplete?: string; autoFocus?: boolean;
}) {
  const id = useId();
  return (
    <div className="mb-4 w-full">
      {label && (
        <label htmlFor={id} className="block font-display text-sm tracking-[0.12em] text-[#999] mb-1.5">
          {label}
        </label>
      )}
      <div className="relative">
        {icon && (
          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#555] text-base" aria-hidden="true">
            {icon}
          </span>
        )}
        <input
          id={id}
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          maxLength={maxLength}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className={`w-full bg-surface-alt border rounded-xl text-white text-base font-body outline-none
            focus:border-brand-orange transition-colors duration-200
            ${fieldError ? "border-red-500" : "border-border"}
            ${icon ? "pl-10 pr-4 py-3.5" : "px-4 py-3.5"}`}
        />
      </div>
      {fieldError && <span className="text-xs text-red-400 mt-1 block">{fieldError}</span>}
      {!fieldError && note && <span className="text-xs text-[#777] mt-1 block">{note}</span>}
    </div>
  );
}

function LetterDisplay({ count, name, active }: { count: number; name: string; active?: boolean }) {
  return (
    <div
      className={`flex flex-col items-center gap-1.5 px-4 py-3 rounded-xl border transition-all duration-300 min-w-[84px]
        ${active ? "border-brand-orange bg-[rgba(255,107,0,0.08)]" : "border-border bg-transparent"}`}
      aria-label={`${name}: ${LETTERS.slice(0, count).join(".")}${count > 0 ? "." : "no letters"}`}
    >
      <span className={`font-body text-xs font-semibold ${active ? "text-brand-orange" : "text-[#888]"}`}>
        {name}
      </span>
      <div className="flex gap-1">
        {LETTERS.map((l, i) => (
          <span
            key={i}
            className={`font-display text-xl transition-all duration-300
              ${i < count ? "text-brand-red scale-110" : "text-[#555]"}`}
            style={i < count ? { textShadow: "0 0 10px rgba(255,61,0,0.4)" } : {}}
          >
            {l}
          </span>
        ))}
      </div>
    </div>
  );
}

function Timer({ deadline }: { deadline: number }) {
  const [text, setText] = useState("");
  useEffect(() => {
    // idRef lets the tick callback cancel itself without a mutable let
    const idRef = { current: 0 };
    const tick = () => {
      const diff = deadline - Date.now();
      if (diff <= 0) {
        setText("TIME'S UP");
        clearInterval(idRef.current);
        return;
      }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setText(`${h}h ${m}m ${s}s`);
    };
    tick();
    idRef.current = window.setInterval(tick, 1000);
    return () => clearInterval(idRef.current);
  }, [deadline]);
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-alt border border-border" aria-live="polite">
      <span className="text-[#555] text-sm" aria-hidden="true">⏱</span>
      <span className="font-display text-sm text-brand-orange tracking-wider" aria-label={`Turn timer: ${text}`}>{text}</span>
    </div>
  );
}

function Spinner() {
  return (
    <div className="flex items-center justify-center min-h-dvh bg-[#0A0A0A]">
      <div className="flex flex-col items-center gap-4 animate-fade-in">
        <div className="w-10 h-10 border-2 border-[#2A2A2A] border-t-brand-orange rounded-full animate-spin" />
        <span className="font-display text-sm tracking-[0.25em] text-brand-orange">SKATEHUBBA™</span>
      </div>
    </div>
  );
}

function ErrorBanner({ message, onDismiss }: { message: string; onDismiss?: () => void }) {
  if (!message) return null;
  return (
    <div role="alert" className="w-full p-3 rounded-xl bg-[rgba(255,61,0,0.08)] border border-brand-red mb-4 flex justify-between items-center">
      <span className="font-body text-sm text-brand-red">{message}</span>
      {onDismiss && (
        <button type="button" onClick={onDismiss} className="text-brand-red text-lg leading-none ml-2 p-1" aria-label="Dismiss error">×</button>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════
 *  COOKIE CONSENT BANNER
 * ═══════════════════════════════════════════ */

const CONSENT_KEY = "sh_analytics_consent";

function CookieConsent({
  onAccept,
  onDecline,
  onPrivacy,
}: {
  onAccept: () => void;
  onDecline: () => void;
  onPrivacy: () => void;
}) {
  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 p-4 bg-surface border-t border-border animate-fade-in">
      <div className="max-w-lg mx-auto">
        <p className="font-body text-sm text-[#999] mb-3">
          We use Vercel Analytics to understand how the app is used. No personally
          identifiable data is collected.{" "}
          <button
            type="button"
            onClick={onPrivacy}
            className="text-brand-orange underline bg-transparent border-none cursor-pointer"
          >
            Privacy Policy
          </button>
        </p>
        <div className="flex gap-2">
          <Btn onClick={onAccept} className="py-2 text-sm">
            Accept
          </Btn>
          <Btn onClick={onDecline} variant="ghost" className="py-2 text-sm">
            Decline
          </Btn>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
 *  SCREEN: PRIVACY POLICY
 * ═══════════════════════════════════════════ */

function PrivacyPolicyScreen({ onBack }: { onBack: () => void }) {
  return (
    <div className="min-h-dvh bg-[#0A0A0A] pb-12">
      <div className="px-5 pt-5 pb-4 border-b border-border flex items-center gap-4">
        <button type="button" onClick={onBack} className="font-body text-sm text-[#888]">
          ← Back
        </button>
        <span className="font-display text-sm tracking-[0.25em] text-brand-orange">SKATEHUBBA™</span>
      </div>
      <div className="max-w-lg mx-auto px-5 pt-8 font-body text-[#888] leading-relaxed space-y-5">
        <h1 className="font-display text-3xl text-white">Privacy Policy</h1>
        <p className="text-xs text-[#555]">Last updated: March 2026</p>

        <section>
          <h2 className="font-display text-lg text-white mb-2">What We Collect</h2>
          <p>When you create an account, we collect your email address and the username you choose. Google sign-in may provide your display name. Videos you record during gameplay are stored on Firebase Storage and are only accessible to you and your opponent.</p>
        </section>

        <section>
          <h2 className="font-display text-lg text-white mb-2">Analytics</h2>
          <p>We use Vercel Analytics to measure page views and Core Web Vitals. This data is aggregated and does not identify individual users. You can decline analytics collection in the consent banner.</p>
        </section>

        <section>
          <h2 className="font-display text-lg text-white mb-2">Error Tracking</h2>
          <p>We use Sentry to capture application errors to improve reliability. Error reports may include browser type, OS, and a stack trace. No personally identifiable data is intentionally sent to Sentry.</p>
        </section>

        <section>
          <h2 className="font-display text-lg text-white mb-2">Firebase</h2>
          <p>Authentication, game data, and video uploads are stored in Google Firebase (Firestore and Cloud Storage). Firebase is governed by Google's Privacy Policy. Firebase Auth stores your email address to manage your account.</p>
        </section>

        <section>
          <h2 className="font-display text-lg text-white mb-2">Your Rights</h2>
          <p>You can delete your account and associated profile data at any time from the Lobby → Delete Account. Game history is retained for your opponent's records. To request a full data export or removal, contact us at privacy@skatehubba.com.</p>
        </section>

        <section>
          <h2 className="font-display text-lg text-white mb-2">Contact</h2>
          <p>Questions? Email privacy@skatehubba.com</p>
        </section>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
 *  SCREEN: TERMS OF SERVICE
 * ═══════════════════════════════════════════ */

function TermsOfServiceScreen({ onBack }: { onBack: () => void }) {
  return (
    <div className="min-h-dvh bg-[#0A0A0A] pb-12">
      <div className="px-5 pt-5 pb-4 border-b border-border flex items-center gap-4">
        <button type="button" onClick={onBack} className="font-body text-sm text-[#888]">
          ← Back
        </button>
        <span className="font-display text-sm tracking-[0.25em] text-brand-orange">SKATEHUBBA™</span>
      </div>
      <div className="max-w-lg mx-auto px-5 pt-8 font-body text-[#888] leading-relaxed space-y-5">
        <h1 className="font-display text-3xl text-white">Terms of Service</h1>
        <p className="text-xs text-[#555]">Last updated: March 2026</p>

        <section>
          <h2 className="font-display text-lg text-white mb-2">Use of the App</h2>
          <p>SkateHubba is provided for personal, non-commercial use. You must be 13 years of age or older to create an account. You are responsible for the content you upload, including trick videos.</p>
        </section>

        <section>
          <h2 className="font-display text-lg text-white mb-2">Acceptable Use</h2>
          <p>Do not upload content that is illegal, harmful, threatening, abusive, or infringes on the intellectual property of others. We reserve the right to remove content or suspend accounts that violate these terms.</p>
        </section>

        <section>
          <h2 className="font-display text-lg text-white mb-2">Game Rules</h2>
          <p>S.K.A.T.E. games are self-judged. You agree to judge honestly whether you landed a trick. Exploiting the self-judgment system or creating fake accounts is grounds for account termination.</p>
        </section>

        <section>
          <h2 className="font-display text-lg text-white mb-2">Disclaimer</h2>
          <p>Skateboarding is a physical activity with inherent risks. SkateHubba is not responsible for any injuries that occur while filming tricks. Always skate safely and follow local laws.</p>
        </section>

        <section>
          <h2 className="font-display text-lg text-white mb-2">Changes</h2>
          <p>We may update these terms. Continued use of the app after changes constitutes acceptance of the new terms. Contact legal@skatehubba.com with questions.</p>
        </section>
      </div>
    </div>
  );
}

function InviteButton({ username, className = "" }: { username?: string; className?: string }) {
  const [showPanel, setShowPanel] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [copied, setCopied] = useState(false);

  const url = import.meta.env.VITE_APP_URL || window.location.origin;
  const text = username
    ? `I'm playing S.K.A.T.E. on SkateHubba — challenge me! My handle: @${username}`
    : "Play S.K.A.T.E. on SkateHubba — the first async trick battle game!";
  const fullMessage = `${text}\n${url}`;
  const encodedText = encodeURIComponent(fullMessage);
  const encodedUrl = encodeURIComponent(url);

  const flash = (msg: string, ms = 3000) => {
    setStatusMsg(msg);
    setTimeout(() => setStatusMsg(""), ms);
  };

  const handleContacts = async () => {
    if (!("contacts" in navigator) || !navigator.contacts) {
      flash("Phone contacts not available in this browser. Try Chrome on Android.");
      return;
    }
    try {
      const contacts = await navigator.contacts.select(
        ["name", "tel"],
        { multiple: true }
      );
      if (!contacts.length) return;

      const phones = contacts
        .flatMap((c) => c.tel || [])
        .filter(Boolean)
        // Strip any char that can't appear in a valid phone number to prevent
        // SMS URI injection (e.g. "?" or "&" would break the body parameter)
        .map((p) => p.replace(/[^0-9+\-().# ]/g, "").trim())
        .filter((p) => p.length > 0);
      if (phones.length === 0) {
        flash("Selected contacts have no phone numbers.");
        return;
      }

      const recipients = phones.join(",");
      const smsBody = encodeURIComponent(fullMessage);
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
      window.location.href = `sms:${recipients}${isIOS ? "&" : "?"}body=${smsBody}`;
    } catch {
      /* user cancelled picker */
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(fullMessage);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      flash("Could not copy — try long-pressing to copy instead.");
    }
  };

  const handleNativeShare = async () => {
    try { await navigator.share({ title: "SkateHubba", text, url }); } catch { /* cancelled */ }
  };

  const socials = [
    { name: "X", icon: "𝕏", href: `https://twitter.com/intent/tweet?text=${encodedText}` },
    { name: "WhatsApp", icon: "WA", href: `https://wa.me/?text=${encodedText}` },
    { name: "Snapchat", icon: "SC", href: `https://www.snapchat.com/scan?attachmentUrl=${encodedUrl}` },
    { name: "Facebook", icon: "FB", href: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}` },
    { name: "Reddit", icon: "Re", href: `https://www.reddit.com/submit?url=${encodedUrl}&title=${encodeURIComponent(text)}` },
    { name: "Telegram", icon: "TG", href: `https://t.me/share/url?url=${encodedUrl}&text=${encodeURIComponent(text)}` },
  ];

  const tileBase =
    "rounded-xl bg-surface-alt border border-border hover:border-brand-orange active:scale-95 transition-all duration-150";

  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => setShowPanel(!showPanel)}
        className="w-full flex items-center justify-center gap-2.5 bg-transparent border border-border text-[#666] hover:text-white hover:border-[#3A3A3A] rounded-xl py-[13px] font-display tracking-wider text-lg transition-all duration-200 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
      >
        {showPanel ? (
          <>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
            Close
          </>
        ) : (
          <>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
              <polyline points="16 6 12 2 8 6"/>
              <line x1="12" y1="2" x2="12" y2="15"/>
            </svg>
            Invite a Friend
          </>
        )}
      </button>

      {showPanel && (
        <div className="mt-3 p-4 rounded-2xl bg-surface border border-border animate-fade-in space-y-4">
          {/* ── Phone Contacts ── */}
          <div>
            <h4 className="font-display text-[11px] tracking-[0.2em] text-[#555] mb-2">TEXT A FRIEND</h4>
            <button
              type="button"
              onClick={handleContacts}
              className={`w-full flex items-center gap-3 p-3.5 text-left ${tileBase}
                border-[rgba(255,107,0,0.25)] bg-[rgba(255,107,0,0.04)]`}
            >
              <div className="w-9 h-9 rounded-lg bg-[rgba(255,107,0,0.1)] flex items-center justify-center shrink-0">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FF6B00" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
                </svg>
              </div>
              <div>
                <span className="font-display text-sm tracking-wider text-white block">FROM YOUR CONTACTS</span>
                <span className="font-body text-xs text-[#666]">Pick people & send via SMS</span>
              </div>
            </button>
          </div>

          {statusMsg && (
            <div className="text-xs text-brand-orange font-body px-1 animate-fade-in">{statusMsg}</div>
          )}

          {/* ── Social Media ── */}
          <div>
            <h4 className="font-display text-[11px] tracking-[0.2em] text-[#555] mb-2">SHARE ON SOCIALS</h4>
            <div className="grid grid-cols-3 gap-2">
              {socials.map((s) => (
                <a
                  key={s.name}
                  href={s.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`flex flex-col items-center gap-2 py-3 ${tileBase}`}
                >
                  <span className="font-display text-sm text-white tracking-wide leading-none">{s.icon}</span>
                  <span className="font-body text-[10px] text-[#555] leading-none">{s.name}</span>
                </a>
              ))}
            </div>
          </div>

          {/* ── Copy & Share ── */}
          <div className="flex gap-2">
            <button type="button" onClick={handleCopy} className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 font-body text-xs ${tileBase} ${
              copied ? "border-brand-green text-brand-green" : "text-[#888]"
            }`}>
              {copied ? (
                <>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                  Copied
                </>
              ) : (
                <>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                  </svg>
                  Copy Link
                </>
              )}
            </button>
            {typeof navigator.share === "function" && (
              <button
                type="button"
                onClick={handleNativeShare}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 font-body text-xs text-[#888] ${tileBase}`}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
                  <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
                  <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
                </svg>
                Share
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════
 *  VIDEO RECORDER (one-take, no retries)
 * ═══════════════════════════════════════════ */

function VideoRecorder({
  onRecorded,
  label,
  autoOpen = false,
  doneLabel = "Recorded",
}: {
  onRecorded: (blob: Blob | null) => void;
  label: string;
  autoOpen?: boolean;
  doneLabel?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const mrRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number>(0);
  // Track the current blob URL in a ref so the cleanup effect can revoke it
  // even though it runs with [] deps (avoids stale closure memory leak)
  const blobUrlRef = useRef<string | null>(null);

  const [state, setState] = useState<"idle" | "preview" | "recording" | "done">("idle");
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);

  const openCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 720 }, height: { ideal: 1280 } },
        audio: true,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
      setState("preview");
    } catch (err) {
      // Camera unavailable or permission denied — allow demo flow without video
      console.warn("Camera access failed:", err instanceof Error ? err.message : err);
      setState("preview");
    }
  }, []);

  const startRec = useCallback(() => {
    if (!streamRef.current) {
      // Demo mode without camera
      setState("recording");
      setSeconds(0);
      timerRef.current = window.setInterval(() => setSeconds((s) => s + 1), 1000);
      return;
    }
    chunksRef.current = [];
    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
      ? "video/webm;codecs=vp9"
      : MediaRecorder.isTypeSupported("video/webm")
        ? "video/webm"
        : ""; // Let browser choose default
    const mr = new MediaRecorder(streamRef.current, mimeType ? { mimeType } : undefined);
    mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    mr.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: "video/webm" });
      if (blob.size === 0) {
        // Recording captured no data — treat as demo mode
        setState("done");
        onRecorded(null);
        return;
      }
      const url = URL.createObjectURL(blob);
      blobUrlRef.current = url;
      setBlobUrl(url);
      setState("done");
      onRecorded(blob);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
    mrRef.current = mr;
    mr.start();
    setState("recording");
    setSeconds(0);
    timerRef.current = window.setInterval(() => setSeconds((s) => s + 1), 1000);
  }, [onRecorded]);

  const stopRec = useCallback(() => {
    clearInterval(timerRef.current);
    if (mrRef.current?.state === "recording") {
      mrRef.current.stop();
    } else {
      setState("done");
      onRecorded(null); // demo mode
    }
  }, [onRecorded]);

  useEffect(() => {
    return () => {
      clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    };
  }, []);

  // Auto-open camera once on mount when autoOpen is true.
  // autoOpen is a static prop; openCamera is a stable useCallback — no deps needed.
  const autoOpenRef = useRef(autoOpen);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (autoOpenRef.current) openCamera();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;

  return (
    <div className="w-full flex flex-col items-center gap-4">
      {/* Viewfinder */}
      <div
        className={`w-full max-w-[360px] aspect-[9/16] bg-black rounded-2xl overflow-hidden relative transition-all duration-300
          ${state === "recording" ? "border-2 border-brand-red shadow-[0_0_30px_rgba(255,61,0,0.15)]" : "border border-border"}`}
      >
        {state === "done" && blobUrl ? (
          <video src={blobUrl} className="w-full h-full object-cover" controls />
        ) : (
          <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
        )}

        {state === "recording" && (
          <div className="absolute top-4 left-4 flex items-center gap-2 bg-black/70 px-3 py-1.5 rounded-full">
            <div className="w-2.5 h-2.5 rounded-full bg-brand-red animate-rec-pulse" />
            <span className="font-display text-lg text-white tracking-wider">{fmt(seconds)}</span>
          </div>
        )}

        {state === "idle" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
            <span className="text-5xl opacity-30">📹</span>
            <span className="font-body text-sm text-[#555]">Camera preview</span>
          </div>
        )}

        <div className="absolute top-4 right-4 bg-brand-orange/90 px-2.5 py-1 rounded-md">
          <span className="font-display text-[11px] text-white tracking-[0.1em]">ONE TAKE</span>
        </div>
      </div>

      {/* Controls */}
      {state === "idle" && (
        <Btn onClick={openCamera} variant="secondary">📷 Open Camera</Btn>
      )}
      {state === "preview" && (
        <Btn onClick={startRec} variant="danger" className="text-2xl py-5">
          ⏺ Record — {label}
        </Btn>
      )}
      {state === "recording" && (
        <Btn onClick={stopRec} variant="danger" className="text-2xl py-5 animate-rec-ring">
          ⏹ Stop Recording
        </Btn>
      )}
      {state === "done" && (
        <div className="flex items-center gap-2 px-5 py-3 rounded-xl bg-[rgba(0,230,118,0.08)] border border-brand-green">
          <span className="text-brand-green font-display text-lg tracking-wider">
            ✓ {doneLabel}
          </span>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════
 *  SCREEN: LANDING
 * ═══════════════════════════════════════════ */

function Landing({
  onGo, onGoogle, googleLoading, onPrivacy, onTerms,
}: {
  onGo: (mode: "signup" | "signin") => void;
  onGoogle: () => void;
  googleLoading: boolean;
  onPrivacy: () => void;
  onTerms: () => void;
}) {
  return (
    <div
      className="min-h-dvh flex flex-col items-center justify-center px-6"
      style={{ background: `radial-gradient(ellipse at 50% 0%, rgba(255,107,0,0.06) 0%, transparent 60%), ${BG}` }}
    >
      <span className="font-display text-lg tracking-[0.35em] text-brand-orange mb-2">SKATEHUBBA™</span>
      <h1 className="font-display text-[clamp(56px,12vw,88px)] text-white leading-[0.95] text-center">
        S.K.A.T.E.
      </h1>
      <p className="font-body text-base text-[#888] text-center max-w-xs mt-4 mb-10 leading-relaxed">
        The first async trick battle game.<br />Set tricks. Match tricks. One take only.
      </p>
      <div className="w-full max-w-xs flex flex-col gap-3">
        <GoogleButton onClick={onGoogle} loading={googleLoading} />
        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-border" />
          <span className="font-body text-xs text-[#444]">or</span>
          <div className="flex-1 h-px bg-border" />
        </div>
        <Btn onClick={() => onGo("signup")} disabled={googleLoading}>Get Started with Email</Btn>
        <Btn onClick={() => onGo("signin")} variant="ghost" disabled={googleLoading}>I Have an Account</Btn>
        <InviteButton className="mt-2" />
      </div>
      <div className="flex gap-5 mt-12 flex-wrap justify-center">
        {[
          { icon: "📹", text: "One-take video" },
          { icon: "⏱", text: "24hr turns" },
          { icon: "🔥", text: "No trick-farming" },
        ].map((f) => (
          <div key={f.text} className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border">
            <span className="text-base">{f.icon}</span>
            <span className="font-body text-xs text-[#555]">{f.text}</span>
          </div>
        ))}
      </div>
      <div className="flex gap-4 mt-8">
        <button type="button" onClick={onPrivacy} className="font-body text-xs text-[#444] hover:text-[#888] transition-colors bg-transparent border-none cursor-pointer">
          Privacy Policy
        </button>
        <button type="button" onClick={onTerms} className="font-body text-xs text-[#444] hover:text-[#888] transition-colors bg-transparent border-none cursor-pointer">
          Terms of Service
        </button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
 *  SCREEN: AUTH
 * ═══════════════════════════════════════════ */

function GoogleButton({ onClick, loading }: { onClick: () => void; loading: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className="w-full flex items-center justify-center gap-3 rounded-xl border border-border bg-white text-[#1f1f1f] font-body text-base font-medium py-3.5 transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98] hover:bg-[#f5f5f5]"
    >
      {loading ? (
        <div className="w-5 h-5 border-2 border-[#ccc] border-t-[#4285F4] rounded-full animate-spin" />
      ) : (
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
        </svg>
      )}
      {loading ? "Signing in…" : "Continue with Google"}
    </button>
  );
}

function AuthScreen({
  mode, onDone, onToggle, onGoogle, googleLoading, googleError,
}: {
  mode: "signup" | "signin";
  onDone: () => void;
  onToggle: () => void;
  onGoogle: () => void;
  googleLoading: boolean;
  googleError: string;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const isSignup = mode === "signup";
  const anyLoading = loading || googleLoading;

  const submit = async () => {
    setError("");
    if (!EMAIL_RE.test(email.trim())) { setError("Enter a valid email"); return; }
    if (password.length < 6) { setError("Password must be 6+ characters"); return; }
    if (isSignup && password !== confirm) { setError("Passwords don't match"); return; }

    setLoading(true);
    try {
      if (isSignup) {
        await signUp(email, password);
      } else {
        await signIn(email, password);
      }
      onDone();
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code ?? "";
      if (code === "auth/email-already-in-use")
        setError("Email already in use. Try signing in, or use Google below.");
      else if (code === "auth/account-exists-with-different-credential")
        setError("This email is linked to Google. Tap 'Continue with Google' below.");
      else if (code === "auth/invalid-credential" || code === "auth/wrong-password")
        setError("Invalid email or password");
      else if (code === "auth/user-not-found")
        setError("No account with that email. Need to sign up?");
      else if (code === "auth/weak-password")
        setError("Password too weak (6+ chars)");
      else
        setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async () => {
    if (!EMAIL_RE.test(email.trim())) { setError("Enter your email first"); return; }
    try {
      await resetPassword(email);
      setResetSent(true);
    } catch {
      setResetSent(true); // Don't reveal if email exists
    }
  };

  // Combine local + parent Google errors; local error takes priority
  const displayError = error || googleError;

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center px-6 bg-[#0A0A0A]">
      <div className="w-full max-w-sm p-8 rounded-2xl bg-surface border border-border animate-fade-in">
        <span className="font-display text-sm tracking-[0.3em] text-brand-orange block mb-2">SKATEHUBBA™</span>
        <h2 className="font-display text-4xl text-white mb-1">
          {isSignup ? "Create Account" : "Welcome Back"}
        </h2>
        <p className="font-body text-sm text-[#888] mb-7">
          {isSignup ? "Join the crew. It's free." : "Sign in to continue your games."}
        </p>

        {/* Google — primary CTA at top */}
        <GoogleButton onClick={onGoogle} loading={googleLoading} />

        <div className="flex items-center gap-3 my-5">
          <div className="flex-1 h-px bg-border" />
          <span className="font-body text-xs text-[#444]">or continue with email</span>
          <div className="flex-1 h-px bg-border" />
        </div>

        <form
          onSubmit={(e) => { e.preventDefault(); submit(); }}
          noValidate
          className={`transition-opacity duration-200 ${googleLoading ? "opacity-40 pointer-events-none" : ""}`}
        >
          <Field label="Email" value={email} onChange={setEmail} placeholder="you@email.com" icon="@" type="email" autoComplete="email" />
          <Field label="Password" value={password} onChange={setPassword} placeholder="••••••••" icon="🔒" type="password" autoComplete={isSignup ? "new-password" : "current-password"} />
          {isSignup && password.length > 0 && (() => {
            const strength = pwStrength(password);
            const labels: Record<1 | 2 | 3, string> = { 1: "Weak", 2: "Fair", 3: "Strong" };
            const colors: Record<1 | 2 | 3, string> = {
              1: "bg-brand-red",
              2: "bg-yellow-500",
              3: "bg-brand-green",
            };
            return (
              <div className="flex items-center gap-2 -mt-2 mb-4">
                <div className="flex gap-1 flex-1">
                  {([1, 2, 3] as const).map((lvl) => (
                    <div
                      key={lvl}
                      className={`h-0.5 flex-1 rounded-full transition-colors duration-300 ${
                        strength >= lvl ? colors[strength] : "bg-surface-alt"
                      }`}
                    />
                  ))}
                </div>
                <span className={`font-body text-[10px] ${colors[strength].replace("bg-", "text-")}`}>
                  {labels[strength]}
                </span>
              </div>
            );
          })()}
          {isSignup && (
            <Field label="Confirm" value={confirm} onChange={setConfirm} placeholder="••••••••" icon="🔒" type="password" autoComplete="new-password" />
          )}

          <ErrorBanner message={displayError} onDismiss={() => setError("")} />

          {resetSent && (
            <div className="w-full p-3 rounded-xl bg-[rgba(0,230,118,0.08)] border border-brand-green mb-4">
              <span className="font-body text-sm text-brand-green">Reset email sent (if account exists)</span>
            </div>
          )}

          <Btn type="submit" disabled={anyLoading}>
            {loading ? "..." : isSignup ? "Create Account" : "Sign In"}
          </Btn>
        </form>

        {!isSignup && !googleLoading && (
          <button
            type="button"
            className="w-full font-body text-xs text-[#555] text-center mt-3 cursor-pointer hover:text-[#888] transition-colors bg-transparent border-none"
            onClick={handleReset}
          >
            Forgot password?
          </button>
        )}

        <button
          type="button"
          className="w-full font-body text-sm text-[#555] text-center mt-5 cursor-pointer bg-transparent border-none"
          onClick={onToggle}
        >
          {isSignup ? "Already have an account? " : "Need an account? "}
          <span className="text-brand-orange">{isSignup ? "Sign in" : "Sign up"}</span>
        </button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
 *  SCREEN: PROFILE SETUP
 * ═══════════════════════════════════════════ */

function ProfileSetup({
  uid, email, emailVerified = false, displayName, onDone,
}: {
  uid: string; email: string; emailVerified?: boolean; displayName?: string | null;
  onDone: (p: UserProfile) => void;
}) {
  // Pre-fill from Google display name (sanitised to valid username chars).
  // Email/password users get no pre-fill so they choose their own handle.
  const suggested = (displayName ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 20);
  const [username, setUsername] = useState(suggested);
  const [usernameFieldError] = useState("");
  const [stance, setStance] = useState("Regular");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const checkRef = useRef<number>(0);

  // Debounced username availability check
  useEffect(() => {
    setAvailable(null);
    const normalized = username.toLowerCase().trim();
    if (normalized.length < 3) return;

    const id = ++checkRef.current;
    const timeout = setTimeout(async () => {
      try {
        const ok = await isUsernameAvailable(normalized);
        if (checkRef.current === id) setAvailable(ok);
      } catch {
        // Firestore read failed — treat as unavailable and show error
        if (checkRef.current === id) setAvailable(null);
        setError("Could not check username — try again");
      }
    }, 400);
    return () => clearTimeout(timeout);
  }, [username]);

  const submit = async () => {
    setError("");
    const normalized = username.toLowerCase().trim();
    if (normalized.length < 3) { setError("Username must be 3+ characters"); return; }
    if (normalized.length > 20) { setError("Username too long (max 20)"); return; }
    if (!/^[a-z0-9_]+$/.test(normalized)) { setError("Only letters, numbers, and _ allowed"); return; }
    if (available === false) { setError("Username is taken"); return; }
    if (available === null) { setError("Still checking username — wait a moment"); return; }

    setLoading(true);
    try {
      const profile = await createProfile(uid, email, normalized, stance, emailVerified);
      onDone(profile);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not create profile");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center px-6 bg-[#0A0A0A]">
      <div className="w-full max-w-sm p-8 rounded-2xl bg-surface border border-border animate-fade-in">
        <span className="font-display text-xs tracking-[0.3em] text-brand-orange block mb-2">PROFILE SETUP</span>
        <h2 className="font-display text-3xl text-white mb-1">Lock in your handle</h2>
        <p className="font-body text-sm text-[#888] mb-7">This is how the crew knows you.</p>

        <form onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
          <Field
            label="Username"
            value={username}
            onChange={(v) => { if (!loading) setUsername(v.replace(/[^a-zA-Z0-9_]/g, "")); }}
            placeholder="sk8legend"
            maxLength={20}
            icon="@"
            autoComplete="username"
            autoFocus
            fieldError={usernameFieldError}
            note={
              !usernameFieldError
                ? username.length >= 3
                  ? available === null
                    ? "Checking..."
                    : available
                      ? `@${username.toLowerCase()} is available ✓`
                      : `@${username.toLowerCase()} is taken ✗`
                  : "Min 3 characters, letters/numbers/underscore"
                : undefined
            }
          />

          <div className="mb-6">
            <label className="block font-display text-sm tracking-[0.12em] text-[#888] mb-2">Stance</label>
            <div className="flex gap-3">
              {["Regular", "Goofy"].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => { if (!loading) setStance(s); }}
                  disabled={loading}
                  className={`flex-1 py-3 rounded-xl font-display text-lg tracking-wider cursor-pointer transition-all disabled:opacity-40 disabled:cursor-not-allowed
                    ${stance === s
                      ? "bg-[rgba(255,107,0,0.08)] border border-brand-orange text-brand-orange"
                      : "bg-surface-alt border border-border text-[#888]"
                    }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          <ErrorBanner message={error} onDismiss={() => setError("")} />

          <Btn onClick={submit} disabled={loading || username.length < 3 || available !== true}>
            {loading ? "Creating..." : "Lock It In"}
          </Btn>
        </form>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
 *  SCREEN: LOBBY
 * ═══════════════════════════════════════════ */

const RESEND_COOLDOWN_S = 60;

function VerifyEmailBanner({ emailVerified }: { emailVerified: boolean }) {
  const [sending, setSending] = useState(false);
  const [cooldown, setCooldown] = useState(0); // seconds until resend is available again
  const [sendError, setSendError] = useState(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = window.setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  if (emailVerified) return null;

  const handleResend = async () => {
    setSending(true);
    setSendError(false);
    try {
      await resendVerification();
      setCooldown(RESEND_COOLDOWN_S);
    } catch {
      setSendError(true);
    } finally {
      setSending(false);
    }
  };

  const btnLabel = sending
    ? "..."
    : cooldown > 0
      ? `${cooldown}s`
      : sendError
        ? "Retry"
        : "Resend";

  return (
    <div className="mx-5 mt-4 p-3.5 rounded-xl bg-[rgba(255,107,0,0.06)] border border-brand-orange flex items-center justify-between gap-3">
      <div>
        <span className="font-display text-xs tracking-wider text-brand-orange block">VERIFY YOUR EMAIL</span>
        <span className="font-body text-xs text-[#888]">
          {sendError ? "Failed to send — check your connection." : "Check your inbox for the verification link."}
        </span>
      </div>
      <button
        type="button"
        onClick={handleResend}
        disabled={sending || cooldown > 0}
        className="font-display text-[11px] tracking-wider text-brand-orange border border-brand-orange rounded-lg px-3 py-1.5 whitespace-nowrap disabled:opacity-40 transition-opacity"
        aria-label={cooldown > 0 ? `Resend available in ${cooldown} seconds` : "Resend verification email"}
      >
        {btnLabel}
      </button>
    </div>
  );
}

function Lobby({
  profile, games, onChallenge, onOpenGame, onSignOut, onDeleteAccount, user,
}: {
  profile: UserProfile; games: GameDoc[];
  onChallenge: () => void; onOpenGame: (g: GameDoc) => void; onSignOut: () => void;
  onDeleteAccount: () => Promise<void>;
  user: { emailVerified?: boolean } | null;
}) {
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const active = games.filter((g) => g.status === "active");
  const done = games.filter((g) => g.status !== "active");

  const opponent = (g: GameDoc) =>
    g.player1Uid === profile.uid ? g.player2Username : g.player1Username;

  const isMyTurn = (g: GameDoc) => g.currentTurn === profile.uid;

  const myLetters = (g: GameDoc) =>
    g.player1Uid === profile.uid ? g.p1Letters : g.p2Letters;
  const theirLetters = (g: GameDoc) =>
    g.player1Uid === profile.uid ? g.p2Letters : g.p1Letters;

  return (
    <div className="min-h-dvh bg-[#0A0A0A] pb-24">
      {/* Header */}
      <div className="px-5 pt-5 pb-4 flex justify-between items-center border-b border-border">
        <span className="font-display text-sm tracking-[0.25em] text-brand-orange">SKATEHUBBA™</span>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-surface-alt border border-border flex items-center justify-center shrink-0">
              <span className="font-display text-[11px] text-brand-orange leading-none">
                {profile.username[0].toUpperCase()}
              </span>
            </div>
            <span className="font-body text-xs text-[#555]">@{profile.username}</span>
          </div>
          <button
            type="button"
            onClick={onSignOut}
            className="font-body text-xs text-[#555] hover:text-white transition-colors duration-200 px-2.5 py-1.5 rounded-lg border border-border hover:border-[#3A3A3A]"
          >
            Sign Out
          </button>
        </div>
      </div>

      <VerifyEmailBanner emailVerified={user?.emailVerified ?? false} />

      <div className="px-5 pt-7 max-w-lg mx-auto">
        {/* Page header */}
        <div className="mb-7">
          <h1 className="font-display text-[44px] leading-none text-white tracking-wide">Your Games</h1>
          {games.length > 0 && (
            <p className="font-body text-xs text-[#555] mt-1.5">
              {active.length > 0 ? `${active.length} active` : "No active games"}
              {done.length > 0 ? ` · ${done.length} completed` : ""}
            </p>
          )}
        </div>

        {/* Primary CTA — Challenge */}
        <button
          type="button"
          onClick={onChallenge}
          className="w-full flex items-center justify-center gap-2.5 bg-brand-orange text-white rounded-xl py-[15px] mb-3 font-display tracking-wider text-xl transition-all duration-200 active:scale-[0.98] hover:bg-[#FF7A1A] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10"/>
            <circle cx="12" cy="12" r="3"/>
            <line x1="12" y1="2" x2="12" y2="4.5"/>
            <line x1="12" y1="19.5" x2="12" y2="22"/>
            <line x1="2" y1="12" x2="4.5" y2="12"/>
            <line x1="19.5" y1="12" x2="22" y2="12"/>
          </svg>
          Challenge Someone
        </button>

        <InviteButton username={profile.username} className="mb-8" />

        {/* Active games */}
        {active.length > 0 && (
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-3">
              <h3 className="font-display text-[11px] tracking-[0.2em] text-[#444]">ACTIVE</h3>
              <span className="px-1.5 py-0.5 rounded bg-surface-alt border border-border font-display text-[10px] text-[#555] leading-none tabular-nums">
                {active.length}
              </span>
            </div>
            <div className="space-y-2">
              {active.map((g) => (
                <div
                  key={g.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => onOpenGame(g)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpenGame(g); } }}
                  className={`relative flex items-center justify-between p-4 rounded-2xl bg-surface cursor-pointer transition-all duration-200 overflow-hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange
                    ${isMyTurn(g)
                      ? "border border-[rgba(255,107,0,0.35)] shadow-[0_0_28px_rgba(255,107,0,0.07)]"
                      : "border border-border hover:border-[#3A3A3A]"
                    }`}
                >
                  {/* Left accent bar */}
                  {isMyTurn(g) && (
                    <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-brand-orange rounded-l-2xl" aria-hidden="true" />
                  )}
                  <div className="pl-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-display text-[19px] text-white leading-none">vs @{opponent(g)}</span>
                      {isMyTurn(g) && (
                        <span className="px-2 py-0.5 rounded bg-brand-orange font-display text-[10px] text-white tracking-wider leading-none shrink-0">
                          PLAY
                        </span>
                      )}
                    </div>
                    <span className={`font-body text-[11px] ${isMyTurn(g) ? "text-brand-orange" : "text-[#555]"}`}>
                      {isMyTurn(g) ? "Your turn" : "Waiting on opponent"}
                    </span>
                    {/* Letter scores */}
                    <div className="flex items-center gap-3 mt-2.5">
                      <div className="flex items-center gap-1">
                        <span className="font-body text-[10px] text-[#444] uppercase tracking-wider mr-0.5">You</span>
                        {LETTERS.map((l, i) => (
                          <span
                            key={i}
                            className={`font-display text-[13px] leading-none tracking-wide ${i < myLetters(g) ? "text-brand-red" : "text-[#2E2E2E]"}`}
                          >{l}</span>
                        ))}
                      </div>
                      <div className="w-px h-3 bg-border shrink-0" aria-hidden="true" />
                      <div className="flex items-center gap-1">
                        <span className="font-body text-[10px] text-[#444] uppercase tracking-wider mr-0.5">Them</span>
                        {LETTERS.map((l, i) => (
                          <span
                            key={i}
                            className={`font-display text-[13px] leading-none tracking-wide ${i < theirLetters(g) ? "text-brand-red" : "text-[#2E2E2E]"}`}
                          >{l}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                  {/* Chevron */}
                  <svg
                    className={`shrink-0 ml-3 ${isMyTurn(g) ? "text-brand-orange" : "text-[#2E2E2E]"}`}
                    width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
                  >
                    <polyline points="9 18 15 12 9 6"/>
                  </svg>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Completed games */}
        {done.length > 0 && (
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-3">
              <h3 className="font-display text-[11px] tracking-[0.2em] text-[#444]">COMPLETED</h3>
              <span className="px-1.5 py-0.5 rounded bg-surface-alt border border-border font-display text-[10px] text-[#555] leading-none tabular-nums">
                {done.length}
              </span>
            </div>
            <div className="space-y-2">
              {done.map((g) => (
                <div
                  key={g.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => onOpenGame(g)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpenGame(g); } }}
                  className="flex items-center justify-between p-4 rounded-2xl bg-surface border border-border cursor-pointer transition-all duration-200 hover:border-[#3A3A3A] opacity-60 hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
                >
                  <div>
                    <span className="font-display text-[19px] text-white leading-none block mb-1">vs @{opponent(g)}</span>
                    <span className={`font-body text-[11px] ${g.winner === profile.uid ? "text-brand-green" : "text-brand-red"}`}>
                      {g.winner === profile.uid ? "You won" : "You lost"}{g.status === "forfeit" ? " · forfeit" : ""}
                    </span>
                  </div>
                  <svg className="text-[#2E2E2E] shrink-0" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="9 18 15 12 9 6"/>
                  </svg>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Empty state */}
        {games.length === 0 && (
          <div className="flex flex-col items-center py-14 border border-dashed border-border rounded-2xl mb-6">
            <svg className="text-[#2E2E2E] mb-4" width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="7.5" cy="17.5" r="2.5"/>
              <circle cx="17.5" cy="17.5" r="2.5"/>
              <path d="M2 7h1.5l2.1 7.5h10.8l2.1-6H7.5"/>
            </svg>
            <p className="font-body text-sm text-[#555]">No games yet.</p>
            <p className="font-body text-xs text-[#333] mt-1">Challenge someone to get started.</p>
          </div>
        )}

        {/* Coming Soon */}
        <div className="p-5 rounded-2xl border border-border bg-surface">
          <h3 className="font-display text-[10px] tracking-[0.25em] text-[#3A3A3A] mb-4">COMING SOON</h3>
          <div>
            {["Spot Map & Discovery", "Trick Clips Feed", "Leaderboards", "Crew Challenges"].map((f, i) => (
              <div key={f} className="flex items-center justify-between py-2.5 border-b border-border last:border-0">
                <div className="flex items-center gap-3">
                  <span className="font-display text-[10px] text-[#2E2E2E] w-4 leading-none tabular-nums">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="font-body text-sm text-[#555]">{f}</span>
                </div>
                <svg className="text-[#2A2A2A]" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
              </div>
            ))}
          </div>
        </div>

        {/* Danger Zone */}
        <div className="mt-6 p-5 rounded-2xl border border-[rgba(255,61,0,0.2)] bg-surface">
          <h3 className="font-display text-sm tracking-[0.15em] text-[#555] mb-3">DANGER ZONE</h3>
          <Btn onClick={() => setShowDeleteModal(true)} variant="danger">
            Delete Account
          </Btn>
        </div>
      </div>

      {/* Delete Account Modal */}
      {showDeleteModal && (
        <div
          className="fixed inset-0 bg-black/80 flex items-center justify-center p-6 z-50"
          onClick={() => { if (!deleting) setShowDeleteModal(false); }}
        >
          <div
            className="bg-surface border border-border rounded-2xl p-6 max-w-sm w-full animate-fade-in"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-display text-xl text-white mb-2">Delete Account?</h3>
            <p className="font-body text-sm text-[#888] mb-4">
              This permanently deletes your profile and sign-in credentials.
              Your game history is retained for your opponents.
              <strong className="text-brand-red"> This cannot be undone.</strong>
            </p>
            {deleteError && <ErrorBanner message={deleteError} onDismiss={() => setDeleteError("")} />}
            <div className="flex gap-3">
              <Btn onClick={() => { setDeleteError(""); setShowDeleteModal(false); }} variant="secondary" disabled={deleting}>
                Cancel
              </Btn>
              <Btn
                onClick={async () => {
                  setDeleting(true);
                  setDeleteError("");
                  try {
                    await onDeleteAccount();
                  } catch (err: unknown) {
                    setDeleteError(
                      err instanceof Error ? err.message : "Deletion failed — try again"
                    );
                    setDeleting(false);
                  }
                }}
                variant="danger"
                disabled={deleting}
              >
                {deleting ? "Deleting..." : "Delete Forever"}
              </Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════
 *  SCREEN: CHALLENGE
 * ═══════════════════════════════════════════ */

function ChallengeScreen({
  profile, onSend, onBack,
}: {
  profile: UserProfile; onSend: (opponentUid: string, opponentUsername: string) => Promise<void>; onBack: () => void;
}) {
  const [opponent, setOpponent] = useState("");
  const [opponentFieldError] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setError("");
    const normalized = opponent.toLowerCase().trim();
    if (normalized.length < 3) { setError("Enter a valid username"); return; }
    if (normalized === profile.username) { setError("You can't challenge yourself"); return; }

    setLoading(true);
    try {
      const uid = await getUidByUsername(normalized);
      if (!uid) { setError(`@${normalized} doesn't exist yet. They need to sign up first.`); return; }
      // Awaiting onSend keeps loading=true for the full createGame round-trip,
      // preventing a second challenge from being sent while the first is in-flight,
      // and surfaces any createGame errors back to this screen.
      await onSend(uid, normalized);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not start game");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-dvh bg-[#0A0A0A] px-6 pt-6">
      <div className="max-w-md mx-auto">
        <button type="button" onClick={onBack} className="font-body text-sm text-[#888] mb-6 flex items-center gap-1.5">
          ← Back
        </button>

        <h1 className="font-display text-[42px] text-white mb-2">Challenge</h1>
        <p className="font-body text-sm text-[#888] mb-8">Call someone out. First to S.K.A.T.E. loses.</p>

        <form onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
          <Field
            label="Opponent Username"
            value={opponent}
            onChange={(v) => { if (!loading) setOpponent(v.replace(/[^a-zA-Z0-9_]/g, "")); }}
            placeholder="their_handle"
            icon="@"
            maxLength={20}
            autoFocus
            fieldError={opponentFieldError}
          />

          <InviteButton username={profile.username} className="mb-6" />

          <div className="p-4 rounded-xl bg-surface-alt border border-border mb-6">
            <h4 className="font-display text-xs tracking-[0.12em] text-[#555] mb-3">RULES</h4>
            <div className="font-body text-sm text-[#888] leading-7">
              <div>🎯 You set the first trick</div>
              <div>📹 One-take video only — no retries</div>
              <div>⏱ 24 hours per turn or forfeit</div>
              <div>❌ Miss a match = earn a letter</div>
              <div>💀 Spell S.K.A.T.E. = you lose</div>
            </div>
          </div>

          <ErrorBanner message={error} onDismiss={() => setError("")} />

          <Btn onClick={submit} disabled={loading || opponent.length < 3 || !!opponentFieldError}>
            {loading ? "Finding..." : "🔥 Send Challenge"}
          </Btn>
        </form>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
 *  SCREEN: GAMEPLAY (Set / Match)
 * ═══════════════════════════════════════════ */

function GamePlayScreen({
  game, profile, onBack,
}: {
  game: GameDoc; profile: UserProfile; onBack: () => void;
}) {
  const [videoBlob, setVideoBlob] = useState<Blob | null>(null);
  const [videoRecorded, setVideoRecorded] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  // Check for an expired turn whenever the game or its deadline changes.
  // No one-time guard: if the deadline is updated via a real-time listener
  // (e.g. opponent's turn begins), we re-evaluate immediately.
  // forfeitExpiredTurn is idempotent — calling it on an already-forfeited game
  // is a no-op (the transaction checks game.status === 'active' first).
  useEffect(() => {
    if (game.status !== "active") return;
    const deadline = game.turnDeadline?.toMillis?.() ?? 0;
    if (deadline > 0 && Date.now() >= deadline) {
      forfeitExpiredTurn(game.id).catch((err) => {
        console.warn("Forfeit check failed:", err instanceof Error ? err.message : err);
      });
    }
  }, [game.id, game.status, game.turnDeadline]);

  const isSetter = game.phase === "setting" && game.currentSetter === profile.uid;
  const isMatcher = game.phase === "matching" && game.currentTurn === profile.uid;
  const opponentName =
    game.player1Uid === profile.uid ? game.player2Username : game.player1Username;

  // Auto-submit setter trick when recording finishes (guarded against double-call)
  const submittedRef = useRef(false);
  const submitSetterTrick = useCallback(async (blob: Blob | null) => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    setSubmitting(true);
    setError("");
    try {
      let videoUrl: string | null = null;
      if (blob) {
        videoUrl = await uploadVideo(game.id, game.turnNumber, "set", blob);
      }
      await setTrick(game.id, "Trick", videoUrl);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to send trick");
      submittedRef.current = false; // allow retry on error
    } finally {
      setSubmitting(false);
    }
  }, [game.id, game.turnNumber]);

  const handleSetterRecorded = useCallback((blob: Blob | null) => {
    setVideoBlob(blob);
    setVideoRecorded(true);
    submitSetterTrick(blob);
  }, [submitSetterTrick]);

  const handleRecorded = useCallback((blob: Blob | null) => {
    setVideoBlob(blob);
    setVideoRecorded(true);
  }, []);

  // Matcher submits result (guarded against double-call)
  const matchSubmittedRef = useRef(false);
  const submitResult = async (landed: boolean) => {
    if (matchSubmittedRef.current) return;
    matchSubmittedRef.current = true;
    setSubmitting(true);
    setError("");
    try {
      let videoUrl: string | null = null;
      if (videoBlob) {
        videoUrl = await uploadVideo(game.id, game.turnNumber, "match", videoBlob);
      }
      await submitMatchResult(game.id, landed, videoUrl);
      // Game will update via realtime listener
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to submit result");
      matchSubmittedRef.current = false; // allow retry on error
    } finally {
      setSubmitting(false);
    }
  };

  const myLetters = game.player1Uid === profile.uid ? game.p1Letters : game.p2Letters;
  const theirLetters = game.player1Uid === profile.uid ? game.p2Letters : game.p1Letters;
  const deadline = game.turnDeadline?.toMillis?.() || Date.now() + 86400000;

  // Not your turn
  if (!isSetter && !isMatcher) {
    return (
      <div className="min-h-dvh bg-[#0A0A0A] flex flex-col items-center justify-center px-6">
        <div className="text-center max-w-sm animate-fade-in">
          <span className="text-5xl block mb-4">⏳</span>
          <h2 className="font-display text-3xl text-white mb-2">Waiting on @{opponentName}</h2>
          <p className="font-body text-sm text-[#888] mb-2">
            {game.phase === "setting"
              ? "They're setting a trick for you to match."
              : "They're attempting to match your trick."}
          </p>
          <Timer deadline={deadline} />
          <div className="mt-8">
            <Btn onClick={onBack} variant="ghost">← Back to Games</Btn>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-[#0A0A0A] pb-10">
      {/* Header */}
      <div className="px-5 py-4 border-b border-border flex justify-between items-center">
        <button type="button" onClick={onBack} className="font-body text-sm text-[#888]">← Games</button>
        <Timer deadline={deadline} />
      </div>

      <div className="px-5 pt-5 max-w-md mx-auto">
        {/* Score */}
        <div className="flex justify-center gap-5 mb-6">
          <LetterDisplay count={myLetters} name={`@${profile.username}`} active={isSetter} />
          <div className="flex items-center font-display text-2xl text-[#555]">VS</div>
          <LetterDisplay count={theirLetters} name={`@${opponentName}`} active={isMatcher} />
        </div>

        {/* Phase Banner */}
        <div
          className={`text-center py-3 px-5 mb-5 rounded-xl border
            ${isSetter ? "bg-[rgba(255,107,0,0.06)] border-brand-orange" : "bg-[rgba(0,230,118,0.06)] border-brand-green"}`}
        >
          <span className={`font-display text-xl tracking-wider ${isSetter ? "text-brand-orange" : "text-brand-green"}`}>
            {isSetter ? "Record your trick" : `Match @${game.player1Uid === game.currentSetter ? game.player1Username : game.player2Username}'s ${game.currentTrickName || "trick"}`}
          </span>
        </div>

        {/* Setter's video to watch (matcher) */}
        {isMatcher && game.currentTrickVideoUrl && isFirebaseStorageUrl(game.currentTrickVideoUrl) && (
          <div className="mb-5">
            <p className="font-display text-sm tracking-wider text-[#888] mb-2">THEIR ATTEMPT</p>
            <video
              src={game.currentTrickVideoUrl}
              controls
              className="w-full max-w-[360px] mx-auto aspect-[9/16] rounded-2xl bg-black object-cover border border-border"
            />
          </div>
        )}

        {/* Video Recorder */}
        <VideoRecorder
          onRecorded={isSetter ? handleSetterRecorded : handleRecorded}
          label={isSetter ? "Land Your Trick" : `Match the ${game.currentTrickName || "Trick"}`}
          autoOpen={isSetter}
          doneLabel={isSetter ? "Recorded — Sending..." : "Recorded"}
        />

        <ErrorBanner message={error} onDismiss={() => setError("")} />

        {/* Setter auto-submit status */}
        {isSetter && submitting && (
          <div className="mt-5 text-center">
            <span className="font-display text-lg text-brand-orange tracking-wider animate-pulse">Sending to @{opponentName}...</span>
          </div>
        )}
        {isSetter && !submitting && error && videoRecorded && (
          <div className="mt-5">
            <Btn onClick={() => submitSetterTrick(videoBlob)} variant="secondary">
              Retry Send
            </Btn>
          </div>
        )}

        {/* Matcher Judge */}
        {isMatcher && videoRecorded && (
          <div className="mt-5">
            <p className="font-display text-xl text-white text-center mb-4">Did you land it?</p>
            <div className="flex gap-3">
              <Btn onClick={() => submitResult(true)} variant="success" disabled={submitting}>
                {submitting ? "..." : "✓ Landed"}
              </Btn>
              <Btn onClick={() => submitResult(false)} variant="danger" disabled={submitting}>
                {submitting ? "..." : "✗ Missed"}
              </Btn>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
 *  SCREEN: GAME OVER
 * ═══════════════════════════════════════════ */

function GameOverScreen({
  game, profile, onRematch, onBack,
}: {
  game: GameDoc; profile: UserProfile; onRematch: () => Promise<void>; onBack: () => void;
}) {
  const [rematching, setRematching] = useState(false);
  const rematchingRef = useRef(false);

  const handleRematch = async () => {
    if (rematchingRef.current) return;
    rematchingRef.current = true;
    setRematching(true);
    try {
      await onRematch();
    } finally {
      rematchingRef.current = false;
      setRematching(false);
    }
  };

  const isWinner = game.winner === profile.uid;
  const isForfeit = game.status === "forfeit";
  const opponentName =
    game.player1Uid === profile.uid ? game.player2Username : game.player1Username;
  const myLetters = game.player1Uid === profile.uid ? game.p1Letters : game.p2Letters;
  const theirLetters = game.player1Uid === profile.uid ? game.p2Letters : game.p1Letters;

  return (
    <div
      className="min-h-dvh flex flex-col items-center justify-center px-6"
      style={{
        background: isWinner
          ? `radial-gradient(ellipse at 50% 30%, rgba(0,230,118,0.05) 0%, transparent 60%), ${BG}`
          : `radial-gradient(ellipse at 50% 30%, rgba(255,61,0,0.05) 0%, transparent 60%), ${BG}`,
      }}
    >
      <div className="text-center max-w-sm animate-fade-in">
        <span className="text-6xl block mb-4">{isWinner ? "🏆" : "💀"}</span>
        <h1 className={`font-display text-5xl mb-2 ${isWinner ? "text-brand-green" : "text-brand-red"}`}>
          {isWinner ? "You Win" : isForfeit ? "Forfeit" : "S.K.A.T.E."}
        </h1>
        <p className="font-body text-base text-[#888] mb-8">
          {isForfeit
            ? isWinner
              ? `@${opponentName} ran out of time.`
              : "You ran out of time."
            : isWinner
              ? `@${opponentName} spelled S.K.A.T.E.`
              : `@${opponentName} outlasted you.`}
        </p>

        <div className="flex justify-center gap-5 mb-10">
          <LetterDisplay count={myLetters} name={`@${profile.username}`} active={isWinner} />
          <LetterDisplay count={theirLetters} name={`@${opponentName}`} active={!isWinner} />
        </div>

        <div className="flex flex-col gap-3 w-full">
          <Btn onClick={handleRematch} disabled={rematching}>
            {rematching ? "Starting..." : "🔥 Rematch"}
          </Btn>
          <InviteButton username={profile.username} />
          <Btn onClick={onBack} variant="ghost">Back to Lobby</Btn>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
 *  APP ROOT — State Machine
 * ═══════════════════════════════════════════ */

type Screen = "landing" | "auth" | "profile" | "lobby" | "challenge" | "game" | "gameover" | "privacy" | "terms";

export default function App() {
  return (
    <ErrorBoundary>
      <AppInner />
    </ErrorBoundary>
  );
}

function AppInner() {
  const { loading, user, profile, refreshProfile } = useAuth();
  const [screen, setScreen] = useState<Screen>("landing");
  const [authMode, setAuthMode] = useState<"signup" | "signin">("signup");
  const [games, setGames] = useState<GameDoc[]>([]);
  const [activeGame, setActiveGame] = useState<GameDoc | null>(null);
  const [activeProfile, setActiveProfile] = useState<UserProfile | null>(null);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [googleError, setGoogleError] = useState("");

  // Analytics consent — null = not yet decided (show banner), true = accepted, false = declined
  const [analyticsConsent, setAnalyticsConsent] = useState<boolean | null>(() => {
    try {
      const stored = localStorage.getItem(CONSENT_KEY);
      return stored === null ? null : stored === "true";
    } catch {
      return null;
    }
  });

  const handleAcceptConsent = useCallback(() => {
    localStorage.setItem(CONSENT_KEY, "true");
    setAnalyticsConsent(true);
  }, []);

  const handleDeclineConsent = useCallback(() => {
    localStorage.setItem(CONSENT_KEY, "false");
    setAnalyticsConsent(false);
  }, []);

  // Resolve any pending Google redirect sign-in on first load
  useEffect(() => {
    resolveGoogleRedirect().catch(() => {});
  }, []);

  const handleGoogleSignIn = useCallback(async () => {
    setGoogleError("");
    setGoogleLoading(true);
    try {
      await signInWithGoogle();
      // onAuthStateChanged → useAuth → routing handles navigation
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code ?? "";
      if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
        // User dismissed — not an error
      } else if (code === "auth/account-exists-with-different-credential") {
        setGoogleError("This email is linked to a password account. Sign in with email/password instead.");
        if (screen !== "auth") { setAuthMode("signin"); setScreen("auth"); }
      } else {
        setGoogleError(err instanceof Error ? err.message : "Google sign-in failed");
        if (screen !== "auth") { setAuthMode("signin"); setScreen("auth"); }
      }
    } finally {
      setGoogleLoading(false);
    }
  }, [screen]);

  const handleDeleteAccount = useCallback(async () => {
    if (!activeProfile) return;
    try {
      // 1. Delete Firestore data first (atomically) while the token is still valid.
      await deleteUserData(activeProfile.uid, activeProfile.username);
    } catch (err) {
      // Firestore delete failed — Auth account is untouched, nothing is orphaned.
      Sentry.captureException(err, { extra: { stage: "deleteUserData", uid: activeProfile.uid } });
      throw err;
    }
    try {
      // 2. Delete the Firebase Auth account.
      await deleteAccount();
    } catch (err) {
      // Auth delete failed after Firestore data was already removed.
      // The user's profile is gone but the Auth account lingers.
      // Translate auth/requires-recent-login into a clear user message.
      const code = (err as { code?: string })?.code ?? "";
      Sentry.captureException(err, { extra: { stage: "deleteAccount", uid: activeProfile.uid } });
      if (code === "auth/requires-recent-login") {
        throw new Error("For security, please sign out and sign back in before deleting your account.", { cause: err });
      }
      throw err;
    }
    // Local state cleanup — onAuthStateChanged will fire and route to landing.
    setActiveProfile(null);
    setGames([]);
    setActiveGame(null);
    setScreen("landing");
  }, [activeProfile]);

  // Sync profile from useAuth hook into local state
  useEffect(() => {
    if (profile) setActiveProfile(profile);
  }, [profile]);

  // Route based on auth state
  useEffect(() => {
    if (loading) return;
    if (!user) {
      setScreen("landing");
      return;
    }
    if (!activeProfile) {
      setScreen("profile");
      return;
    }
    setScreen((prev) =>
      prev === "landing" || prev === "auth" || prev === "profile" ? "lobby" : prev
    );
  }, [loading, user, activeProfile]);

  // Subscribe to games when in lobby
  useEffect(() => {
    if (!user || !activeProfile) return;
    const unsub = subscribeToMyGames(user.uid, setGames);
    return unsub;
  }, [user, activeProfile]);

  // Real-time game subscription
  const screenRef = useRef(screen);
  screenRef.current = screen;

  useEffect(() => {
    if (!activeGame) return;
    const unsub = subscribeToGame(activeGame.id, (updated) => {
      if (!updated) return;
      setActiveGame(updated);
      // If game just finished, go to game over
      if ((updated.status === "complete" || updated.status === "forfeit") && screenRef.current === "game") {
        setScreen("gameover");
      }
    });
    return unsub;
  }, [activeGame?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!firebaseReady) {
    return (
      <div
        className="min-h-dvh flex flex-col items-center justify-center px-6 text-center"
        style={{ background: BG }}
      >
        <span className="font-display text-lg tracking-[0.35em] text-brand-orange mb-2">
          SKATEHUBBA™
        </span>
        <h2 className="font-display text-3xl text-white mt-4">Setup Required</h2>
        <p className="font-body text-base text-[#888] max-w-sm mt-4 leading-relaxed">
          Firebase environment variables are missing. Add{" "}
          <code className="text-brand-orange">VITE_FIREBASE_*</code> variables in
          your Vercel Dashboard under Project Settings → Environment Variables.
        </p>
      </div>
    );
  }

  if (loading) return <Spinner />;

  return (
    <>
      {screen === "landing" && (
        <Landing
          onGo={(m) => { setAuthMode(m); setScreen("auth"); }}
          onGoogle={handleGoogleSignIn}
          googleLoading={googleLoading}
          onPrivacy={() => setScreen("privacy")}
          onTerms={() => setScreen("terms")}
        />
      )}

      {screen === "auth" && (
        <AuthScreen
          key={authMode}
          mode={authMode}
          onDone={() => {
            // Auth state change will trigger the useEffect above
          }}
          onToggle={() => { setGoogleError(""); setAuthMode((m) => (m === "signup" ? "signin" : "signup")); }}
          onGoogle={handleGoogleSignIn}
          googleLoading={googleLoading}
          googleError={googleError}
        />
      )}

      {screen === "profile" && user && (
        <ProfileSetup
          uid={user.uid}
          email={user.email || ""}
          emailVerified={user.emailVerified}
          displayName={user.displayName}
          onDone={async (p) => {
            setActiveProfile(p);
            setScreen("lobby");
            // Sync the useAuth hook so profile is available on refresh
            await refreshProfile();
          }}
        />
      )}

      {screen === "lobby" && activeProfile && (
        <Lobby
          profile={activeProfile}
          games={games}
          user={user}
          onChallenge={() => setScreen("challenge")}
          onOpenGame={(g) => {
            setActiveGame(g);
            if (g.status === "complete" || g.status === "forfeit") setScreen("gameover");
            else setScreen("game");
          }}
          onSignOut={async () => {
            await signOut();
            setActiveProfile(null);
            setGames([]);
            setActiveGame(null);
            setAuthMode("signup");
            setScreen("landing");
          }}
          onDeleteAccount={handleDeleteAccount}
        />
      )}

      {screen === "challenge" && activeProfile && user && (
        <ChallengeScreen
          profile={activeProfile}
          onSend={async (opponentUid, opponentUsername) => {
            const gameId = await createGame(
              user.uid,
              activeProfile.username,
              opponentUid,
              opponentUsername
            );
            setActiveGame(newGameShell(gameId, user.uid, activeProfile.username, opponentUid, opponentUsername));
            setScreen("game");
          }}
          onBack={() => setScreen("lobby")}
        />
      )}

      {screen === "game" && activeGame && activeProfile && (
        <GamePlayScreen
          game={activeGame}
          profile={activeProfile}
          onBack={() => { setActiveGame(null); setScreen("lobby"); }}
        />
      )}

      {screen === "gameover" && activeGame && activeProfile && user && (
        <GameOverScreen
          game={activeGame}
          profile={activeProfile}
          onRematch={async (): Promise<void> => {
            const opponentUid =
              activeGame.player1Uid === user.uid ? activeGame.player2Uid : activeGame.player1Uid;
            const opponentName =
              activeGame.player1Uid === user.uid ? activeGame.player2Username : activeGame.player1Username;
            const gameId = await createGame(user.uid, activeProfile.username, opponentUid, opponentName);
            setActiveGame(newGameShell(gameId, user.uid, activeProfile.username, opponentUid, opponentName));
            setScreen("game");
          }}
          onBack={() => { setActiveGame(null); setScreen("lobby"); }}
        />
      )}
      {screen === "privacy" && (
        <PrivacyPolicyScreen onBack={() => setScreen(user && activeProfile ? "lobby" : user ? "profile" : "landing")} />
      )}

      {screen === "terms" && (
        <TermsOfServiceScreen onBack={() => setScreen(user && activeProfile ? "lobby" : user ? "profile" : "landing")} />
      )}

      {/* Vercel Analytics — only initialised after user consent */}
      {analyticsConsent === true && <Analytics />}

      {/* Cookie consent banner — shown until user decides */}
      {analyticsConsent === null && (
        <CookieConsent
          onAccept={handleAcceptConsent}
          onDecline={handleDeclineConsent}
          onPrivacy={() => setScreen("privacy")}
        />
      )}
    </>
  );
}
