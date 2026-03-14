import { useState, useEffect, useRef, useCallback, Component, type ReactNode } from "react";
import { Analytics } from "@vercel/analytics/react";
import { useAuth } from "./hooks/useAuth";
import { signUp, signIn, signOut, resetPassword, resendVerification } from "./services/auth";
import {
  createProfile,
  isUsernameAvailable,
  getUidByUsername,
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

const LETTERS = ["S", "K", "A", "T", "E"];

/** Build a placeholder GameDoc for optimistic UI before the real-time listener syncs. */
function newGameShell(
  gameId: string,
  myUid: string,
  myUsername: string,
  opponentUid: string,
  opponentUsername: string,
): GameDoc {
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
    turnDeadline: { toMillis: () => Date.now() + 86400000 } as unknown as GameDoc["turnDeadline"],
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
  children, onClick, variant = "primary", disabled, className = "",
}: {
  children: ReactNode; onClick?: () => void; variant?: string; disabled?: boolean; className?: string;
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
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`${base} ${variants[variant ?? "primary"]} ${className}`}
    >
      {children}
    </button>
  );
}

let fieldIdCounter = 0;

function Field({
  label, value, onChange, placeholder, type = "text", maxLength, note, icon, autoComplete, autoFocus,
}: {
  label?: string; value: string; onChange: (v: string) => void;
  placeholder?: string; type?: string; maxLength?: number; note?: string; icon?: string;
  autoComplete?: string; autoFocus?: boolean;
}) {
  const [id] = useState(() => `field-${++fieldIdCounter}`);
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
          className={`w-full bg-surface-alt border border-border rounded-xl text-white text-base font-body outline-none
            focus:border-brand-orange transition-colors duration-200
            ${icon ? "pl-10 pr-4 py-3.5" : "px-4 py-3.5"}`}
        />
      </div>
      {note && <span className="text-xs text-[#777] mt-1 block">{note}</span>}
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
    let id: number;
    const tick = () => {
      const diff = deadline - Date.now();
      if (diff <= 0) {
        setText("TIME'S UP");
        clearInterval(id);
        return;
      }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setText(`${h}h ${m}m ${s}s`);
    };
    tick();
    id = window.setInterval(tick, 1000);
    return () => clearInterval(id);
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

      const phones = contacts.flatMap((c) => c.tel || []).filter(Boolean);
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
    { name: "WhatsApp", icon: "💬", href: `https://wa.me/?text=${encodedText}` },
    { name: "Snapchat", icon: "👻", href: `https://www.snapchat.com/scan?attachmentUrl=${encodedUrl}` },
    { name: "Facebook", icon: "f", href: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}` },
    { name: "Reddit", icon: "🤙", href: `https://www.reddit.com/submit?url=${encodedUrl}&title=${encodeURIComponent(text)}` },
    { name: "Telegram", icon: "✈", href: `https://t.me/share/url?url=${encodedUrl}&text=${encodeURIComponent(text)}` },
  ];

  const tileBase =
    "rounded-xl bg-surface-alt border border-border hover:border-brand-orange active:scale-95 transition-all duration-150";

  return (
    <div className={className}>
      <Btn onClick={() => setShowPanel(!showPanel)} variant="ghost" className="w-full">
        {showPanel ? "Close" : "📲 Invite a Friend"}
      </Btn>

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
              <span className="text-2xl leading-none">📱</span>
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
                  className={`flex flex-col items-center gap-1.5 py-3 ${tileBase}`}
                >
                  <span className="text-xl leading-none">{s.icon}</span>
                  <span className="font-body text-[10px] text-[#777] leading-none">{s.name}</span>
                </a>
              ))}
            </div>
          </div>

          {/* ── Copy & Share ── */}
          <div className="flex gap-2">
            <button type="button" onClick={handleCopy} className={`flex-1 py-2.5 font-body text-xs ${tileBase} ${
              copied ? "border-brand-green text-brand-green" : "text-[#888]"
            }`}>
              {copied ? "Copied!" : "📋 Copy Link"}
            </button>
            {typeof navigator.share === "function" && (
              <button
                type="button"
                onClick={handleNativeShare}
                className={`flex-1 py-2.5 font-body text-xs text-[#888] ${tileBase}`}
              >
                🔗 More Options
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
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-open camera on mount when autoOpen is true
  useEffect(() => {
    if (autoOpen && state === "idle") openCamera();
  }, [autoOpen]); // eslint-disable-line react-hooks/exhaustive-deps

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

function Landing({ onGo }: { onGo: (mode: "signup" | "signin") => void }) {
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
        <Btn onClick={() => onGo("signup")}>Get Started</Btn>
        <Btn onClick={() => onGo("signin")} variant="ghost">I Have an Account</Btn>
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
    </div>
  );
}

/* ═══════════════════════════════════════════
 *  SCREEN: AUTH
 * ═══════════════════════════════════════════ */

function AuthScreen({
  mode, onDone, onToggle,
}: {
  mode: "signup" | "signin"; onDone: () => void; onToggle: () => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const isSignup = mode === "signup";

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
      if (code === "auth/email-already-in-use") setError("Email already in use");
      else if (code === "auth/invalid-credential" || code === "auth/wrong-password")
        setError("Invalid email or password");
      else if (code === "auth/user-not-found") setError("No account with that email");
      else if (code === "auth/weak-password") setError("Password too weak (6+ chars)");
      else setError(err instanceof Error ? err.message : "Something went wrong");
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

        <form onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
          <Field label="Email" value={email} onChange={setEmail} placeholder="you@email.com" icon="@" type="email" autoComplete="email" autoFocus />
          <Field label="Password" value={password} onChange={setPassword} placeholder="••••••••" icon="🔒" type="password" autoComplete={isSignup ? "new-password" : "current-password"} />
          {isSignup && (
            <Field label="Confirm" value={confirm} onChange={setConfirm} placeholder="••••••••" icon="🔒" type="password" autoComplete="new-password" />
          )}

          <ErrorBanner message={error} onDismiss={() => setError("")} />

          {resetSent && (
            <div className="w-full p-3 rounded-xl bg-[rgba(0,230,118,0.08)] border border-brand-green mb-4">
              <span className="font-body text-sm text-brand-green">Reset email sent (if account exists)</span>
            </div>
          )}

          <Btn onClick={submit} disabled={loading}>
            {loading ? "..." : isSignup ? "Create Account" : "Sign In"}
          </Btn>
        </form>

        {!isSignup && (
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
  uid, email, onDone,
}: {
  uid: string; email: string; onDone: (p: UserProfile) => void;
}) {
  const [username, setUsername] = useState("");
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
    if (available === false) { setError("Username is taken"); return; }
    if (available === null) { setError("Still checking username — wait a moment"); return; }

    setLoading(true);
    try {
      const profile = await createProfile(uid, email, normalized, stance);
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
            onChange={(v) => setUsername(v.replace(/[^a-zA-Z0-9_]/g, ""))}
            placeholder="sk8legend"
            maxLength={20}
            icon="@"
            autoComplete="username"
            autoFocus
            note={
              username.length >= 3
                ? available === null
                  ? "Checking..."
                  : available
                    ? `@${username.toLowerCase()} is available ✓`
                    : `@${username.toLowerCase()} is taken ✗`
                : "Min 3 characters, letters/numbers/underscore"
            }
          />

          <div className="mb-6">
            <label className="block font-display text-sm tracking-[0.12em] text-[#888] mb-2">Stance</label>
            <div className="flex gap-3">
              {["Regular", "Goofy"].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStance(s)}
                  className={`flex-1 py-3 rounded-xl font-display text-lg tracking-wider cursor-pointer transition-all
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

function VerifyEmailBanner({ emailVerified }: { emailVerified: boolean }) {
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [resendError, setResendError] = useState(false);

  if (emailVerified) return null;

  const handleResend = async () => {
    setSending(true);
    setResendError(false);
    try {
      await resendVerification();
      setSent(true);
    } catch {
      setResendError(true);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="mx-5 mt-4 p-3.5 rounded-xl bg-[rgba(255,107,0,0.06)] border border-brand-orange flex items-center justify-between gap-3">
      <div>
        <span className="font-display text-xs tracking-wider text-brand-orange block">VERIFY YOUR EMAIL</span>
        <span className="font-body text-xs text-[#888]">Check your inbox for the verification link.</span>
      </div>
      <button
        type="button"
        onClick={handleResend}
        disabled={sending || sent}
        className="font-display text-[11px] tracking-wider text-brand-orange border border-brand-orange rounded-lg px-3 py-1.5 whitespace-nowrap disabled:opacity-40"
      >
        {sent ? "Sent!" : resendError ? "Retry" : sending ? "..." : "Resend"}
      </button>
    </div>
  );
}

function Lobby({
  profile, games, onChallenge, onOpenGame, onSignOut, user,
}: {
  profile: UserProfile; games: GameDoc[];
  onChallenge: () => void; onOpenGame: (g: GameDoc) => void; onSignOut: () => void;
  user: { emailVerified?: boolean } | null;
}) {
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
        <div>
          <span className="font-display text-sm tracking-[0.25em] text-brand-orange">SKATEHUBBA™</span>
          <div className="font-body text-xs text-[#555] mt-0.5">@{profile.username}</div>
        </div>
        <button type="button" onClick={onSignOut} className="font-body text-xs text-[#555] hover:text-[#888] transition-colors">
          Sign Out
        </button>
      </div>

      <VerifyEmailBanner emailVerified={user?.emailVerified ?? false} />

      <div className="px-5 pt-6 max-w-lg mx-auto">
        <h1 className="font-display text-[42px] text-white mb-6">Your Games</h1>

        <Btn onClick={onChallenge} className="mb-3">🎯 Challenge Someone</Btn>
        <InviteButton username={profile.username} className="mb-8" />

        {/* Active */}
        {active.length > 0 && (
          <>
            <h3 className="font-display text-sm tracking-[0.15em] text-[#888] mb-3">ACTIVE</h3>
            {active.map((g) => (
              <div
                key={g.id}
                role="button"
                tabIndex={0}
                onClick={() => onOpenGame(g)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpenGame(g); } }}
                className={`p-4 rounded-2xl mb-3 bg-surface border cursor-pointer transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange
                  ${isMyTurn(g) ? "border-brand-orange shadow-[0_0_20px_rgba(255,107,0,0.08)]" : "border-border"}`}
              >
                <div className="flex justify-between items-center mb-2.5">
                  <div>
                    <span className="font-display text-xl text-white">vs @{opponent(g)}</span>
                    <span className={`block font-body text-xs mt-0.5 ${isMyTurn(g) ? "text-brand-orange" : "text-[#555]"}`}>
                      {isMyTurn(g) ? "Your turn" : "Waiting on opponent"}
                    </span>
                  </div>
                  {isMyTurn(g) && (
                    <div className="px-3 py-1 rounded-md bg-brand-orange">
                      <span className="font-display text-xs text-white tracking-wider">PLAY</span>
                    </div>
                  )}
                </div>
                <div className="flex gap-4">
                  <div className="flex items-center gap-1">
                    <span className="font-body text-[11px] text-[#555] mr-1">You:</span>
                    {LETTERS.map((l, i) => (
                      <span key={i} className={`font-display text-sm ${i < myLetters(g) ? "text-brand-red" : "text-[#555]"}`}>{l}</span>
                    ))}
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="font-body text-[11px] text-[#555] mr-1">Them:</span>
                    {LETTERS.map((l, i) => (
                      <span key={i} className={`font-display text-sm ${i < theirLetters(g) ? "text-brand-red" : "text-[#555]"}`}>{l}</span>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </>
        )}

        {/* Completed */}
        {done.length > 0 && (
          <>
            <h3 className="font-display text-sm tracking-[0.15em] text-[#888] mt-6 mb-3">COMPLETED</h3>
            {done.map((g) => (
              <div
                key={g.id}
                role="button"
                tabIndex={0}
                onClick={() => onOpenGame(g)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpenGame(g); } }}
                className="p-4 rounded-2xl mb-3 bg-surface border border-border cursor-pointer transition-all opacity-70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
              >
                <span className="font-display text-xl text-white">vs @{opponent(g)}</span>
                <span className={`block font-body text-xs mt-0.5 ${g.winner === profile.uid ? "text-brand-green" : "text-brand-red"}`}>
                  {g.winner === profile.uid ? "You won!" : "You lost"}
                  {g.status === "forfeit" && " (forfeit)"}
                </span>
              </div>
            ))}
          </>
        )}

        {games.length === 0 && (
          <div className="text-center py-12 border border-dashed border-border rounded-2xl">
            <span className="text-4xl block mb-3">🛹</span>
            <p className="font-body text-sm text-[#888]">No games yet. Challenge someone to start.</p>
          </div>
        )}

        {/* Roadmap */}
        <div className="mt-10 p-5 rounded-2xl border border-border bg-surface">
          <h3 className="font-display text-sm tracking-[0.15em] text-[#555] mb-3">COMING SOON</h3>
          {["Spot Map & Discovery", "Trick Clips Feed", "Leaderboards", "Crew Challenges"].map((f) => (
            <div key={f} className="flex items-center gap-2.5 py-2 border-b border-border last:border-0">
              <div className="w-1.5 h-1.5 rounded-full bg-[#555]" />
              <span className="font-body text-sm text-[#555]">{f}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
 *  SCREEN: CHALLENGE
 * ═══════════════════════════════════════════ */

function ChallengeScreen({
  profile, onSend, onBack,
}: {
  profile: UserProfile; onSend: (opponentUid: string, opponentUsername: string) => void; onBack: () => void;
}) {
  const [opponent, setOpponent] = useState("");
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
      onSend(uid, normalized);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not find user");
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
            onChange={(v) => setOpponent(v.replace(/[^a-zA-Z0-9_]/g, ""))}
            placeholder="their_handle"
            icon="@"
            maxLength={20}
            autoFocus
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

          <Btn onClick={submit} disabled={loading || opponent.length < 3}>
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
  const [forfeitChecked, setForfeitChecked] = useState(false);

  // Check for expired turn on mount
  useEffect(() => {
    if (forfeitChecked || game.status !== "active") return;
    const deadline = game.turnDeadline?.toMillis?.() ?? 0;
    if (deadline > 0 && Date.now() >= deadline) {
      forfeitExpiredTurn(game.id).catch((err) => {
        console.warn("Forfeit check failed:", err instanceof Error ? err.message : err);
      });
    }
    setForfeitChecked(true);
  }, [game.id, game.status, forfeitChecked, game.turnDeadline]);

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
        {isMatcher && game.currentTrickVideoUrl && (
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
  game: GameDoc; profile: UserProfile; onRematch: () => void; onBack: () => void;
}) {
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
          <Btn onClick={onRematch}>🔥 Rematch</Btn>
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

type Screen = "landing" | "auth" | "profile" | "lobby" | "challenge" | "game" | "gameover";

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
  }, [activeGame?.id]);

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
        <Landing onGo={(m) => { setAuthMode(m); setScreen("auth"); }} />
      )}

      {screen === "auth" && (
        <AuthScreen
          mode={authMode}
          onDone={() => {
            // Auth state change will trigger the useEffect above
          }}
          onToggle={() => setAuthMode((m) => (m === "signup" ? "signin" : "signup"))}
        />
      )}

      {screen === "profile" && user && (
        <ProfileSetup
          uid={user.uid}
          email={user.email || ""}
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
          onRematch={async () => {
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
      <Analytics />
    </>
  );
}
