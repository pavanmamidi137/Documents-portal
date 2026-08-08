"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Repeat } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { ShareRequestsDialog, usePendingShareRequests } from "./share-fork-dialogs";

/**
 * Global notification bell for CRs: shows how many sections are waiting for
 * this CR to accept a shared document. Clicking it opens the accept/decline
 * dialog.
 */
export function ShareRequestBell() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const canSee = Boolean(user?.is_cr);
  const { data } = usePendingShareRequests(canSee);
  // The query is filtered to PENDING server-side, so `count` is accurate.
  const pendingCount = data?.count ?? (data?.results ?? []).length;

  if (!canSee) return null;

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setOpen(true)}
        aria-label={`Document share requests${pendingCount > 0 ? ` (${pendingCount} pending)` : ""}`}
        title="Share requests (send & receive)"
        className="relative text-muted-foreground"
      >
        <Repeat className="size-5" />
        {pendingCount > 0 && (
          <span className="absolute top-1 right-1 flex size-4 min-w-4 items-center justify-center rounded-full bg-primary px-0.5 text-[9px] font-bold text-primary-foreground">
            {pendingCount > 9 ? "9+" : pendingCount}
          </span>
        )}
      </Button>

      <ShareRequestsDialog
        open={open}
        onOpenChange={setOpen}
        onResponded={() => {
          // The dialog already invalidates the share-request lists; refresh
          // the documents list here (an accepted copy just appeared).
          queryClient.invalidateQueries({ queryKey: ["documents"] });
        }}
      />
    </>
  );
}
