/**
 * Scroll-snap index for the full-screen feed.
 *
 * The scroller is the source of truth: wheel, trackpad, and touch move it,
 * and we mirror the snapped page into `activeIndex`. Arrow keys do the same
 * move from the desktop. Voting never calls this — a verdict must not advance.
 */

import { useCallback, useEffect, useRef, useState } from "react";

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable;
}

export function useVerticalFeed(slideCount: number, onPastEnd: () => void) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const activeRef = useRef(0);
  const onPastEndRef = useRef(onPastEnd);
  const scrollCleanup = useRef<(() => void) | null>(null);
  useEffect(() => {
    onPastEndRef.current = onPastEnd;
  }, [onPastEnd]);

  const scrollToIndex = useCallback((index: number) => {
    const root = scrollerRef.current;
    const slides = root?.querySelectorAll<HTMLElement>("[data-feed-slide]");
    const next = slides?.[index];
    activeRef.current = index;
    setActiveIndex(index);
    next?.scrollIntoView?.({ block: "start" });
  }, []);

  // Callback ref so the scroll listener attaches when the scroller mounts,
  // which is after the first paint (the list waits on both fetches).
  const setScroller = useCallback((node: HTMLDivElement | null) => {
    scrollCleanup.current?.();
    scrollCleanup.current = null;
    scrollerRef.current = node;
    if (!node) return;
    const onScroll = () => {
      const height = node.clientHeight;
      if (height <= 0) return;
      const count = node.querySelectorAll("[data-feed-slide]").length;
      if (count <= 0) return;
      const idx = Math.max(0, Math.min(count - 1, Math.round(node.scrollTop / height)));
      if (idx === activeRef.current) return;
      activeRef.current = idx;
      setActiveIndex(idx);
    };
    node.addEventListener("scroll", onScroll, { passive: true });
    scrollCleanup.current = () => node.removeEventListener("scroll", onScroll);
  }, []);

  const move = useCallback(
    (delta: number) => {
      const root = scrollerRef.current;
      const count = root?.querySelectorAll("[data-feed-slide]").length ?? slideCount;
      if (count <= 0) return;
      const current = Math.max(0, Math.min(count - 1, activeRef.current));
      if (delta > 0 && current >= count - 1) {
        onPastEndRef.current();
        return;
      }
      const next = Math.max(0, Math.min(count - 1, current + delta));
      if (next === current) return;
      scrollToIndex(next);
    },
    [scrollToIndex, slideCount],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      if (event.altKey || event.metaKey || event.ctrlKey) return;
      if (isTypingTarget(event.target)) return;
      if (document.querySelector("[role='dialog']")) return;
      event.preventDefault();
      move(event.key === "ArrowDown" ? 1 : -1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [move]);

  // A reported clip or a finished dispute load can shrink the list under us.
  useEffect(() => {
    if (slideCount <= 0) return;
    if (activeRef.current <= slideCount - 1) return;
    scrollToIndex(slideCount - 1);
  }, [slideCount, scrollToIndex]);

  const reset = useCallback(() => {
    scrollToIndex(0);
    const root = scrollerRef.current;
    if (root) root.scrollTop = 0;
  }, [scrollToIndex]);

  return { setScroller, activeIndex, scrollToIndex, reset };
}
