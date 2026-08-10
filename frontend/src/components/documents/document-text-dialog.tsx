"use client";

import { useEffect, useState } from "react";
import { Check, Copy, FileText, Loader2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { http } from "@/lib/api";
import type { DocumentItem } from "@/lib/types";
import { getErrorMessage } from "@/lib/utils";

interface ExtractResult {
  ocr_status: "NONE" | "PENDING" | "COMPLETE" | "FAILED";
  ocr_text?: string;
  ocr_error?: string;
}

interface Props {
  document: DocumentItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Extracts (and caches server-side) the readable text from a document PDF.
 * Text-based PDFs are read for free; scanned PDFs are OCR'd via AI and the
 * result is saved, so reopening a document never re-runs the AI.
 */
export function DocumentTextDialog({ document, open, onOpenChange }: Props) {
  // The dialog (and its state) unmounts whenever it closes, so result is always
  // fresh on open and ``loading`` is derived from it - no sync setState needed.
  const [result, setResult] = useState<ExtractResult | null>(null);
  const [copied, setCopied] = useState(false);
  const loading = result === null;

  useEffect(() => {
    if (!open || !document) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await http.post<ExtractResult>(
          `/documents/${document.id}/extract_text/`
        );
        if (cancelled) return;
        setResult(data);
        if (data.ocr_status !== "COMPLETE") {
          toast.error(data.ocr_error || "Text extraction failed.");
        }
      } catch (error) {
        if (cancelled) return;
        toast.error(getErrorMessage(error));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, document?.id]);

  const copyText = async () => {
    if (!result?.ocr_text) return;
    try {
      await navigator.clipboard.writeText(result.ocr_text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Could not copy the text.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="size-5 text-primary" /> {document?.title ?? "Document text"}
          </DialogTitle>
          <DialogDescription className="line-clamp-1">
            {document?.file_name} · text extracted from the PDF
            {result?.ocr_status === "COMPLETE" ? " · saved for offline search" : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin text-primary" />
              Extracting text — scanned pages may take a few seconds…
            </div>
          ) : result?.ocr_status === "COMPLETE" ? (
            <div className="flex h-full min-h-0 flex-col gap-3">
              <pre className="max-h-[50vh] min-h-0 flex-1 overflow-auto rounded-xl border bg-muted/40 p-4 text-sm leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">
                {result.ocr_text || "(no text found in this PDF)"}
              </pre>
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="outline" onClick={copyText} disabled={!result.ocr_text}>
                  {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
                  {copied ? "Copied" : "Copy text"}
                </Button>
              </div>
            </div>
          ) : result?.ocr_status === "FAILED" ? (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center">
              <TriangleAlert className="size-6 text-destructive" />
              <p className="text-sm font-medium">The text could not be extracted</p>
              <p className="text-xs text-muted-foreground">
                {result.ocr_error || "The PDF could not be read. Try opening the file directly instead."}
              </p>
            </div>
          ) : (
            <div className="flex justify-center py-16 text-sm text-muted-foreground">
              No text available yet.
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
