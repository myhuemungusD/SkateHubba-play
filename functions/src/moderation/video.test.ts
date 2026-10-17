import { describe, expect, it, vi } from "vitest";
import { annotateStoredVideo, gcpAccessToken, parseAnnotationResponse, VideoIntelligenceError } from "./video.js";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as Response;
}

describe("parseAnnotationResponse", () => {
  it("reads explicit frames and label confidences, and ignores junk", () => {
    const parsed = parseAnnotationResponse({
      response: {
        annotationResults: [
          {
            explicitAnnotation: {
              frames: [{ pornographyLikelihood: "UNLIKELY" }, { pornographyLikelihood: 1 }, null],
            },
            segmentLabelAnnotations: [
              { entity: { description: "skateboard" }, segments: [{ confidence: 0.4 }, { confidence: 0.8 }] },
              { entity: { description: "" } },
              null,
            ],
            shotLabelAnnotations: [{ entity: { description: "person" }, segments: [{ confidence: "nope" }] }],
            frameLabelAnnotations: [{ entity: { description: "street" }, frames: [{ confidence: 0.3 }] }],
          },
          "nope",
        ],
      },
    });
    expect(parsed.explicitLikelihoods).toEqual(["UNLIKELY"]);
    expect(parsed.labels).toEqual([
      { description: "skateboard", confidence: 0.8 },
      { description: "person", confidence: 0 },
      { description: "street", confidence: 0.3 },
    ]);
    expect(parseAnnotationResponse(null).labels).toEqual([]);
    expect(parseAnnotationResponse({ response: {} }).explicitLikelihoods).toEqual([]);
  });
});

describe("gcpAccessToken", () => {
  it("returns the metadata token and rejects a bad response", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ access_token: "ya29.token" }));
    await expect(gcpAccessToken(fetchImpl)).resolves.toBe("ya29.token");

    const missing = vi.fn(async () => jsonResponse({}));
    await expect(gcpAccessToken(missing)).rejects.toBeInstanceOf(VideoIntelligenceError);

    const down = vi.fn(async () => jsonResponse({}, false, 500));
    await expect(gcpAccessToken(down)).rejects.toThrow(/metadata token 500/);
  });
});

describe("annotateStoredVideo", () => {
  it("polls until the operation finishes and returns the annotation", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ name: "projects/p/operations/op1" }))
      .mockResolvedValueOnce(jsonResponse({ done: false }))
      .mockResolvedValueOnce(
        jsonResponse({
          done: true,
          response: {
            annotationResults: [
              {
                explicitAnnotation: { frames: [{ pornographyLikelihood: "VERY_UNLIKELY" }] },
                segmentLabelAnnotations: [
                  { entity: { description: "skateboarding" }, segments: [{ confidence: 0.9 }] },
                ],
              },
            ],
          },
        }),
      );
    const sleep = vi.fn(async () => undefined);
    const result = await annotateStoredVideo("gs://bucket/userClips/u/c.webm", {
      fetchImpl,
      getToken: async () => "token",
      timeoutMs: 10_000,
      pollMs: 1,
      sleep,
      now: () => 0,
    });
    expect(result.explicitLikelihoods).toEqual(["VERY_UNLIKELY"]);
    expect(result.labels[0]?.description).toBe("skateboarding");
    expect(sleep).toHaveBeenCalledOnce();
  });

  it("throws on HTTP failure, a missing operation, an operation error, and a timeout", async () => {
    await expect(
      annotateStoredVideo("gs://b/userClips/u/c.webm", {
        fetchImpl: vi.fn(async () => jsonResponse({}, false, 403)),
        getToken: async () => "token",
        now: () => 0,
      }),
    ).rejects.toThrow(/annotate 403/);

    await expect(
      annotateStoredVideo("gs://b/userClips/u/c.webm", {
        fetchImpl: vi.fn(async () => jsonResponse({})),
        getToken: async () => "token",
        now: () => 0,
      }),
    ).rejects.toThrow(/operation missing/);

    await expect(
      annotateStoredVideo("gs://b/userClips/u/c.webm", {
        fetchImpl: vi
          .fn()
          .mockResolvedValueOnce(jsonResponse({ name: "operations/op" }))
          .mockResolvedValueOnce(jsonResponse({ done: true, error: { message: "bad video" } })),
        getToken: async () => "token",
        now: () => 0,
        sleep: async () => undefined,
      }),
    ).rejects.toThrow(/bad video/);

    let clock = 0;
    await expect(
      annotateStoredVideo("gs://b/userClips/u/c.webm", {
        fetchImpl: vi
          .fn()
          .mockResolvedValueOnce(jsonResponse({ name: "operations/op" }))
          .mockResolvedValueOnce(jsonResponse({ done: false })),
        getToken: async () => "token",
        timeoutMs: 5,
        now: () => {
          clock += 10;
          return clock;
        },
        sleep: async () => undefined,
      }),
    ).rejects.toThrow(/timed out/);
  });
});
