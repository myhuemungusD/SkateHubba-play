import { describe, it, expect, vi, afterEach } from "vitest";
import { logger } from "../../services/logger";
import {
  logPreviewPlayError,
  AUDIO_CONSTRAINTS,
  iosVideoDeviceId,
  isIOSDevice,
  prefersH264Mp4,
  recorderMimeCandidates,
  holdOrientation,
  portraitFrameIsSensorCrop,
  selectIosCamera,
  trackMatchesRequestedCamera,
  tuneVideoTrack,
  videoConstraints,
} from "../cameraCapture";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1";
const IPHONE_CHROME =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.0.0 Mobile/15E148 Safari/604.1";
const IPAD_OS =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
const MAC_SAFARI =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
const MAC_CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const MAC_NO_SAFARI = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";
const ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

function stubUA(ua: string, maxTouchPoints = 0): () => void {
  const prevUA = Object.getOwnPropertyDescriptor(navigator, "userAgent");
  const prevTouch = Object.getOwnPropertyDescriptor(navigator, "maxTouchPoints");
  Object.defineProperty(navigator, "userAgent", { configurable: true, value: ua });
  Object.defineProperty(navigator, "maxTouchPoints", { configurable: true, value: maxTouchPoints });
  return () => {
    if (prevUA) Object.defineProperty(navigator, "userAgent", prevUA);
    if (prevTouch) Object.defineProperty(navigator, "maxTouchPoints", prevTouch);
  };
}

function track(options: {
  settings?: MediaTrackSettings;
  capabilities?: MediaTrackCapabilities;
  capabilitiesThrows?: boolean;
  apply?: () => Promise<void>;
}): MediaStreamTrack & { applyConstraints: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> } {
  const applyConstraints = vi.fn(options.apply ?? (() => Promise.resolve()));
  const stop = vi.fn();
  return {
    kind: "video",
    stop,
    getSettings: () => options.settings ?? {},
    getCapabilities: () => {
      if (options.capabilitiesThrows) throw new Error("no capabilities");
      return options.capabilities ?? {};
    },
    applyConstraints,
  } as unknown as MediaStreamTrack & { applyConstraints: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> };
}

function streamOf(video?: MediaStreamTrack, audio?: MediaStreamTrack): MediaStream {
  const videos = video ? [video] : [];
  const audios = audio ? [audio] : [];
  return {
    getVideoTracks: () => videos,
    getAudioTracks: () => audios,
    getTracks: () => [...videos, ...audios],
  } as unknown as MediaStream;
}

afterEach(() => {
  vi.restoreAllMocks();
});

function stubOrientation(portrait: boolean | "throw"): () => void {
  const prev = Object.getOwnPropertyDescriptor(window, "matchMedia");
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => {
      if (portrait === "throw") throw new Error("matchMedia unavailable");
      return { matches: portrait && query === "(orientation: portrait)", media: query };
    },
  });
  return () => {
    if (prev) Object.defineProperty(window, "matchMedia", prev);
    else Reflect.deleteProperty(window, "matchMedia");
  };
}

describe("videoConstraints", () => {
  it("asks for 1080p16:9 at an ideal 60fps, with 30fps and 720p as optional fallbacks", () => {
    expect(videoConstraints("environment", undefined, "landscape")).toEqual({
      facingMode: { ideal: "environment" },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      aspectRatio: { ideal: 16 / 9 },
      frameRate: { ideal: 60 },
      advanced: [
        { width: 1920, height: 1080, frameRate: 60 },
        { width: 1920, height: 1080, frameRate: 30 },
        { width: 1280, height: 720, frameRate: 60 },
        { width: 1280, height: 720, frameRate: 30 },
      ],
    });
    expect(AUDIO_CONSTRAINTS).toEqual({
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    });
  });

  it("selects an enumerated lens by deviceId and does not also send facingMode", () => {
    const constraints = videoConstraints("user", "cam-front", "landscape");
    expect(constraints.deviceId).toEqual({ exact: "cam-front" });
    expect(constraints.facingMode).toBeUndefined();
    expect(constraints.frameRate).toEqual({ ideal: 60 });
  });

  it("asks for 1080x1920 when the phone is held portrait, without an exact 9:16 crop", () => {
    const portrait = videoConstraints("environment", undefined, "portrait");
    const landscape = videoConstraints("environment", undefined, "landscape");
    expect(portrait.width).toEqual({ ideal: 1080 });
    expect(portrait.height).toEqual({ ideal: 1920 });
    expect(portrait.aspectRatio).toEqual({ ideal: 1080 / 1920 });
    expect(portrait.advanced).toEqual(landscape.advanced);
    expect(portrait.facingMode).toEqual({ ideal: "environment" });
  });

  it("reads portrait from the screen and treats a missing query as landscape", () => {
    const upright = stubOrientation(true);
    expect(holdOrientation()).toBe("portrait");
    upright();
    const sideways = stubOrientation(false);
    expect(holdOrientation()).toBe("landscape");
    sideways();
    const broken = stubOrientation("throw");
    expect(holdOrientation()).toBe("landscape");
    broken();
  });
});

describe("iosVideoDeviceId", () => {
  const devices = [
    { kind: "audioinput", deviceId: "mic" },
    { kind: "videoinput", deviceId: "" },
    { kind: "videoinput", deviceId: "front", label: "Frontkamera" },
    { kind: "audioinput", deviceId: "mic-2" },
    { kind: "videoinput", deviceId: "wide", label: "Rückkamera" },
    { kind: "videoinput", deviceId: "ultra", label: "Ultra Wide" },
  ];

  it("uses enumerate order and ignores localized labels", () => {
    expect(iosVideoDeviceId(devices, "user")).toBe("front");
    expect(iosVideoDeviceId(devices, "environment")).toBe("wide");
  });

  it("returns undefined when that index does not exist", () => {
    expect(iosVideoDeviceId([{ kind: "videoinput", deviceId: "only" }], "environment")).toBeUndefined();
    expect(iosVideoDeviceId([], "user")).toBeUndefined();
  });
});

describe("platform detection", () => {
  const cases = [
    { name: "iPhone Safari", ua: IPHONE, touch: 0, ios: true, mp4: true },
    { name: "iPhone Chrome", ua: IPHONE_CHROME, touch: 0, ios: true, mp4: true },
    { name: "iPadOS desktop mode", ua: IPAD_OS, touch: 5, ios: true, mp4: true },
    { name: "desktop Safari", ua: MAC_SAFARI, touch: 0, ios: false, mp4: true },
    { name: "desktop Chrome", ua: MAC_CHROME, touch: 5, ios: false, mp4: false },
    { name: "Mac UA without Safari", ua: MAC_NO_SAFARI, touch: 5, ios: false, mp4: false },
    { name: "Android Chrome", ua: ANDROID, touch: 5, ios: false, mp4: false },
    { name: "empty UA", ua: "", touch: 0, ios: false, mp4: false },
  ] as const;

  for (const { name, ua, touch, ios, mp4 } of cases) {
    it(`classifies ${name}`, () => {
      const restore = stubUA(ua, touch);
      try {
        expect(isIOSDevice()).toBe(ios);
        expect(prefersH264Mp4()).toBe(mp4);
      } finally {
        restore();
      }
    });
  }

  it("orders MP4 ahead of WebM on WebKit and the other way on Chrome Android", () => {
    const restoreIos = stubUA(IPHONE);
    try {
      expect(recorderMimeCandidates()[0]).toBe("video/mp4;codecs=avc1.42E01E");
      expect(recorderMimeCandidates()).toContain("video/webm;codecs=vp9,opus");
    } finally {
      restoreIos();
    }
    const restoreAndroid = stubUA(ANDROID, 5);
    try {
      expect(recorderMimeCandidates()[0]).toBe("video/webm;codecs=vp9,opus");
      expect(recorderMimeCandidates()).toContain("video/mp4;codecs=avc1.42E01E");
    } finally {
      restoreAndroid();
    }
  });
});

describe("trackMatchesRequestedCamera", () => {
  it("accepts a 1x environment track and a track that reports no capabilities", () => {
    const matching = track({
      settings: { facingMode: "environment" },
      capabilities: { zoom: { min: 1, max: 6 } },
    });
    const unknown = track({ settings: {} });
    expect(trackMatchesRequestedCamera(matching, "environment")).toBe(true);
    expect(trackMatchesRequestedCamera(unknown, "environment")).toBe(true);
  });

  it("rejects the wrong facing mode without reading capabilities", () => {
    const front = track({
      settings: { facingMode: "user" },
      capabilitiesThrows: true,
    });
    expect(trackMatchesRequestedCamera(front, "environment")).toBe(false);
  });

  it("rejects a zoom range that cannot represent 1x", () => {
    const tele = track({
      settings: { facingMode: "environment" },
      capabilities: { zoom: { min: 2, max: 10 } },
    });
    const ultra = track({
      settings: { facingMode: "environment" },
      capabilities: { zoom: { min: 0.5, max: 0.8 } },
    });
    expect(trackMatchesRequestedCamera(tele, "environment")).toBe(false);
    expect(trackMatchesRequestedCamera(ultra, "environment")).toBe(false);
  });

  it("treats a partial or throwing capability read as inconclusive", () => {
    const minOnly = track({ settings: { facingMode: "environment" }, capabilities: { zoom: { min: 1 } } });
    const maxOnly = track({ settings: { facingMode: "environment" }, capabilities: { zoom: { max: 1 } } });
    const exploding = track({ settings: {}, capabilitiesThrows: true });
    expect(trackMatchesRequestedCamera(minOnly, "environment")).toBe(true);
    expect(trackMatchesRequestedCamera(maxOnly, "environment")).toBe(true);
    expect(trackMatchesRequestedCamera(exploding, "user")).toBe(true);
  });
});

/** Front camera, then the 1× rear camera — the iOS order the workaround relies on. */
const REAR_PAIR = [
  { kind: "videoinput", deviceId: "front" },
  { kind: "videoinput", deviceId: "wide" },
];

function installMedia(enumerate: unknown, getUserMedia: ReturnType<typeof vi.fn> = vi.fn()): void {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    writable: true,
    value: { enumerateDevices: enumerate, getUserMedia },
  });
}

function installRearPair(getUserMedia: ReturnType<typeof vi.fn>): void {
  installMedia(vi.fn().mockResolvedValue(REAR_PAIR), getUserMedia);
}

describe("selectIosCamera", () => {
  it("returns the original stream off iOS without enumerating", async () => {
    const restore = stubUA(ANDROID, 5);
    const enumerate = vi.fn();
    installMedia(enumerate);
    const original = streamOf(track({ settings: { deviceId: "back" } }));
    try {
      const isStale = vi.fn(() => false);
      await expect(selectIosCamera(original, "environment", isStale)).resolves.toBe(original);
      expect(enumerate).not.toHaveBeenCalled();
      expect(isStale).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it("returns immediately when the acquisition is already stale", async () => {
    const restore = stubUA(IPHONE);
    const enumerate = vi.fn();
    installMedia(enumerate);
    const original = streamOf(track({}));
    try {
      await expect(selectIosCamera(original, "environment", () => true)).resolves.toBe(original);
      expect(enumerate).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it("keeps the facingMode stream when devices cannot be listed", async () => {
    const restore = stubUA(IPHONE);
    const warn = vi.spyOn(logger, "warn");
    const original = streamOf(track({ settings: { deviceId: "env" } }));
    try {
      installMedia(undefined);
      await expect(selectIosCamera(original, "environment", () => false)).resolves.toBe(original);

      installMedia(vi.fn().mockRejectedValue(new Error("enumerate failed")));
      await expect(selectIosCamera(original, "environment", () => false)).resolves.toBe(original);
      expect(warn).toHaveBeenCalledWith("camera_enumerate_failed", { error: "enumerate failed" });
    } finally {
      restore();
    }
  });

  it("does not reopen when the enumerated 1x camera is already open or missing", async () => {
    const restore = stubUA(IPHONE);
    const getUserMedia = vi.fn();
    installRearPair(getUserMedia);
    try {
      const already = streamOf(track({ settings: { deviceId: "wide" } }));
      await expect(selectIosCamera(already, "environment", () => false)).resolves.toBe(already);

      installMedia(vi.fn().mockResolvedValue([{ kind: "videoinput", deviceId: "front" }]), getUserMedia);
      const onlyFront = streamOf(track({ settings: { deviceId: "front" } }));
      await expect(selectIosCamera(onlyFront, "environment", () => false)).resolves.toBe(onlyFront);
      expect(getUserMedia).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it("reopens on the enumerated rear camera and stops the facingMode stream", async () => {
    const restore = stubUA(IPHONE);
    const oldVideo = track({ settings: { deviceId: "ultra" } });
    const oldAudio = track({ settings: {} });
    const nextVideo = track({
      settings: { deviceId: "wide", facingMode: "environment" },
      capabilities: { zoom: { min: 0.5, max: 5 } },
    });
    const next = streamOf(nextVideo);
    let stoppedBeforeOpen = false;
    const getUserMedia = vi.fn().mockImplementation(() => {
      stoppedBeforeOpen = oldVideo.stop.mock.calls.length > 0;
      return Promise.resolve(next);
    });
    installMedia(
      vi.fn().mockResolvedValue([
        { kind: "videoinput", deviceId: "front", label: "Frontkamera" },
        { kind: "videoinput", deviceId: "wide", label: "Rückkamera" },
      ]),
      getUserMedia,
    );
    try {
      const chosen = await selectIosCamera(streamOf(oldVideo, oldAudio), "environment", () => false);
      expect(chosen).toBe(next);
      expect(stoppedBeforeOpen).toBe(true);
      expect(getUserMedia).toHaveBeenCalledWith({
        video: videoConstraints("environment", "wide"),
        audio: AUDIO_CONSTRAINTS,
      });
      expect(oldVideo.stop).toHaveBeenCalled();
      expect(oldAudio.stop).toHaveBeenCalled();
      expect(nextVideo.stop).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it("restores facingMode when the 1x open fails", async () => {
    const restore = stubUA(IPHONE);
    const warn = vi.spyOn(logger, "warn");
    const oldVideo = track({ settings: { deviceId: "ultra" } });
    const fallbackVideo = track({ settings: { deviceId: "env", facingMode: "environment" } });
    const fallback = streamOf(fallbackVideo);
    const getUserMedia = vi.fn().mockRejectedValueOnce("camera busy").mockResolvedValueOnce(fallback);
    installRearPair(getUserMedia);
    try {
      const chosen = await selectIosCamera(streamOf(oldVideo), "environment", () => false);
      expect(oldVideo.stop).toHaveBeenCalled();
      expect(chosen).toBe(fallback);
      expect(getUserMedia).toHaveBeenNthCalledWith(2, {
        video: videoConstraints("environment"),
        audio: AUDIO_CONSTRAINTS,
      });
      expect(warn).toHaveBeenCalledWith("camera_device_reselect_failed", { error: "camera busy" });
    } finally {
      restore();
    }
  });

  it("surfaces an error when the 1x open and the facingMode restore both fail", async () => {
    const restore = stubUA(IPHONE);
    const warn = vi.spyOn(logger, "warn");
    const oldVideo = track({ settings: { deviceId: "ultra" } });
    installRearPair(vi.fn().mockRejectedValueOnce(new Error("busy")).mockRejectedValueOnce(new Error("still busy")));
    try {
      await expect(selectIosCamera(streamOf(oldVideo), "environment", () => false)).rejects.toThrow("still busy");
      expect(oldVideo.stop).toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith("camera_facing_mode_restore_failed", { error: "still busy" });
    } finally {
      restore();
    }
  });

  it("does not restore facingMode when the take went stale during a failed 1x open", async () => {
    const restore = stubUA(IPHONE);
    const oldVideo = track({ settings: { deviceId: "ultra" } });
    let failed = false;
    const getUserMedia = vi.fn().mockImplementation(() => {
      failed = true;
      return Promise.reject(new Error("busy"));
    });
    installRearPair(getUserMedia);
    try {
      await expect(selectIosCamera(streamOf(oldVideo), "environment", () => failed)).rejects.toThrow("busy");
      expect(getUserMedia).toHaveBeenCalledTimes(1);
      expect(oldVideo.stop).toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it("restores facingMode when the reopened camera fails the zoom or facing check", async () => {
    const restore = stubUA(IPHONE);
    const warn = vi.spyOn(logger, "warn");
    const oldVideo = track({ settings: { deviceId: "ultra" } });
    const front = track({ settings: { facingMode: "user", deviceId: "wide" } });
    const tele = track({
      settings: { facingMode: "environment", deviceId: "wide" },
      capabilities: { zoom: { min: 2, max: 10 } },
    });
    const silent = streamOf(undefined, track({}));
    const fallback = streamOf(track({ settings: { facingMode: "environment", deviceId: "env" } }));
    const getUserMedia = vi
      .fn()
      .mockResolvedValueOnce(streamOf(front))
      .mockResolvedValueOnce(fallback)
      .mockResolvedValueOnce(streamOf(tele))
      .mockResolvedValueOnce(fallback)
      .mockResolvedValueOnce(silent)
      .mockResolvedValueOnce(fallback);
    installRearPair(getUserMedia);
    try {
      const original = streamOf(oldVideo);
      await expect(selectIosCamera(original, "environment", () => false)).resolves.toBe(fallback);
      expect(front.stop).toHaveBeenCalled();
      await expect(selectIosCamera(original, "environment", () => false)).resolves.toBe(fallback);
      expect(tele.stop).toHaveBeenCalled();
      await expect(selectIosCamera(original, "environment", () => false)).resolves.toBe(fallback);
      expect(warn).toHaveBeenCalledWith("camera_device_reselect_rejected", {
        facingMode: "environment",
        deviceId: "wide",
      });
    } finally {
      restore();
    }
  });

  it("does not restore facingMode when the take went stale after a rejected lens", async () => {
    const restore = stubUA(IPHONE);
    const oldVideo = track({ settings: { deviceId: "ultra" } });
    const front = track({ settings: { facingMode: "user", deviceId: "wide" } });
    const rejected = streamOf(front);
    let rejectedStopped = false;
    front.stop.mockImplementation(() => {
      rejectedStopped = true;
    });
    const getUserMedia = vi.fn().mockResolvedValue(rejected);
    installRearPair(getUserMedia);
    try {
      const chosen = await selectIosCamera(streamOf(oldVideo), "environment", () => rejectedStopped);
      expect(chosen).toBe(rejected);
      expect(front.stop).toHaveBeenCalled();
      expect(getUserMedia).toHaveBeenCalledTimes(1);
    } finally {
      restore();
    }
  });

  it("does not open a new camera when the take goes stale while the old lens is released", async () => {
    const restore = stubUA(IPHONE);
    const oldVideo = track({ settings: { deviceId: "ultra" } });
    let released = false;
    oldVideo.stop.mockImplementation(() => {
      released = true;
    });
    const getUserMedia = vi.fn();
    installRearPair(getUserMedia);
    try {
      const original = streamOf(oldVideo);
      await expect(selectIosCamera(original, "environment", () => released)).resolves.toBe(original);
      expect(getUserMedia).not.toHaveBeenCalled();
      expect(oldVideo.stop).toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it("stops the original and hands back the new stream when the take went stale mid-open", async () => {
    const restore = stubUA(IPHONE);
    const oldVideo = track({ settings: { deviceId: "ultra" } });
    const nextVideo = track({ settings: { deviceId: "wide", facingMode: "environment" } });
    let opened = false;
    installRearPair(
      vi.fn().mockImplementation(() => {
        opened = true;
        return Promise.resolve(streamOf(nextVideo));
      }),
    );
    try {
      const chosen = await selectIosCamera(streamOf(oldVideo), "environment", () => opened);
      expect(chosen.getVideoTracks()[0]).toBe(nextVideo);
      expect(oldVideo.stop).toHaveBeenCalled();
      expect(nextVideo.stop).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it("returns the original stream if enumeration resolves after the take went stale", async () => {
    const restore = stubUA(IPHONE);
    const getUserMedia = vi.fn();
    const oldVideo = track({ settings: { deviceId: "ultra" } });
    let listed = false;
    installMedia(
      vi.fn().mockImplementation(() => {
        listed = true;
        return Promise.resolve(REAR_PAIR);
      }),
      getUserMedia,
    );
    try {
      const original = streamOf(oldVideo);
      await expect(selectIosCamera(original, "environment", () => listed)).resolves.toBe(original);
      expect(getUserMedia).not.toHaveBeenCalled();
      expect(oldVideo.stop).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });
});

describe("tuneVideoTrack", () => {
  it("logs the settings the camera actually opened", async () => {
    const info = vi.spyOn(logger, "info");
    const opened = track({
      settings: { width: 1920, height: 1080, frameRate: 60, zoom: 1, facingMode: "environment" },
      capabilities: { zoom: { min: 1, max: 4 } },
    });
    await tuneVideoTrack(opened);
    expect(opened.applyConstraints).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith("camera_track_settings", {
      width: 1920,
      height: 1080,
      frameRate: 60,
      zoom: 1,
      facingMode: "environment",
      hold: "landscape",
    });

    const empty = track({});
    await tuneVideoTrack(empty);
    expect(info).toHaveBeenCalledWith("camera_track_settings", {
      width: null,
      height: null,
      frameRate: null,
      zoom: null,
      facingMode: null,
      hold: "landscape",
    });
  });

  it("asks a sub-720p track for 720p30 and does not touch a portrait 1080p track", async () => {
    const small = track({ settings: { width: 640, height: 480, frameRate: 30 } });
    await tuneVideoTrack(small);
    expect(small.applyConstraints).toHaveBeenCalledWith({
      width: { ideal: 1280 },
      height: { ideal: 720 },
      aspectRatio: { ideal: 16 / 9 },
      frameRate: { ideal: 30 },
    });

    const square = track({ settings: { width: 1000, height: 1000 } });
    await tuneVideoTrack(square);
    expect(square.applyConstraints).toHaveBeenCalledWith(expect.objectContaining({ width: { ideal: 1280 } }));

    const portrait = track({ settings: { width: 1080, height: 1920, frameRate: 30 } });
    await tuneVideoTrack(portrait);
    expect(portrait.applyConstraints).not.toHaveBeenCalled();

    const widthOnly = track({ settings: { width: 1920 } });
    await tuneVideoTrack(widthOnly);
    expect(widthOnly.applyConstraints).not.toHaveBeenCalled();

    const tall = track({ settings: { width: 480, height: 640 } });
    await tuneVideoTrack(tall);
    expect(tall.applyConstraints).toHaveBeenCalledWith({
      width: { ideal: 720 },
      height: { ideal: 1280 },
      aspectRatio: { ideal: 720 / 1280 },
      frameRate: { ideal: 30 },
    });
  });

  it("replaces a 9:16 sensor slice with the full 16:9 preset", async () => {
    const warn = vi.spyOn(logger, "warn");
    const sensor = { width: { max: 1920 }, height: { max: 1080 } };
    const sliced = track({ settings: { width: 608, height: 1080 }, capabilities: sensor });
    const rotated = track({ settings: { width: 1080, height: 1920 }, capabilities: sensor });
    const fourK = track({
      settings: { width: 1080, height: 1920 },
      capabilities: { width: { max: 3840 }, height: { max: 2160 } },
    });
    const sliceOfFourK = track({
      settings: { width: 1215, height: 2160 },
      capabilities: { width: { max: 3840 }, height: { max: 2160 } },
    });
    const squareCaps = track({
      settings: { width: 1080, height: 1920 },
      capabilities: { width: { max: 1920 }, height: { max: 1920 } },
    });
    const landscape = track({ settings: { width: 1920, height: 1080 }, capabilities: sensor });
    const unknown = track({ settings: { width: 608, height: 1080 } });
    const exploding = track({ settings: { width: 608, height: 1080 }, capabilitiesThrows: true });
    const zeroMax = track({
      settings: { width: 608, height: 1080 },
      capabilities: { width: { max: 0 }, height: { max: 1080 } },
    });
    const almostSquare = track({
      settings: { width: 1000, height: 1080 },
      capabilities: sensor,
    });
    expect(portraitFrameIsSensorCrop(sliced)).toBe(true);
    expect(portraitFrameIsSensorCrop(rotated)).toBe(false);
    expect(portraitFrameIsSensorCrop(fourK)).toBe(false);
    expect(portraitFrameIsSensorCrop(sliceOfFourK)).toBe(true);
    expect(portraitFrameIsSensorCrop(squareCaps)).toBe(false);
    expect(portraitFrameIsSensorCrop(landscape)).toBe(false);
    expect(portraitFrameIsSensorCrop(unknown)).toBe(false);
    expect(portraitFrameIsSensorCrop(exploding)).toBe(false);
    expect(portraitFrameIsSensorCrop(zeroMax)).toBe(false);
    expect(portraitFrameIsSensorCrop(almostSquare)).toBe(false);
    expect(portraitFrameIsSensorCrop(track({}))).toBe(false);
    expect(
      portraitFrameIsSensorCrop(
        track({
          settings: { width: 608, height: 1080 },
          capabilities: { width: { max: 1200 }, height: { max: 1080 } },
        }),
      ),
    ).toBe(false);

    await tuneVideoTrack(sliced);
    expect(sliced.applyConstraints).toHaveBeenCalledWith({
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      aspectRatio: { ideal: 16 / 9 },
      frameRate: { ideal: 60 },
    });
    expect(warn).toHaveBeenCalledWith("camera_portrait_crop_rejected", { width: 608, height: 1080 });

    const rejected = track({
      settings: { width: 608, height: 1080 },
      capabilities: sensor,
      apply: () => Promise.reject(new Error("preset rejected")),
    });
    await tuneVideoTrack(rejected);
    expect(warn).toHaveBeenCalledWith("camera_portrait_crop_fallback_failed", { error: "preset rejected" });
  });

  it("locks zoom to 1 and leaves a lens that cannot represent 1x alone", async () => {
    const warn = vi.spyOn(logger, "warn");
    const zoomed = track({
      settings: { width: 1920, height: 1080, zoom: 2.5 },
      capabilities: { zoom: { min: 1, max: 8 } },
    });
    await tuneVideoTrack(zoomed);
    expect(zoomed.applyConstraints).toHaveBeenCalledWith({ advanced: [{ zoom: 1 }] });

    const tele = track({
      settings: { width: 1920, height: 1080 },
      capabilities: { zoom: { min: 2, max: 10 } },
    });
    await tuneVideoTrack(tele);
    expect(tele.applyConstraints).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith("camera_zoom_not_1x", { min: 2, max: 10 });

    const ultra = track({
      settings: { width: 1920, height: 1080 },
      capabilities: { zoom: { min: 0.4, max: 0.9 } },
    });
    await tuneVideoTrack(ultra);
    expect(warn).toHaveBeenCalledWith("camera_zoom_not_1x", { min: 0.4, max: 0.9 });
  });

  it("still logs when the resolution upgrade or the zoom lock is rejected", async () => {
    const warn = vi.spyOn(logger, "warn");
    const info = vi.spyOn(logger, "info");
    const small = track({
      settings: { width: 320, height: 240 },
      apply: () => Promise.reject(new Error("resize failed")),
    });
    await tuneVideoTrack(small);
    expect(warn).toHaveBeenCalledWith("camera_resolution_fallback_failed", { error: "resize failed" });
    expect(info).toHaveBeenCalledWith("camera_track_settings", expect.any(Object));

    const zoomed = track({
      settings: { width: 1920, height: 1080, zoom: 3 },
      capabilities: { zoom: { min: 1, max: 5 } },
      apply: () => Promise.reject("zoom rejected"),
    });
    await tuneVideoTrack(zoomed);
    expect(warn).toHaveBeenCalledWith("camera_zoom_lock_failed", { error: "zoom rejected" });
  });
});

describe("logPreviewPlayError", () => {
  afterEach(() => vi.restoreAllMocks());

  it("ignores AbortError from a superseded load", () => {
    const warn = vi.spyOn(logger, "warn");
    logPreviewPlayError(new DOMException("The play() request was interrupted", "AbortError"));
    expect(warn).not.toHaveBeenCalled();
  });

  it("logs other play() failures by name", () => {
    const warn = vi.spyOn(logger, "warn");
    logPreviewPlayError(new DOMException("blocked", "NotAllowedError"));
    expect(warn).toHaveBeenCalledWith("camera_preview_play_failed", { name: "NotAllowedError", error: "blocked" });
  });

  it("logs non-Error rejections as unknown", () => {
    const warn = vi.spyOn(logger, "warn");
    logPreviewPlayError("nope");
    expect(warn).toHaveBeenCalledWith("camera_preview_play_failed", { name: "unknown", error: "nope" });
    logPreviewPlayError({ name: 42 });
    expect(warn).toHaveBeenLastCalledWith("camera_preview_play_failed", { name: "unknown", error: "[object Object]" });
  });
});
