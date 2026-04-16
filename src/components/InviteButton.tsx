import { useState, useEffect, useRef } from "react";
import { trackEvent } from "../services/analytics";
import { playOlliePop } from "../utils/ollieSound";

export function InviteButton({ username, className = "" }: { username?: string; className?: string }) {
  const [showPanel, setShowPanel] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [copied, setCopied] = useState(false);
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  useEffect(() => {
    return () => {
      for (const id of timersRef.current) clearTimeout(id);
    };
  }, []);

  const safeTimeout = (fn: () => void, ms: number) => {
    const id = setTimeout(() => {
      timersRef.current.delete(id);
      fn();
    }, ms);
    timersRef.current.add(id);
  };

  const url = import.meta.env.VITE_APP_URL || window.location.origin;
  const text = username
    ? `I'm playing S.K.A.T.E. on SkateHubba — challenge me! My handle: @${username}`
    : "Play S.K.A.T.E. on SkateHubba — the first async trick battle game!";
  const fullMessage = `${text}\n${url}`;
  const encodedText = encodeURIComponent(fullMessage);
  const encodedUrl = encodeURIComponent(url);

  const flash = (msg: string, ms = 3000) => {
    setStatusMsg(msg);
    safeTimeout(() => setStatusMsg(""), ms);
  };

  const handleContacts = async () => {
    if (!("contacts" in navigator) || !navigator.contacts) {
      flash("Phone contacts not available in this browser. Try Chrome on Android.");
      return;
    }
    try {
      const contacts = await navigator.contacts.select(["name", "tel"], { multiple: true });
      if (!contacts.length) return;

      const phones = contacts
        .flatMap((c) => c.tel || [])
        .filter(Boolean)
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
      trackEvent("invite_sent", { method: "sms", count: phones.length });
    } catch {
      /* user cancelled picker */
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(fullMessage);
      setCopied(true);
      safeTimeout(() => setCopied(false), 2000);
      trackEvent("invite_sent", { method: "copy_link" });
    } catch {
      flash("Could not copy — try long-pressing to copy instead.");
    }
  };

  const handleNativeShare = async () => {
    try {
      await navigator.share({ title: "SkateHubba", text, url });
      trackEvent("invite_sent", { method: "native_share" });
    } catch {
      /* cancelled */
    }
  };

  const socials = [
    { name: "X", icon: "𝕏", href: `https://twitter.com/intent/tweet?text=${encodedText}` },
    { name: "WhatsApp", icon: "WA", href: `https://wa.me/?text=${encodedText}` },
    { name: "Snapchat", icon: "SC", href: `https://www.snapchat.com/scan?attachmentUrl=${encodedUrl}` },
    { name: "Facebook", icon: "FB", href: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}` },
    {
      name: "Reddit",
      icon: "Re",
      href: `https://www.reddit.com/submit?url=${encodedUrl}&title=${encodeURIComponent(text)}`,
    },
    { name: "Telegram", icon: "TG", href: `https://t.me/share/url?url=${encodedUrl}&text=${encodeURIComponent(text)}` },
  ];

  const tileBase =
    "rounded-xl bg-surface-alt border border-border hover:border-brand-orange/40 hover:bg-brand-orange/[0.03] active:scale-[0.97] transition-all duration-300";

  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => {
          playOlliePop();
          setShowPanel(!showPanel);
        }}
        className="w-full flex items-center justify-center gap-2.5 bg-transparent border border-border text-subtle hover:text-white hover:border-border-hover hover:bg-white/[0.02] rounded-2xl py-3.5 font-display tracking-wider text-lg transition-all duration-300 active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
      >
        {showPanel ? (
          <>
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
            Close
          </>
        ) : (
          <>
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
              <polyline points="16 6 12 2 8 6" />
              <line x1="12" y1="2" x2="12" y2="15" />
            </svg>
            Invite a Friend
          </>
        )}
      </button>

      {showPanel && (
        <div
          role="region"
          aria-label="Invite a friend options"
          className="mt-3 p-4 rounded-2xl bg-surface border border-border animate-fade-in space-y-4"
        >
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
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#FF6B00"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
                </svg>
              </div>
              <div>
                <span className="font-display text-sm tracking-wider text-white block">FROM YOUR CONTACTS</span>
                <span className="font-body text-xs text-[#666]">Pick people & send via SMS</span>
              </div>
            </button>
          </div>

          {statusMsg && <div className="text-xs text-brand-orange font-body px-1 animate-fade-in">{statusMsg}</div>}

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
                  onClick={() => trackEvent("invite_sent", { method: s.name.toLowerCase() })}
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
            <button
              type="button"
              onClick={handleCopy}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 font-body text-xs ${tileBase} ${
                copied ? "border-brand-green text-brand-green" : "text-[#888]"
              }`}
            >
              {copied ? (
                <>
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  Copied
                </>
              ) : (
                <>
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
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
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <circle cx="18" cy="5" r="3" />
                  <circle cx="6" cy="12" r="3" />
                  <circle cx="18" cy="19" r="3" />
                  <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                  <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
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
