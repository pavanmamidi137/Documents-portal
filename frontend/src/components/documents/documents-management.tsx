"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Eye, GitFork, Plus, Share2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { getDocumentExt, getDocumentTypeMeta } from "@/lib/document-types";
import { ShareDocumentDialog, ForkDocumentDialog } from "./share-fork-dialogs";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DataTable, type Column } from "@/components/data-table";
import { PageHeader } from "@/components/layout/page-header";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { UploadDocumentDialog } from "./upload-document-dialog";
import { http } from "@/lib/api";
import type { DocumentItem, MetaData, Paginated } from "@/lib/types";
import { formatBytes, formatDate, getErrorMessage } from "@/lib/utils";

interface Props {
  meta: MetaData;
  isCr?: boolean;
}

export function DocumentsManagement({ meta, isCr = false }: Props) {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [pageSize] = useState(15);
  const [q, setQ] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [uploadOpen, setUploadOpen] = useState(false);
  const [shareTarget, setShareTarget] = useState<DocumentItem | null>(null);
  const [forkOpen, setForkOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DocumentItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["documents", page, pageSize, q, filters],
    queryFn: () =>
      http.get<Paginated<DocumentItem>>("/documents/", {
        page,
        page_size: pageSize,
        q: q || undefined,
        ...filters,
      }),
  });

  const setFilter = (key: string, value: string) => {
    setPage(1);
    setFilters((prev) => {
      const next = { ...prev };
      if (value) next[key] = value;
      else delete next[key];
      return next;
    });
  };

  const handleExport = async () => {
    try {
      await http.download("/documents/export_csv/", { q, ...filters }, "documents.csv");
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await http.delete(`/documents/${deleteTarget.id}/`);
      toast.success("Document deleted.");
      setDeleteTarget(null);
      queryClient.invalidateQueries({ queryKey: ["documents"] });
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setDeleting(false);
    }
  };

  const columns: Column<DocumentItem>[] = [
    {
      key: "title",
      header: "Document",
      cell: (d) => {
        const meta = getDocumentTypeMeta(d.file_name);
        const Icon = meta.Icon;
        return (
          <div className="flex items-center gap-3">
            <div className={`flex size-9 shrink-0 items-center justify-center rounded-lg ring-1 ${meta.classes}`}>
              <Icon className="size-4" />
            </div>
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 truncate font-medium">
                {d.title}
                {d.forked_from && (
                  <span
                    title="Forked from another section"
                    className="inline-flex shrink-0 items-center gap-0.5 rounded border border-primary/30 bg-primary/10 px-1 py-px text-[10px] font-semibold text-primary"
                  >
                    <GitFork className="size-2.5" /> Forked
                  </span>
                )}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {d.file_name} · {formatBytes(d.file_size)}
                <span className="ml-1.5 rounded border px-1 py-px text-[10px] font-semibold uppercase">
                  {getDocumentExt(d.file_name)}
                </span>
              </p>
            </div>
          </div>
        );
      },
    },
    {
      key: "subject",
      header: "Subject",
      cell: (d) => (
        <div>
          <p className="text-sm">{d.subject_name}</p>
          <p className="text-xs text-muted-foreground">{d.semester_name}</p>
        </div>
      ),
    },
    {
      key: "target",
      header: "Branch / Section",
      cell: (d) => (
        <div className="flex flex-wrap gap-1">
          <Badge variant="secondary">{d.branch_name}</Badge>
          <Badge variant="outline">{d.section_name}</Badge>
        </div>
      ),
    },
    {
      key: "category",
      header: "Category",
      cell: (d) => <span className="text-sm">{d.category_name}</span>,
    },
    {
      key: "meta",
      header: "Uploaded",
      cell: (d) => (
        <div className="text-sm">
          <p>{d.uploaded_by_name ?? "System"}</p>
          <p className="text-xs text-muted-foreground">{formatDate(d.created_at)}</p>
        </div>
      ),
    },
    {
      key: "downloads",
      header: "DLs",
      cell: (d) => <span className="tabular-nums">{d.downloads}</span>,
      className: "text-center",
    },
    {
      key: "actions",
      header: "",
      cell: (d) => (
        <div className="flex items-center justify-end gap-1">
          <Button
            size="icon"
            variant="ghost"
            className="size-8"
            onClick={() => window.open(d.cloudinary_url, "_blank", "noopener")}
          >
            <Eye className="size-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-8"
            onClick={async () => {
              try {
                const res = await http.post<{ download_url: string }>(`/documents/${d.id}/download/`);
                window.open(res.download_url, "_blank", "noopener");
              } catch (error) {
                toast.error(getErrorMessage(error));
              }
            }}
          >
            <Download className="size-4" />
          </Button>
          {!isCr && (
            <Button
              size="icon"
              variant="ghost"
              className="size-8 text-primary hover:bg-primary/10 hover:text-primary"
              title="Share with other sections"
              aria-label={`Share ${d.title} with other sections`}
              onClick={() => setShareTarget(d)}
            >
              <Share2 className="size-4" />
            </Button>
          )}
          <Button
            size="icon"
            variant="ghost"
            className="size-8 text-destructive hover:text-destructive"
            onClick={() => setDeleteTarget(d)}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Documents"
        description={
          isCr
            ? "Upload and manage documents for your assigned section."
            : "Upload PDFs, manage visibility and export reports."
        }
        actions={
          <>
            {isCr && (
              <Button variant="outline" onClick={() => setForkOpen(true)}>
                <GitFork className="size-4" /> Fork Document
              </Button>
            )}
            <Button variant="outline" onClick={handleExport}>
              <Download className="size-4" /> Export Reports
            </Button>
            <Button onClick={() => setUploadOpen(true)}>
              <Plus className="size-4" /> Upload Document
            </Button>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <Select value={filters.semester ?? ""} onValueChange={(v) => setFilter("semester", v ?? "")}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Semester" />
          </SelectTrigger>
          <SelectContent>
            {meta.semesters.map((s) => (
              <SelectItem key={s.id} value={String(s.id)}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filters.category ?? ""} onValueChange={(v) => setFilter("category", v ?? "")}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            {meta.categories.map((c) => (
              <SelectItem key={c.id} value={String(c.id)}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filters.subject ?? ""} onValueChange={(v) => setFilter("subject", v ?? "")}>
          <SelectTrigger className="w-52">
            <SelectValue placeholder="Subject" />
          </SelectTrigger>
          <SelectContent>
            {meta.subjects.map((s) => (
              <SelectItem key={s.id} value={String(s.id)}>
                <span>{s.name}</span>
                {s.code && <span className="ml-1 text-xs text-muted-foreground">({s.code})</span>}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <DataTable
        columns={columns}
        data={data?.results ?? []}
        count={data?.count ?? 0}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        loading={isLoading}
        searchValue={q}
        onSearchChange={(v) => {
          setQ(v);
          setPage(1);
        }}
        searchPlaceholder="Search title, subject, uploader…"
        rowKey={(d) => d.id}
      />

      <UploadDocumentDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        meta={meta}
        lockBranchSection={isCr}
        onUploaded={() => queryClient.invalidateQueries({ queryKey: ["documents"] })}
      />

      <ShareDocumentDialog
        key={shareTarget?.id ?? "none"}
        open={!!shareTarget}
        onOpenChange={(open) => !open && setShareTarget(null)}
        document={shareTarget}
        meta={meta}
        onShared={() => queryClient.invalidateQueries({ queryKey: ["documents"] })}
      />

      <ForkDocumentDialog
        open={forkOpen}
        onOpenChange={setForkOpen}
        onForked={() => {
          queryClient.invalidateQueries({ queryKey: ["documents"] });
          queryClient.invalidateQueries({ queryKey: ["forkable-documents"] });
        }}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete document?"
        description={`"${deleteTarget?.title}" will be removed from Cloudinary and the portal. This cannot be undone.`}
        confirmLabel="Delete"
        destructive
        loading={deleting}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
