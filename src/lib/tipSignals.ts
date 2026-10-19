/**
 * Tiny external store the Hesher tips host listens to:
 *  - zones: a sheet or widget that is not its own route (Add Spot, the 360
 *    shoe) registers a tip-set id while it is open; the newest zone wins.
 *  - cameraLive: the recorder is previewing or recording. Tips never paint
 *    over the camera (or its crosshair) while this is true.
 */
import { useEffect, useSyncExternalStore } from "react";

let zones: string[] = [];
let cameraLive = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

export function subscribeTipSignals(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function enterTipZone(id: string): () => void {
  zones = [...zones, id];
  emit();
  return () => {
    const i = zones.lastIndexOf(id);
    if (i !== -1) zones = [...zones.slice(0, i), ...zones.slice(i + 1)];
    emit();
  };
}

export function getActiveTipZone(): string | null {
  return zones.length ? zones[zones.length - 1] : null;
}

export function setCameraLive(live: boolean): void {
  if (cameraLive === live) return;
  cameraLive = live;
  emit();
}

export function isCameraLive(): boolean {
  return cameraLive;
}

/** Register a tip zone while the calling component is mounted. */
export function useTipZone(id: string): void {
  useEffect(() => enterTipZone(id), [id]);
}

export function useActiveTipZone(): string | null {
  return useSyncExternalStore(subscribeTipSignals, getActiveTipZone);
}

export function useCameraLive(): boolean {
  return useSyncExternalStore(subscribeTipSignals, isCameraLive);
}

/** @internal test reset */
export function resetTipSignals(): void {
  zones = [];
  cameraLive = false;
  emit();
}

/** Render-nothing marker for branches that should register a tip zone. */
export function TipZone({ id }: { id: string }): null {
  useTipZone(id);
  return null;
}

/** Publish the recorder's camera state while the caller is mounted. */
export function useCameraLiveSignal(live: boolean): void {
  useEffect(() => {
    setCameraLive(live);
    return () => setCameraLive(false);
  }, [live]);
}
