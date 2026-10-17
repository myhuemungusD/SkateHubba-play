/**
 * Spot group chat UI component.
 *
 * Real-time message list with send input, word filter feedback, rate limiting,
 * and report functionality. Hidden messages (flagged by filter or admin) are
 * shown dimmed with a reason badge.
 */
import { useState, useEffect, useRef, useCallback } from "react";
import type { SpotMessage } from "../../types/spotMessage";
import { sendSpotMessage, subscribeToSpotMessages, reportSpotMessage } from "../../services/spotMessages";
import { logger } from "../../services/logger";
import { parseFirebaseError } from "../../utils/helpers";
import { AlertCircle, Send, Flag } from "lucide-react";
import { Btn } from "../ui/Btn";

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
  const [reportingMessageId, setReportingMessageId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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

  const handleReport = useCallback(
    async (message: SpotMessage) => {
      if (!currentUserId || reportingMessageId) return;

      setReportingMessageId(message.id);
      try {
        await reportSpotMessage({
          messageId: message.id,
          spotId: message.spotId,
          reportedBy: currentUserId,
          reason: "inappropriate",
        });
        logger.info("spot_message_report_ui", { messageId: message.id });
      } catch (err) {
        const msg = `Failed to report message: ${parseFirebaseError(err)}`;
        setError(msg);
        onError?.(msg);
      } finally {
        setReportingMessageId(null);
      }
    },
    [currentUserId, reportingMessageId, onError],
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
        <p className="text-xs text-slate-400">{messages.length} messages</p>
      </div>

      {/* Messages */}
      <div className="flex-1 space-y-2 overflow-y-auto p-4">
        {messages.map((message) => {
          const isOwn = message.userId === currentUserId;
          const shouldHide = message.isHidden && !isOwn;

          return (
            <div key={message.id} className={`group flex gap-2 ${isOwn ? "flex-row-reverse" : "flex-row"}`}>
              <div
                className={`flex-1 rounded-lg px-3 py-2 ${
                  shouldHide
                    ? "border border-slate-600 bg-slate-700/50 opacity-50"
                    : isOwn
                      ? "bg-blue-600 text-white"
                      : "bg-slate-700 text-slate-100"
                }`}
              >
                {shouldHide ? (
                  <p className="text-xs italic">[Hidden: {message.hiddenReason || "reported"}]</p>
                ) : (
                  <>
                    <p className="break-words text-sm">{message.content}</p>
                    {message.isHidden && isOwn && (
                      <div className="mt-1 flex items-center gap-1 text-xs text-slate-300">
                        <AlertCircle className="h-3 w-3" />
                        <span>Hidden by filter</span>
                      </div>
                    )}
                  </>
                )}
              </div>
              {!isOwn && !shouldHide && (
                <button
                  type="button"
                  onClick={() => handleReport(message)}
                  disabled={reportingMessageId === message.id}
                  className="opacity-0 transition-opacity group-hover:opacity-100"
                  aria-label="Report message"
                >
                  <Flag className="h-4 w-4 text-slate-400 hover:text-red-400" />
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
          <Btn
            onClick={handleSend}
            disabled={!input.trim() || sending}
            variant="primary"
            size="sm"
            aria-label="Send message"
          >
            <Send className="h-4 w-4" />
          </Btn>
        </div>
        <p className="mt-1 text-xs text-slate-400">
          {input.length}/500
          {input.length > 450 && " · Max length"}
        </p>
      </div>
    </div>
  );
}
