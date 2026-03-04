import { useState, useEffect, useRef, useCallback, type ReactNode } from "react";
import { Analytics } from "@vercel/analytics/react";
import { useAuth } from "./hooks/useAuth";
import { signUp, signIn, signOut, resetPassword } from "./services/auth";
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
  subscribeToMyGames,
  subscribeToGame,
  type GameDoc,
} from "./services/games";
import { uploadVideo } from "./services/storage";

/* ═══════════════════════════════════════════
 *  BRAND TOKENS
 * ═══════════════════════════════════════════ */

const C = {
  bg: "#0A0A0A",
  surface: "#141414",
  surfaceAlt: "#1A1A1A",
  border: "#2A2A2A",
  orange: "#FF6B00",
  orangeGlow: "rgba(255,107,0,0.12)",
  green: "#00E676",
  greenGlow: "rgba(0,230,118,0.10)",
  red: "#FF3D00",
  redGlow: "rgba(255,61,0,0.10)",
  text: "#F5F5F5",
  muted: "#888",
  dim: "#555",
};

const LETTERS = ["S", "K", "A", "T", "E"];
const TRICKS = [
  "Kickflip", "Heelflip", "Tre Flip", "Hardflip", "Pop Shove-it",
  "FS 180", "BS 180", "Nollie Flip", "Varial Flip", "Laser Flip",
];

/* ═══════════════════════════════════════════
 *  SHARED UI COMPONENTS
 * ═══════════════════════════════════════════ */

function Btn({
  children, onClick, variant = "primary", disabled, className = "",
}: {
  children: ReactNode; onClick?: () => void; variant?: string; disabled?: boolean; className?: string;
}) {
  const base =
    "w-full rounded-xl font-display tracking-wider text-center transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98]";
  const variants: Record<string, string> = {
    primary: "bg-brand-orange text-white py-4 text-xl",
    secondary: "bg-surface-alt border border-border text-white py-3.5 text-lg",
    success: "bg-brand-green text-black py-4 text-xl font-bold",
    danger: "bg-brand-red text-white py-4 text-xl",
    ghost: "bg-transparent border border-border text-[#888] py-3 text-lg",
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`${base} ${variants[variant ?? "primary"]} ${className}`}
    >
      {children}
    </button>
  );
}

function Field({
  label, value, onChange, placeholder, type = "text", maxLength, note, icon,
}: {
  label?: string; value: string; onChange: (v: string) => void;
  placeholder?: string; type?: string; maxLength?: number; note?: string; icon?: string;
}) {
  return (
    <div className="mb-4 w-full">
      {label && (
        <label className="block font-display text-sm tracking-[0.12em] text-[#888] mb-1.5">
          {label}
        </label>
      )}
      <div className="relative">
        {icon && (
          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#555] text-base">
            {icon}
          </span>
        )}
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          maxLength={maxLength}
          className={`w-full bg-surface-alt border border-border rounded-xl text-white text-base font-body outline-none
            focus:border-brand-orange transition-colors duration-200
            ${icon ? "pl-10 pr-4 py-3.5" : "px-4 py-3.5"}`}
        />
      </div>
      {note && <span className="text-xs text-[#555] mt-1 block">{note}</span>}
    </div>
  );
}

function LetterDisplay({ count, name, active }: { count: number; name: string; active?: boolean }) {
  return (
    <div
      className={`flex flex-col items-center gap-1.5 px-4 py-3 rounded-xl border transition-all duration-300 min-w-[84px]
        ${active ? "border-brand-orange bg-[rgba(255,107,0,0.08)]" : "border-border bg-transparent"}`}
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
    const tick = () => {
      const diff = deadline - Date.now();
      if (diff <= 0) { setText("TIME'S UP"); return; }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setText(`${h}h ${m}m ${s}s`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [deadline]);
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-alt border border-border">
      <span className="text-[#555] text-sm">⏱</span>
      <span className="font-display text-sm text-brand-orange tracking-wider">{text}</span>
    </div>
  );
}

function Spinner() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-[#0A0A0A]">
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
    <div className="w-full p-3 rounded-xl bg-[rgba(255,61,0,0.08)] border border-brand-red mb-4 flex justify-between items-center">
      <span className="font-body text-sm text-brand-red">{message}</span>
      {onDismiss && (
        <button onClick={onDismiss} className="text-brand-red text-lg leading-none ml-2">×</button>
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
}: {
  onRecorded: (blob: Blob | null) => void;
  label: string;
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
    } catch {
      // No camera — still allow demo flow
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
    const mr = new MediaRecorder(streamRef.current, { mimeType: "video/webm" });
    mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    mr.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: "video/webm" });
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
    };
  }, []);

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
            ✓ Recorded — Auto-submitted
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
      style={{ background: `radial-gradient(ellipse at 50% 0%, rgba(255,107,0,0.06) 0%, transparent 60%), ${C.bg}` }}
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
    if (!email.includes("@")) { setError("Enter a valid email"); return; }
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
    } catch (err: any) {
      const code = err?.code || "";
      if (code === "auth/email-already-in-use") setError("Email already in use");
      else if (code === "auth/invalid-credential" || code === "auth/wrong-password")
        setError("Invalid email or password");
      else if (code === "auth/user-not-found") setError("No account with that email");
      else if (code === "auth/weak-password") setError("Password too weak (6+ chars)");
      else setError(err?.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async () => {
    if (!email.includes("@")) { setError("Enter your email first"); return; }
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

        <Field label="Email" value={email} onChange={setEmail} placeholder="you@email.com" icon="@" type="email" />
        <Field label="Password" value={password} onChange={setPassword} placeholder="••••••••" icon="🔒" type="password" />
        {isSignup && (
          <Field label="Confirm" value={confirm} onChange={setConfirm} placeholder="••••••••" icon="🔒" type="password" />
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

        {!isSignup && (
          <p
            className="font-body text-xs text-[#555] text-center mt-3 cursor-pointer hover:text-[#888] transition-colors"
            onClick={handleReset}
          >
            Forgot password?
          </p>
        )}

        <p className="font-body text-sm text-[#555] text-center mt-5 cursor-pointer" onClick={onToggle}>
          {isSignup ? "Already have an account? " : "Need an account? "}
          <span className="text-brand-orange">{isSignup ? "Sign in" : "Sign up"}</span>
        </p>
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
    } catch (err: any) {
      setError(err?.message || "Could not create profile");
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

        <Field
          label="Username"
          value={username}
          onChange={(v) => setUsername(v.replace(/[^a-zA-Z0-9_]/g, ""))}
          placeholder="sk8legend"
          maxLength={20}
          icon="@"
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
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
 *  SCREEN: LOBBY
 * ═══════════════════════════════════════════ */

function Lobby({
  profile, games, onChallenge, onOpenGame, onSignOut,
}: {
  profile: UserProfile; games: GameDoc[];
  onChallenge: () => void; onOpenGame: (g: GameDoc) => void; onSignOut: () => void;
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
        <button onClick={onSignOut} className="font-body text-xs text-[#555] hover:text-[#888] transition-colors">
          Sign Out
        </button>
      </div>

      <div className="px-5 pt-6 max-w-lg mx-auto">
        <h1 className="font-display text-[42px] text-white mb-6">Your Games</h1>

        <Btn onClick={onChallenge} className="mb-8">🎯 Challenge Someone</Btn>

        {/* Active */}
        {active.length > 0 && (
          <>
            <h3 className="font-display text-sm tracking-[0.15em] text-[#888] mb-3">ACTIVE</h3>
            {active.map((g) => (
              <div
                key={g.id}
                onClick={() => onOpenGame(g)}
                className={`p-4 rounded-2xl mb-3 bg-surface border cursor-pointer transition-all
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
                onClick={() => onOpenGame(g)}
                className="p-4 rounded-2xl mb-3 bg-surface border border-border cursor-pointer transition-all opacity-70"
              >
                <span className="font-display text-xl text-white">vs @{opponent(g)}</span>
                <span className={`block font-body text-xs mt-0.5 ${g.winner === profile.uid ? "text-brand-green" : "text-brand-red"}`}>
                  {g.winner === profile.uid ? "You won!" : "You lost"}
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
    } catch (err: any) {
      setError(err?.message || "Could not find user");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-dvh bg-[#0A0A0A] px-6 pt-6">
      <div className="max-w-md mx-auto">
        <button onClick={onBack} className="font-body text-sm text-[#888] mb-6 flex items-center gap-1.5">
          ← Back
        </button>

        <h1 className="font-display text-[42px] text-white mb-2">Challenge</h1>
        <p className="font-body text-sm text-[#888] mb-8">Call someone out. First to S.K.A.T.E. loses.</p>

        <Field
          label="Opponent Username"
          value={opponent}
          onChange={(v) => setOpponent(v.replace(/[^a-zA-Z0-9_]/g, ""))}
          placeholder="their_handle"
          icon="@"
        />

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
  const [trickName, setTrickName] = useState("");
  const [videoBlob, setVideoBlob] = useState<Blob | null>(null);
  const [videoRecorded, setVideoRecorded] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const isSetter = game.phase === "setting" && game.currentSetter === profile.uid;
  const isMatcher = game.phase === "matching" && game.currentTurn === profile.uid;
  const opponentName =
    game.player1Uid === profile.uid ? game.player2Username : game.player1Username;

  const handleRecorded = useCallback((blob: Blob | null) => {
    setVideoBlob(blob);
    setVideoRecorded(true);
  }, []);

  // Setter submits trick
  const submitTrick = async () => {
    if (!trickName) return;
    setSubmitting(true);
    setError("");
    try {
      let videoUrl: string | null = null;
      if (videoBlob) {
        videoUrl = await uploadVideo(game.id, game.turnNumber, "set", videoBlob);
      }
      await setTrick(game.id, trickName, videoUrl);
      // Game will update via realtime listener → back to lobby
    } catch (err: any) {
      setError(err?.message || "Failed to submit trick");
    } finally {
      setSubmitting(false);
    }
  };

  // Matcher submits result
  const submitResult = async (landed: boolean) => {
    setSubmitting(true);
    setError("");
    try {
      let videoUrl: string | null = null;
      if (videoBlob) {
        videoUrl = await uploadVideo(game.id, game.turnNumber, "match", videoBlob);
      }
      await submitMatchResult(game.id, landed, videoUrl);
      // Game will update via realtime listener
    } catch (err: any) {
      setError(err?.message || "Failed to submit result");
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
        <button onClick={onBack} className="font-body text-sm text-[#888]">← Games</button>
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
            {isSetter ? "Set your trick" : `Match @${game.player1Uid === game.currentSetter ? game.player1Username : game.player2Username}'s ${game.currentTrickName || "trick"}`}
          </span>
        </div>

        {/* Trick name input (setter) */}
        {isSetter && (
          <>
            <Field label="Name This Trick" value={trickName} onChange={setTrickName} placeholder="Kickflip, Tre Flip..." />
            <div className="flex flex-wrap gap-1.5 mb-5">
              {TRICKS.map((t) => (
                <button
                  key={t}
                  onClick={() => setTrickName(t)}
                  className={`px-3 py-1.5 rounded-md text-xs font-body cursor-pointer transition-all
                    ${trickName === t
                      ? "bg-[rgba(255,107,0,0.1)] border border-brand-orange text-brand-orange"
                      : "bg-surface-alt border border-border text-[#555]"
                    }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </>
        )}

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
          onRecorded={handleRecorded}
          label={isSetter ? "Land Your Trick" : `Match the ${game.currentTrickName || "Trick"}`}
        />

        <ErrorBanner message={error} onDismiss={() => setError("")} />

        {/* Setter Submit */}
        {isSetter && videoRecorded && (
          <div className="mt-5">
            <Btn onClick={submitTrick} variant="success" disabled={!trickName || submitting}>
              {submitting ? "Sending..." : `✓ Submit — Send to @${opponentName}`}
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
  const opponentName =
    game.player1Uid === profile.uid ? game.player2Username : game.player1Username;
  const myLetters = game.player1Uid === profile.uid ? game.p1Letters : game.p2Letters;
  const theirLetters = game.player1Uid === profile.uid ? game.p2Letters : game.p1Letters;

  return (
    <div
      className="min-h-dvh flex flex-col items-center justify-center px-6"
      style={{
        background: isWinner
          ? `radial-gradient(ellipse at 50% 30%, rgba(0,230,118,0.05) 0%, transparent 60%), ${C.bg}`
          : `radial-gradient(ellipse at 50% 30%, rgba(255,61,0,0.05) 0%, transparent 60%), ${C.bg}`,
      }}
    >
      <div className="text-center max-w-sm animate-fade-in">
        <span className="text-6xl block mb-4">{isWinner ? "🏆" : "💀"}</span>
        <h1 className={`font-display text-5xl mb-2 ${isWinner ? "text-brand-green" : "text-brand-red"}`}>
          {isWinner ? "You Win" : "S.K.A.T.E."}
        </h1>
        <p className="font-body text-base text-[#888] mb-8">
          {isWinner ? `@${opponentName} spelled S.K.A.T.E.` : `@${opponentName} outlasted you.`}
        </p>

        <div className="flex justify-center gap-5 mb-10">
          <LetterDisplay count={myLetters} name={`@${profile.username}`} active={isWinner} />
          <LetterDisplay count={theirLetters} name={`@${opponentName}`} active={!isWinner} />
        </div>

        <div className="flex flex-col gap-3 w-full">
          <Btn onClick={onRematch}>🔥 Rematch</Btn>
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
  useEffect(() => {
    if (!activeGame) return;
    const unsub = subscribeToGame(activeGame.id, (updated) => {
      if (!updated) return;
      setActiveGame(updated);
      // If game just finished, go to game over
      if (updated.status === "complete" && screen === "game") {
        setScreen("gameover");
      }
    });
    return unsub;
  }, [activeGame?.id]);

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
          onChallenge={() => setScreen("challenge")}
          onOpenGame={(g) => {
            setActiveGame(g);
            if (g.status === "complete") setScreen("gameover");
            else setScreen("game");
          }}
          onSignOut={async () => {
            await signOut();
            setActiveProfile(null);
            setGames([]);
            setActiveGame(null);
            setScreen("landing");
          }}
        />
      )}

      {screen === "challenge" && activeProfile && (
        <ChallengeScreen
          profile={activeProfile}
          onSend={async (opponentUid, opponentUsername) => {
            const gameId = await createGame(
              user!.uid,
              activeProfile.username,
              opponentUid,
              opponentUsername
            );
            // The realtime listener will pick up the new game
            // Open it immediately
            const newGame: GameDoc = {
              id: gameId,
              player1Uid: user!.uid,
              player2Uid: opponentUid,
              player1Username: activeProfile.username,
              player2Username: opponentUsername,
              p1Letters: 0,
              p2Letters: 0,
              status: "active",
              currentTurn: user!.uid,
              phase: "setting",
              currentSetter: user!.uid,
              currentTrickName: null,
              currentTrickVideoUrl: null,
              matchVideoUrl: null,
              turnDeadline: { toMillis: () => Date.now() + 86400000 } as any,
              turnNumber: 1,
              winner: null,
              createdAt: null,
              updatedAt: null,
            };
            setActiveGame(newGame);
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

      {screen === "gameover" && activeGame && activeProfile && (
        <GameOverScreen
          game={activeGame}
          profile={activeProfile}
          onRematch={async () => {
            const opponentUid =
              activeGame.player1Uid === user!.uid ? activeGame.player2Uid : activeGame.player1Uid;
            const opponentName =
              activeGame.player1Uid === user!.uid ? activeGame.player2Username : activeGame.player1Username;
            const gameId = await createGame(user!.uid, activeProfile.username, opponentUid, opponentName);
            setActiveGame({
              id: gameId,
              player1Uid: user!.uid,
              player2Uid: opponentUid,
              player1Username: activeProfile.username,
              player2Username: opponentName,
              p1Letters: 0, p2Letters: 0,
              status: "active",
              currentTurn: user!.uid,
              phase: "setting",
              currentSetter: user!.uid,
              currentTrickName: null,
              currentTrickVideoUrl: null,
              matchVideoUrl: null,
              turnDeadline: { toMillis: () => Date.now() + 86400000 } as any,
              turnNumber: 1,
              winner: null,
              createdAt: null,
              updatedAt: null,
            });
            setScreen("game");
          }}
          onBack={() => { setActiveGame(null); setScreen("lobby"); }}
        />
      )}
      <Analytics />
    </>
  );
}
