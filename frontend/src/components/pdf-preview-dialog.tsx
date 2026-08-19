"use client";

import { useEffect, useRef, useState } from "react";
import { ExternalLink, Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { http } from "@/lib/api";

interface PdfPreviewDialogProps {
  /** API path to fetch (with auth), e.g. "/resumes/15/preview/" */
  apiPath?: string;
  /** Direct URL (no auth needed), e.g. Cloudinary URL */
  directUrl?: string;
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PdfPreviewDialog({
  apiPath,
  directUrl,
  title,
  open,
  onOpenChange,
}: PdfPreviewDialogProps) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const prevOpen = useRef(false);

  const needsAuth = !!apiPath;
  const readyUrl = directUrl && !needsAuth ? directUrl : blobUrl;

  // Fetch the document as a blob when the dialog opens (needs auth headers
  // which an <iframe> can't send).  Clean up the object URL on close.
  useEffect(() => {
    if (!open) {
      prevOpen.current = false;
      return;
    }
    // Direct URL (Cloudinary) — no fetch needed.
    if (directUrl && !needsAuth) {
      setLoading(false);
      return;
    }
    // Prevent re-fetching if already loaded this session.
    if (prevOpen.current && blobUrl) return;
    prevOpen.current = true;
    setLoading(true);
    setError(false);

    let cancelled = false;
    (async () => {
      try {
        const blob = await http.blob(apiPath!);
        if (cancelled) return;
        const typed = new Blob([blob], { type: blob.type || "application/pdf" });
        const url = URL.createObjectURL(typed);
        setBlobUrl(url);
        setLoading(false);
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, apiPath, directUrl, needsAuth, blobUrl]);

  // Clean up blob URL when dialog closes.
  useEffect(() => {
    if (!open && blobUrl) {
      URL.revokeObjectURL(blobUrl);
      setBlobUrl(null);
    }
  }, [open, blobUrl]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] max-w-5xl flex-col p-0">
        <DialogHeader className="flex flex-row items-center justify-between border-b px-4 py-3">
          <DialogTitle className="truncate pr-4 text-sm font-medium">
            {title}
          </DialogTitle>
          <div className="flex shrink-0 items-center gap-1">
            {readyUrl && (
              <Button
                size="icon"
                variant="ghost"
                className="size-8"
                title="Open in new tab"
                onClick={() => window.open(readyUrl, "_blank", "noopener")}
              >
                <ExternalLink className="size-4" />
              </Button>
            )}
            <Button
              size="icon"
              variant="ghost"
              className="size-8"
              onClick={() => onOpenChange(false)}
            >
              <X className="size-4" />
            </Button>
          </div>
        </DialogHeader>
        <div className="relative min-h-[60vh] flex-1 overflow-hidden rounded-b-lg bg-muted/30">
          {(loading || !readyUrl) && !error && (
            <div className="absolute inset-0 flex items-center justify-center">
              <Loader2 className="size-6 animate-spin text-primary" />
            </div>
          )}
          {error && (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-destructive">
              Failed to load preview. Try opening in a new tab.
            </div>
          )}
          {readyUrl && (
            <iframe
              src={readyUrl}
              title={title}
              className="h-full w-full border-0"
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
