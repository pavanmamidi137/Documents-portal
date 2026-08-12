"use client";

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { http } from "@/lib/api";

interface CheckFilesResponse {
  checked: number;
  missing_ids: number[];
  restored_ids: number[];
}

/**
 * When a file is deleted directly in Cloudinary (outside the portal), this
 * hook verifies the current list's files against Cloudinary and removes the
 * deleted ones from the view the moment the page loads - no refetch needed.
 *
 * Files that were previously deleted and have come back (restored in
 * Cloudinary) are refetched so they reappear, and a "Restored" marker is
 * returned by the API so the UI can badge them.
 *
 * Throttled to once per minute (the backend only re-checks files that have
 * not been verified for 60s anyway), so rapid filter/search/pagination
 * changes do not fire a Cloudinary API round-trip on every keystroke.
 */
const THROTTLE_MS = 60_000;

export function useCloudinaryCheck<T extends { id: number }>({
  url,
  params,
  queryKey,
  kind,
  invalidateOnMissing = false,
}: {
  url: string;
  params: Record<string, unknown>;
  queryKey: readonly unknown[];
  kind: string;
  /**
   * Grouped views show one row per file (which is many copies), so dropping
   * rows by id can't remove the right row and would miscount. Instead of the
   * optimistic filter the hook refetches so the server rebuilds the groups
   * without the missing copies.
   */
  invalidateOnMissing?: boolean;
}) {
  const queryClient = useQueryClient();
  const lastRunRef = useRef(0);
  const key = JSON.stringify(queryKey);

  useEffect(() => {
    const now = Date.now();
    if (now - lastRunRef.current < THROTTLE_MS) return;
    lastRunRef.current = now;
    let cancelled = false;

    (async () => {
      try {
        const res = await http.get<CheckFilesResponse>(url, params);
        if (cancelled) return;
        if (res.missing_ids.length > 0) {
          if (invalidateOnMissing) {
            // Grouped view: a row represents many copies - let the server
            // rebuild the groups without the missing copies (and re-scope the
            // section badges) instead of guessing which row to drop.
            queryClient.invalidateQueries({ queryKey });
          } else {
            const ids = new Set(res.missing_ids);
            // Drop the missing rows from the current view without a server refetch
            // (they are excluded server-side on the next fetch anyway).
            queryClient.setQueryData<{ count: number; results: T[] }>(queryKey, (old) =>
              old
                ? {
                    ...old,
                    count: Math.max(0, old.count - ids.size),
                    results: old.results.filter((r) => !ids.has(r.id)),
                  }
                : old
            );
          }
          toast.info(
            `${res.missing_ids.length} ${kind}${res.missing_ids.length === 1 ? "" : "s"} were deleted from Cloudinary and removed from this view.`
          );
        }
        if (res.restored_ids.length > 0) {
          // Restored rows are not in the current cached page (they were
          // excluded while missing) - refetch so they reappear.
          queryClient.invalidateQueries({ queryKey });
          toast.success(
            `${res.restored_ids.length} ${kind}${res.restored_ids.length === 1 ? "" : "s"} were restored in Cloudinary and are back in the list.`
          );
        }
      } catch {
        // The check is best-effort - never block the page on it.
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, url]);
}
