import { useEffect, useRef, useState } from "react";

/** An already-posted clip to re-open in the editor (own profile → Edit). */
export interface InitialClip {
  videoUrl: string;
  trickName: string;
}

/**
 * Downloads `clip` once and stages it as if it had just been recorded, so the
 * edit-first flow opens the editor on it. Returns a load error, if any.
 */
export function useInitialClip(
  clip: InitialClip | undefined,
  stage: (blob: Blob) => void,
  setTrickName: (name: string) => void,
): string {
  const [error, setError] = useState("");
  const started = useRef(false);
  useEffect(() => {
    if (!clip || started.current) return;
    started.current = true;
    void (async () => {
      try {
        const res = await fetch(clip.videoUrl);
        if (!res.ok) throw new Error(String(res.status));
        stage(await res.blob());
        setTrickName(clip.trickName);
      } catch {
        setError("Couldn't load that clip. Check your connection and try again.");
      }
    })();
  }, [clip, stage, setTrickName]);
  return error;
}
