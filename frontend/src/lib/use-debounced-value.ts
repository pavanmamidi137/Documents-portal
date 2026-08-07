"use client";

import { useEffect, useState } from "react";

/**
 * Returns `value` after it has been stable for `delayMs`. Use this for search
 * inputs so typing doesn't fire one network request per keystroke.
 */
export function useDebouncedValue<T>(value: T, delayMs = 350): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);

  return debounced;
}
