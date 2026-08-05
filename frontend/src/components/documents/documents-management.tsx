"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Eye, FileText, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

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
      cell: (d) => (
        <div className="flex items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-rose-500/10 text-rose-500 ring-1 ring-rose-500/20">
            <FileText className="size-4" />
          </div>
          <div className="min-w-0">
            <p className="truncate font-medium">{d.title}</p>
            <p className="truncate text-xs text-muted-foreground">
              {d.file_name} · {formatBytes(d.file_size)}
            </p>
          </div>
        </div>
      ),
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
            <Button variant="outline" onClick={handleExport}>
              <Download className="size-4" /> Export CSV
            </Button>
            <Button onClick={() => setUploadOpen(true)}>
              <Plus className="size-4" /> Upload PDF
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
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Subject" />
          </SelectTrigger>
          <SelectContent>
            {meta.subjects.map((s) => (
              <SelectItem key={s.id} value={String(s.id)}>
                {s.name}
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
