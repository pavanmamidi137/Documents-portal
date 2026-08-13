"use client";

import { useSyncExternalStore } from "react";

const MOBILE_BREAKPOINT = 768;

function subscribe(onStoreChange: () => void) {
  const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`);
  mql.addEventListener("change", onStoreChange);
  return () => mql.removeEventListener("change", onStoreChange);
}

function getSnapshot() {
  return window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`).matches;
}

/** Server + first paint always renders the desktop layout to avoid a flash. */
function getServerSnapshot() {
  return false;
}

/**
 * True when the viewport is phone-sized (< 768px). Reactively updates when the
 * window is resized or rotated. Safe to use in "use client" components - the
 * server snapshot keeps SSR deterministic.
 */
export function useIsMobile() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
