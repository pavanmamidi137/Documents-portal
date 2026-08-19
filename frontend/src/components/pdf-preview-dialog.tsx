"use client";

import { useState } from "react";
import { ExternalLink, Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface PdfPreviewDialogProps {
  url: string;
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PdfPreviewDialog({
  url,
  title,
  open,
  onOpenChange,
}: PdfPreviewDialogProps) {
  const [loading, setLoading] = useState(true);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] max-w-5xl flex-col p-0">
        <DialogHeader className="flex flex-row items-center justify-between border-b px-4 py-3">
          <DialogTitle className="truncate pr-4 text-sm font-medium">
            {title}
          </DialogTitle>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              size="icon"
              variant="ghost"
              className="size-8"
              title="Open in new tab"
              onClick={() => window.open(url, "_blank", "noopener")}
            >
              <ExternalLink className="size-4" />
            </Button>
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
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center">
              <Loader2 className="size-6 animate-spin text-primary" />
            </div>
          )}
          <iframe
            src={url}
            title={title}
            className="h-full w-full border-0"
            onLoad={() => setLoading(false)}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
