"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { CalendarClock, Eye, FileText, RotateCcw, Share2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { getDocumentTypeMeta } from "@/lib/document-types";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { http } from "@/lib/api";
import type { DocumentItem } from "@/lib/types";
import { cn, formatBytes, formatDate, getErrorMessage } from "@/lib/utils";
import { DocumentTextDialog } from "./document-text-dialog";
import { PdfPreviewDialog } from "@/components/pdf-preview-dialog";

interface Props {
  document: DocumentItem;
  index?: number;
  canDelete?: boolean;
  onDeleted?: (id: number) => void;
  /** When true the card shows a checkbox and a click toggles selection. */
  selecting?: boolean;
  selected?: boolean;
  onToggleSelect?: (id: number) => void;
}

export function DocumentCard({
  document,
  index = 0,
  canDelete = false,
  onDeleted,
  selecting = false,
  selected = false,
  onToggleSelect,
}: Props) {
  const [textOpen, setTextOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const isPdf = document.file_name.toLowerCase().endsWith(".pdf");

  const handleCardClick = (e: React.MouseEvent) => {
    if (!selecting) return;
    const target = e.target as HTMLElement;
    if (target.closest("button, a, label")) return;
    onToggleSelect?.(document.id);
  };

  const typeMeta = getDocumentTypeMeta(document.file_name);
  const FileIcon = typeMeta.Icon;

  const handleDelete = async () => {
    try {
      await http.delete(`/documents/${document.id}/`);
      toast.success("Document deleted (removed from Cloudinary too).");
      onDeleted?.(document.id);
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.04 }}
      onClick={handleCardClick}
      className={cn(
        "group relative flex min-w-0 flex-col rounded-xl border bg-card p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md",
        selecting && "cursor-pointer hover:border-primary/40",
        selected && "border-primary/50 bg-primary/5 ring-1 ring-primary/30"
      )}
    >
      {selecting && (
        <div className="absolute top-3 right-3 z-10">
          <Checkbox
            checked={selected}
            onCheckedChange={() => onToggleSelect?.(document.id)}
            onClick={(e) => e.stopPropagation()}
            aria-label={`Select ${document.title}`}
            className="data-[state=checked]:border-primary data-[state=checked]:bg-primary"
          />
        </div>
      )}

      <div className="flex items-start gap-3">
        <div className={`flex size-11 shrink-0 items-center justify-center rounded-lg ring-1 ${typeMeta.classes}`}>
          <FileIcon className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p
            className="line-clamp-2 font-semibold [overflow-wrap:anywhere] [word-break:break-word] sm:line-clamp-1"
            title={document.title}
          >
            {document.title}
          </p>
          <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground [overflow-wrap:anywhere] [word-break:break-word]">
            {document.file_name}
          </p>
        </div>
      </div>

      <div className="mt-3 flex min-w-0 flex-wrap gap-1.5">
        <Badge variant="secondary" className="max-w-full text-[11px]">
          <span className="block max-w-full truncate">{document.subject_name}</span>
        </Badge>
        <Badge variant="outline" className="max-w-full text-[11px]">
          <span className="block max-w-full truncate">{document.category_name}</span>
        </Badge>
        <Badge variant="outline" className="text-[11px]">
          {document.semester_name}
        </Badge>
        {document.restored_at && (
          <Badge
            variant="outline"
            className="gap-1 border-emerald-500/30 bg-emerald-500/10 text-[11px] text-emerald-600 dark:text-emerald-400"
            title="This file was deleted in Cloudinary and restored recently."
          >
            <RotateCcw className="size-3" /> Restored
          </Badge>
        )}
        {document.submission_deadline && (
          <Badge
            variant="outline"
            className="gap-1 border-rose-500/30 bg-rose-500/10 text-[11px] text-rose-600 dark:text-rose-400"
            title="Last date to submit this assignment"
          >
            <CalendarClock className="size-3" /> Submit by {formatDate(document.submission_deadline)}
          </Badge>
        )}
        {document.ocr_status === "COMPLETE" && (
          <Badge
            variant="outline"
            className="gap-1 border-sky-500/30 bg-sky-500/10 text-[11px] text-sky-600 dark:text-sky-400"
            title='Readable text is available - click "Read text" to view it.'
          >
            <FileText className="size-3" /> Text
          </Badge>
        )}
        {document.sections && document.sections.length > 0 && (
          <Badge
            variant="outline"
            className="max-w-full gap-1 text-[11px]"
            title={`Shared to sections: ${document.sections.join(", ")}`}
          >
            <Share2 className="size-3 shrink-0" />
            <span className="block max-w-full truncate">
              {document.section_count} section{document.section_count === 1 ? "" : "s"}{" "}
              ({document.sections.join(", ")})
            </span>
          </Badge>
        )}
      </div>

      <div className="mt-3 flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="shrink-0">{formatBytes(document.file_size)}</span>
        <span className="truncate text-right">{formatDate(document.created_at)}</span>
      </div>

      {/* Buttons stack full-width on mobile, side-by-side from sm up. */}
      <div className="mt-4 flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:gap-2">
        <Button
          size="sm"
          variant="outline"
          className="w-full whitespace-nowrap sm:w-auto sm:min-w-28 sm:flex-1"
          onClick={(e) => {
            e.stopPropagation();
            setPreviewOpen(true);
          }}
        >
          <Eye className="size-3.5" /> Preview
        </Button>
        {/* Secondary actions sit side-by-side on mobile, inline on desktop. */}
        <div className="grid min-w-0 grid-cols-2 gap-2 sm:flex sm:contents">
          {isPdf && (
            <Button
              size="sm"
              variant="outline"
              className="w-full shrink-0 justify-center gap-1.5 sm:w-auto sm:size-8 sm:gap-0"
              title="Extract readable text from this PDF (OCR for scanned files)"
              onClick={(e) => {
                e.stopPropagation();
                setTextOpen(true);
              }}
            >
              <FileText className="size-3.5" />
              <span className="sm:hidden">Read text</span>
            </Button>
          )}
          {canDelete && (
            <Button
              size="sm"
              variant="ghost"
              className="w-full shrink-0 justify-center gap-1.5 text-destructive hover:text-destructive sm:w-auto sm:size-8 sm:gap-0"
              onClick={(e) => {
                e.stopPropagation();
                handleDelete();
              }}
            >
              <Trash2 className="size-3.5" />
              <span className="sm:hidden">Delete</span>
            </Button>
          )}
        </div>
      </div>

      <PdfPreviewDialog
        url={document.cloudinary_url}
        title={document.title}
        open={previewOpen}
        onOpenChange={setPreviewOpen}
      />
      <DocumentTextDialog document={document} open={textOpen} onOpenChange={setTextOpen} />
    </motion.div>
  );
}
