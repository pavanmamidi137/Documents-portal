"use client";

import { motion } from "framer-motion";
import { Download, Eye, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { getDocumentTypeMeta } from "@/lib/document-types";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { http } from "@/lib/api";
import type { DocumentItem } from "@/lib/types";
import { cn, formatBytes, formatDate, getErrorMessage } from "@/lib/utils";

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
  const handleCardClick = (e: React.MouseEvent) => {
    if (!selecting) return;
    const target = e.target as HTMLElement;
    if (target.closest("button, a, label")) return;
    onToggleSelect?.(document.id);
  };

  const typeMeta = getDocumentTypeMeta(document.file_name);
  const FileIcon = typeMeta.Icon;

  const handleDownload = async () => {
    try {
      const res = await http.post<{ download_url: string }>(`/documents/${document.id}/download/`);
      window.open(res.download_url, "_blank", "noopener");
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

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
        "group relative flex flex-col rounded-xl border bg-card p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md",
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
          <p className="truncate font-semibold" title={document.title}>
            {document.title}
          </p>
          <p className="truncate text-xs text-muted-foreground">{document.file_name}</p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <Badge variant="secondary" className="text-[11px]">
          {document.subject_name}
        </Badge>
        <Badge variant="outline" className="text-[11px]">
          {document.category_name}
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
      </div>

      <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
        <span>{formatBytes(document.file_size)}</span>
        <span>{formatDate(document.created_at)}</span>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          className="flex-1"
          onClick={(e) => {
            e.stopPropagation();
            window.open(document.cloudinary_url, "_blank", "noopener");
          }}
        >
          <Eye className="size-3.5" /> Preview
        </Button>
        <Button
          size="sm"
          className="flex-1"
          onClick={(e) => {
            e.stopPropagation();
            handleDownload();
          }}
        >
          <Download className="size-3.5" /> Download
        </Button>
        {canDelete && (
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            onClick={(e) => {
              e.stopPropagation();
              handleDelete();
            }}
          >
            <Trash2 className="size-3.5" />
          </Button>
        )}
      </div>
    </motion.div>
  );
}
