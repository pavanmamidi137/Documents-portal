"use client";

import { useEffect, useRef } from "react";

interface SwipeOptions {
  onSwipeRight?: () => void;
  onSwipeLeft?: () => void;
  /** Min horizontal travel (px) before a swipe counts. */
  threshold?: number;
  /** Horizontal/vertical ratio required so vertical scrolls are ignored. */
  angleRatio?: number;
  /** Only track swipes that start within this many px of the left edge. */
  edgeOnlyLeft?: boolean;
  edgeWidth?: number;
}

/**
 * Pointer-based swipe detection for the mobile sidebar:
 *   - swipe RIGHT (finger drags from left to right) -> onSwipeRight (open)
 *   - swipe LEFT  (finger drags right to left)      -> onSwipeLeft  (close)
 *
 * Vertical scroll gestures are ignored (the gesture must be mostly
 * horizontal). Multi-touch is ignored so pinch-zoom and two-finger scroll
 * still work untouched.
 */
export function useSwipe(options: SwipeOptions) {
  const optsRef = useRef<SwipeOptions>(options);

  // Keep the latest options without re-attaching listeners on every render.
  useEffect(() => {
    optsRef.current = options;
  }, [options]);

  useEffect(() => {
    let activePointer = 0;
    let startX = 0;
    let startY = 0;

    const onPointerDown = (e: PointerEvent) => {
      const opts = optsRef.current;
      // Ignore non-primary pointers (multi-touch) and swipes that begin inside
      // the open sidebar (it has its own drag-to-close via framer-motion).
      if (!e.isPrimary) return;
      if (opts.edgeOnlyLeft && e.clientX > (opts.edgeWidth ?? 0)) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("[data-sidebar-swipe]")) return;
      activePointer = e.pointerId;
      startX = e.clientX;
      startY = e.clientY;
    };

    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerId !== activePointer) return;
      const opts = optsRef.current;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      activePointer = 0;

      // Mostly-horizontal check: |dx| must dominate |dy| so vertical scrolls
      // and long-press drags are never treated as swipes.
      const angleRatio = opts.angleRatio ?? 1.4;
      if (Math.abs(dy) * angleRatio > Math.abs(dx)) return;

      const threshold = opts.threshold ?? 64;
      if (dx >= threshold) opts.onSwipeRight?.();
      else if (dx <= -threshold) opts.onSwipeLeft?.();
    };

    // A canceled gesture (scroll taking over, pointer capture lost) must not
    // trigger a swipe.
    const onPointerCancel = () => {
      activePointer = 0;
    };

    // Only attach on touch/pen-capable devices - the mouse shouldn't swipe
    // the sidebar open and fight text selection.
    const supportsPointer = window.matchMedia("(pointer: coarse)").matches;
    if (!supportsPointer) return;

    window.addEventListener("pointerdown", onPointerDown, { passive: true });
    window.addEventListener("pointerup", onPointerUp, { passive: true });
    window.addEventListener("pointercancel", onPointerCancel, { passive: true });
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
    };
  }, []);
}
