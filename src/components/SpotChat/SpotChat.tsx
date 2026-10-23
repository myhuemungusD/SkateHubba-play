/**
 * Spot group chat UI component.
 *
 * Real-time message list with send input, word filter feedback and rate
 * limiting. App Review 1.2: every message that isn't the viewer's own carries
 * a visible REPORT control that files into the main moderator queue (the same
 * one comments and clips use), the author's handle opens their profile (where
 * Block lives), and messages from players the viewer blocked are left out.
 * Hidden messages (word filter or admin takedown) show a neutral placeholder.
 */
import { lazy, Suspense, useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Link } from "react-router";
import type { SpotMessage } from "../../types/spotMessage";
import { sendSpotMessage, subscribeToSpotMessages } from "../../services/spotMessages";
import { parseFirebaseError } from "../../utils/helpers";
import { useBlockedUsers } from "../../hooks/useBlockedUsers";
import { useChatAuthors } from "./useChatAuthors";
import { AlertCircle, Send } from "lucide-react";
import { Btn } from "../ui/Btn";

const ReportModal = lazy(() => import("../ReportModal").then((m) => ({ default: m.ReportModal })));

interface SpotChatProps {
  spotId: string;
  spotName: string;
  currentUserId: string | null;
  onError?: (message: string) => void;
}

export function SpotChat({ spotId, spotName, currentUserId, onError }: SpotChatProps) {
  const [messages, setMessages] = useState<SpotMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reporting, setReporting] = useState<SpotMessage | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const blocked = useBlockedUsers(currentUserId ?? "");

  // The subscription returns newest first; the thread reads oldest-to-newest
  // so the latest message sits at the bottom, next to the input.
  const visible = useMemo(() => messages.filter((m) => !blocked.has(m.userId)).reverse(), [messages, blocked]);
  const authors = useChatAuthors(useMemo(() => visible.map((m) => m.userId), [visible]));

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [visible]);

  // Subscribe to messages
  useEffect(() => {
    if (!spotId) return;

    const unsubscribe = subscribeToSpotMessages({
      spotId,
      limit: 50,
      onMessages: setMessages,
      onError: (err) => {
        const msg = `Failed to load messages: ${parseFirebaseError(err)}`;
        setError(msg);
        onError?.(msg);
      },
    });

    return unsubscribe;
  }, [spotId, onError]);

  const handleSend = useCallback(async () => {
    if (!input.trim() || !currentUserId || sending) return;

    const content = input.trim();
    setInput("");
    setSending(true);
    setError(null);

    try {
      await sendSpotMessage({
        spotId,
        userId: currentUserId,
        content,
      });
    } catch (err) {
      const message = parseFirebaseError(err);
      setError(message);
      onError?.(message);
      // Restore input on error so user can edit and retry
      setInput(content);
    } finally {
      setSending(false);
    }
  }, [input, currentUserId, sending, spotId, onError]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void handleSend();
      }
    },
    [handleSend],
  );

  if (!currentUserId) {
    return (
      <div className="rounded-lg border border-slate-700 bg-slate-800 p-4 text-center">
        <p className="text-sm text-slate-400">Sign in to join the chat</p>
      </div>
    );
  }

  return (
    <div className="flex h-96 flex-col rounded-lg border border-slate-700 bg-slate-800">
      {/* Header */}
      <div className="border-b border-slate-700 px-4 py-3">
        <h3 className="text-sm font-semibold text-white">{spotName} Chat</h3>
        <p className="text-xs text-slate-400">{visible.length} messages</p>
      </div>

      {/* Messages */}
      <div className="flex-1 space-y-2 overflow-y-auto p-4">
        {visible.map((message) => {
          const isOwn = message.userId === currentUserId;
          const shouldHide = message.isHidden && !isOwn;
          const handle = authors.get(message.userId);

          return (
            <div key={message.id} className={`flex flex-col ${isOwn ? "items-end" : "items-start"}`}>
              {!isOwn && (
                // The author's profile is where Block lives, so the handle opens it.
                <Link
                  to={`/player/${encodeURIComponent(message.userId)}`}
                  className="mb-0.5 text-xs text-slate-400 hover:text-white"
                >
                  {handle ? `@${handle}` : "skater"}
                </Link>
              )}
              <div
                className={`max-w-full rounded-lg px-3 py-2 ${
                  shouldHide
                    ? "border border-slate-600 bg-slate-700/50 opacity-50"
                    : isOwn
                      ? "bg-blue-600 text-white"
                      : "bg-slate-700 text-slate-100"
                }`}
              >
                {shouldHide ? (
                  <p className="text-xs italic">Message hidden by moderation</p>
                ) : (
                  <>
                    {/* Untrusted user text: a plain text node, so React escapes it. */}
                    <p className="break-words text-sm">{message.content}</p>
                    {message.isHidden && isOwn && (
                      <div className="mt-1 flex items-center gap-1 text-xs text-slate-300">
                        <AlertCircle className="h-3 w-3" />
                        <span>Hidden from others</span>
                      </div>
                    )}
                  </>
                )}
              </div>
              {!isOwn && !shouldHide && (
                <button
                  type="button"
                  onClick={() => setReporting(message)}
                  aria-label={handle ? `Report message by @${handle}` : "Report this message"}
                  className="inline-flex min-h-[44px] items-center text-[11px] tracking-[0.15em] text-slate-400 hover:text-red-400"
                >
                  REPORT
                </button>
              )}
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Error banner */}
      {error && (
        <div className="border-t border-slate-700 bg-red-900/20 px-4 py-2">
          <p className="text-xs text-red-400">{error}</p>
        </div>
      )}

      {/* Input */}
      <div className="border-t border-slate-700 p-4">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            maxLength={500}
            disabled={sending}
            className="flex-1 rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-white placeholder-slate-400 focus:border-blue-500 focus:outline-none disabled:opacity-50"
          />
          <Btn onClick={handleSend} disabled={!input.trim() || sending} variant="primary" aria-label="Send message">
            <Send className="h-4 w-4" />
          </Btn>
        </div>
        <p className="mt-1 text-xs text-slate-400">
          {input.length}/500
          {input.length > 450 && " · Max length"}
        </p>
      </div>

      {reporting && (
        <Suspense fallback={null}>
          <ReportModal
            reporterUid={currentUserId}
            reportedUid={reporting.userId}
            reportedUsername={authors.get(reporting.userId) ?? ""}
            gameId={null}
            spotId={reporting.spotId}
            message={{ id: reporting.id, text: reporting.content }}
            onClose={() => setReporting(null)}
            onSubmitted={() => setReporting(null)}
          />
        </Suspense>
      )}
    </div>
  );
}
