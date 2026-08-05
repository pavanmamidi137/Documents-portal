"use client";

import { motion } from "framer-motion";
import { Download, Eye, FileText, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { http } from "@/lib/api";
import type { DocumentItem } from "@/lib/types";
import { formatBytes, formatDate, getErrorMessage } from "@/lib/utils";

interface Props {
  document: DocumentItem;
  index?: number;
  canDelete?: boolean;
  onDeleted?: (id: number) => void;
}

export function DocumentCard({ document, index = 0, canDelete = false, onDeleted }: Props) {
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
      className="group flex flex-col rounded-xl border bg-card p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
    >
      <div className="flex items-start gap-3">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-rose-500/15 to-orange-500/15 text-rose-500 ring-1 ring-rose-500/20">
          <FileText className="size-5" />
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
          onClick={() => window.open(document.cloudinary_url, "_blank", "noopener")}
        >
          <Eye className="size-3.5" /> Preview
        </Button>
        <Button size="sm" className="flex-1" onClick={handleDownload}>
          <Download className="size-3.5" /> Download
        </Button>
        {canDelete && (
          <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={handleDelete}>
            <Trash2 className="size-3.5" />
          </Button>
        )}
      </div>
    </motion.div>
  );
}
