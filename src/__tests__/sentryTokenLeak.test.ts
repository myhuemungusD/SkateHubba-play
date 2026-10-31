/**
 * Regression for the Storage download-token leak (#911 review).
 *
 * A failed native share logs, from src/services/nativeBridge.ts:
 *   logger.warn("share_file_download_failed", { error: parseFirebaseError(err) })
 * where @capacitor/filesystem 8.1.5 rejects with
 *   "Error downloading file: \(urlString)" (LegacyFilesystemImplementation.swift)
 * and urlString is the tokenised Firebase Storage URL. This runs that exact
 * string through the real logger, the real @sentry/react SDK and the hooks
 * main.tsx installs, then reads the envelope that would go to Sentry. It also
 * covers Sentry.setContext()/setTag() values (contexts and tags).
 */
import { describe, it, expect, afterAll } from "vitest";
import * as Sentry from "@sentry/react";
import { initSentry, captureException } from "../lib/sentry";
import { scrubBreadcrumb, scrubEvent } from "../lib/sentryScrub";
import { logger } from "../services/logger";

const STORAGE_PATH = "https://firebasestorage.googleapis.com/v0/b/demo-bucket/o/games%2Fg1%2Fturn-1%2Fset.webm";
const CAPACITOR_ERROR = `Error downloading file: ${STORAGE_PATH}?alt=media&token=secret-token`;

const sent: string[] = [];

afterAll(async () => {
  await Sentry.close();
});

describe("Storage token never reaches Sentry", () => {
  it("strips the token from the logger's crumb, drops its raw console copy, and scrubs the exception", async () => {
    await initSentry({
      dsn: "https://public@sentry.example.invalid/1",
      beforeBreadcrumb: scrubBreadcrumb,
      beforeSend: scrubEvent,
      transport: () => ({
        send: (envelope) => {
          sent.push(JSON.stringify(envelope));
          return Promise.resolve({});
        },
        flush: () => Promise.resolve(true),
      }),
    });

    logger.warn("share_file_download_failed", { error: CAPACITOR_ERROR });
    // setContext/setTag values reach the event as contexts and tags.
    Sentry.setContext("share", { error: CAPACITOR_ERROR, uid: "raw-uid" });
    Sentry.setTag("clip", `${STORAGE_PATH}?alt=media&token=secret-token`);
    captureException(new Error(CAPACITOR_ERROR), { extra: { context: "share", detail: { error: CAPACITOR_ERROR } } });
    await Sentry.flush(2000);

    expect(sent).toHaveLength(1);
    const envelope = sent[0];
    expect(envelope).not.toContain("secret-token");
    expect(envelope).not.toContain("alt=media");
    // The triage context survives, minus the query.
    expect(envelope).toContain(`"value":"Error downloading file: ${STORAGE_PATH}"`);
    const event = JSON.parse(envelope)[1][0][1] as {
      breadcrumbs: { category?: string; message?: string; data?: Record<string, unknown> }[];
      contexts: Record<string, Record<string, unknown>>;
      tags: Record<string, unknown>;
    };
    expect(event.contexts.share).toEqual({
      error: `Error downloading file: ${STORAGE_PATH}`,
      uid: expect.stringMatching(/^uid_[0-9a-f]{8}$/),
    });
    // The SDK's trace context still links the event to its trace.
    expect(event.contexts.trace).toEqual(
      expect.objectContaining({ trace_id: expect.stringMatching(/^[0-9a-f]{32}$/) }),
    );
    expect(event.tags.clip).toBe(STORAGE_PATH);
    expect(event.breadcrumbs.filter((c) => c.category === "console")).toEqual([]);
    expect(event.breadcrumbs).toContainEqual(
      expect.objectContaining({
        category: "app",
        message: "share_file_download_failed",
        data: { error: `Error downloading file: ${STORAGE_PATH}` },
      }),
    );
  });
});
