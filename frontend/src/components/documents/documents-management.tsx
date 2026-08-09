"use client";

import { useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  CalendarClock,
  Download,
  Eye,
  ListChecks,
  Plus,
  Repeat,
  RotateCcw,
  Send,
  Share2,
  SquareCheckBig,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { getDocumentExt, getDocumentTypeMeta } from "@/lib/document-types";
import {
  ShareDocumentDialog,
  ShareRequestDialog,
  ShareRequestsDialog,
  usePendingShareRequests,
} from "./share-fork-dialogs";

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
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { useCloudinaryCheck } from "@/lib/use-cloudinary-check";
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
  const debouncedQ = useDebouncedValue(q);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [uploadOpen, setUploadOpen] = useState(false);
  const [shareTarget, setShareTarget] = useState<DocumentItem | null>(null);
  const [requestTarget, setRequestTarget] = useState<DocumentItem | null>(null);
  const [requestsOpen, setRequestsOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DocumentItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [bulkDeleteTargets, setBulkDeleteTargets] = useState<DocumentItem[]>([]);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  // "Select all across all pages" - deletes every document matching the
  // current search/filters in one request instead of one row at a time.
  const [selectAllMatching, setSelectAllMatching] = useState(false);

  // Debounce filter changes (like search) so rapid changes batch into one
  // request and the table doesn't flicker on every selection.
  const debouncedFilters = useDebouncedValue(filters, 250);

  const { data, isLoading } = useQuery({
    queryKey: ["documents", page, pageSize, debouncedQ, debouncedFilters],
    queryFn: () =>
      http.get<Paginated<DocumentItem>>("/documents/", {
        page,
        page_size: pageSize,
        q: debouncedQ || undefined,
        ...debouncedFilters,
      }),
    // Keep the current rows visible while paging/filtering loads the next one.
    placeholderData: keepPreviousData,
  });

  const { data: pendingData } = usePendingShareRequests(isCr);
  // The query is filtered to PENDING server-side, so `count` is accurate.
  const pendingCount = pendingData?.count ?? (pendingData?.results ?? []).length;

  const invalidateDocuments = () => {
    queryClient.invalidateQueries({ queryKey: ["documents"] });
    queryClient.invalidateQueries({ queryKey: ["share-requests", "incoming"] });
  };

  const prefetchNextPage = (next: number) => {
    void queryClient.prefetchQuery({
      queryKey: ["documents", next, pageSize, debouncedQ, debouncedFilters],
      queryFn: () =>
        http.get<Paginated<DocumentItem>>("/documents/", {
          page: next,
          page_size: pageSize,
          q: debouncedQ || undefined,
          ...debouncedFilters,
        }),
      staleTime: 30_000,
    });
  };

  const setFilter = (key: string, value: string) => {
    setPage(1);
    // The "matching set" changes with the filters - drop all-pages mode.
    setSelectAllMatching(false);
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

  const handleZip = async () => {
    try {
      await http.download(
        "/documents/download_zip/",
        { q: q || undefined, ...filters },
        "documents.zip"
      );
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  const hasFilters = Object.keys(filters).length > 0 || q !== "";
  const clearFilters = () => {
    setFilters({});
    setQ("");
    setPage(1);
    setSelectAllMatching(false);
  };

  const semesterName = meta.semesters.find((s) => String(s.id) === filters.semester)?.name;
  const categoryName = meta.categories.find((c) => String(c.id) === filters.category)?.name;
  const subjectName = meta.subjects.find((s) => String(s.id) === filters.subject)?.name;

  const currentQueryKey = ["documents", page, pageSize, debouncedQ, debouncedFilters] as const;

  // Files deleted directly in Cloudinary disappear from this view instantly.
  useCloudinaryCheck<DocumentItem>({
    url: "/documents/check-files/",
    params: { q: debouncedQ || undefined, ...debouncedFilters },
    queryKey: currentQueryKey,
    kind: "document",
  });

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const previous = queryClient.getQueryData<Paginated<DocumentItem>>(currentQueryKey);
    // Optimistic removal: the row disappears instantly, no refetch needed.
    queryClient.setQueryData<Paginated<DocumentItem>>(currentQueryKey, (old) =>
      old
        ? {
            ...old,
            count: Math.max(0, old.count - 1),
            results: old.results.filter((d) => d.id !== deleteTarget.id),
          }
        : old
    );
    try {
      await http.delete(`/documents/${deleteTarget.id}/`);
      toast.success("Document deleted.");
      setDeleteTarget(null);
      // Background refetch keeps every page/filter consistent with the server.
      invalidateDocuments();
    } catch (error) {
      queryClient.setQueryData(currentQueryKey, previous);
      toast.error(getErrorMessage(error));
    } finally {
      setDeleting(false);
    }
  };

  const confirmBulkDelete = async () => {
    if (bulkDeleteTargets.length === 0 && !selectAllMatching) return;
    setBulkDeleting(true);
    const targetIds = new Set(bulkDeleteTargets.map((d) => d.id));
    const previous = queryClient.getQueryData<Paginated<DocumentItem>>(currentQueryKey);
    // Optimistic removal of every matching row, then fire the deletes.
    queryClient.setQueryData<Paginated<DocumentItem>>(currentQueryKey, (old) =>
      old
        ? {
            ...old,
            count: selectAllMatching ? 0 : Math.max(0, old.count - targetIds.size),
            results: selectAllMatching
              ? []
              : old.results.filter((d) => !targetIds.has(d.id)),
          }
        : old
    );
    let ok = 0;
    const failed: string[] = [];
    try {
      // ONE request for the whole selection - instant even for hundreds of
      // rows (scope checks happen server-side per document).
      try {
        const res = await http.post<{ deleted: number }>(
          "/documents/bulk_delete/",
          selectAllMatching
            ? { all_matching: true }
            : { ids: bulkDeleteTargets.map((d) => d.id) },
          selectAllMatching ? { q: debouncedQ || undefined, ...debouncedFilters } : undefined
        );
        ok = res.deleted;
        const skipped =
          (selectAllMatching ? (data?.count ?? 0) : bulkDeleteTargets.length) - res.deleted;
        if (skipped > 0) {
          failed.push(
            `${skipped} could not be deleted (outside your section scope or already removed)`
          );
        }
      } catch {
        failed.push(
          ...(selectAllMatching
            ? ["the bulk request could not be completed"]
            : bulkDeleteTargets.map((d) => d.title))
        );
      }
      if (ok > 0)
        toast.success(`${ok} document${ok === 1 ? "" : "s"} deleted.`);
      if (failed.length > 0)
        toast.error(`Couldn't delete ${failed.length}: ${failed.slice(0, 3).join(", ")}${failed.length > 3 ? "…" : ""}`);
      setBulkDeleteTargets([]);
      // Background refetch reconciles the optimistic removal with the server.
      invalidateDocuments();
    } catch (error) {
      queryClient.setQueryData(currentQueryKey, previous);
      toast.error(getErrorMessage(error));
    } finally {
      setBulkDeleting(false);
      setSelectAllMatching(false);
    }
  };

  // Uploaded documents appear in the list INSTANTLY (optimistic prepend on
  // page 1) when no filters are active, then a background refetch keeps every
  // page/filter consistent. With filters on, we skip the prepend so a document
  // that doesn't match the active filter never flashes in the view.
  const handleUploaded = (doc: DocumentItem) => {
    if (!hasFilters) {
      queryClient.setQueryData<Paginated<DocumentItem>>(
        ["documents", 1, pageSize, debouncedQ, debouncedFilters],
        (old) =>
          old && !old.results.some((d) => d.id === doc.id)
            ? { ...old, count: old.count + 1, results: [doc, ...old.results] }
            : old
      );
    }
    invalidateDocuments();
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
              <p className="flex items-center gap-1.5 font-medium">
                <span className="truncate">{d.title}</span>
                {d.restored_at && (
                  <Badge
                    variant="outline"
                    className="shrink-0 gap-1 border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                    title="This file was deleted in Cloudinary and restored recently."
                  >
                    <RotateCcw className="size-2.5" /> Restored
                  </Badge>
                )}
                {d.submission_deadline && (
                  <Badge
                    variant="outline"
                    className="shrink-0 gap-1 border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400"
                    title="Last date to submit this assignment"
                  >
                    <CalendarClock className="size-2.5" /> {formatDate(d.submission_deadline)}
                  </Badge>
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
          {isCr ? (
            <Button
              size="icon"
              variant="ghost"
              className="size-8 text-primary hover:bg-primary/10 hover:text-primary"
              title="Request share with other sections"
              aria-label={`Request share for ${d.title}`}
              onClick={() => setRequestTarget(d)}
            >
              <Send className="size-4" />
            </Button>
          ) : (
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
            ? "Upload and manage documents for your assigned section. Share them with other sections via requests."
            : "Upload PDFs, manage visibility and export reports."
        }
        actions={
          <>
            {isCr && (
              <Button variant="outline" onClick={() => setRequestsOpen(true)} className="relative">
                <Repeat className="size-4" /> Requests
                {pendingCount > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                    {pendingCount}
                  </span>
                )}
              </Button>
            )}
            <Button variant="outline" onClick={handleZip}>
              <Archive className="size-4" /> Download ZIP
            </Button>
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
            <SelectValue placeholder="Semester">{semesterName}</SelectValue>
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
            <SelectValue placeholder="Category">{categoryName}</SelectValue>
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
            <SelectValue placeholder="Subject">{subjectName}</SelectValue>
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
        {hasFilters && (
          <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground hover:text-foreground" onClick={clearFilters}>
            <RotateCcw className="size-3.5" /> Clear all filters
          </Button>
        )}
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
          setSelectAllMatching(false);
        }}
        searchPlaceholder="Search title, subject, uploader…"
        rowKey={(d) => d.id}
        prefetchNextPage={prefetchNextPage}
        selectable
        selectionActive={selectAllMatching}
        onSelectionChange={(keys) => {
          // Ticking an individual row leaves all-pages mode.
          if (keys.length > 0) setSelectAllMatching(false);
        }}
        onDeleteKey={(selected, clear) => {
          // Keyboard Delete opens the same bulk-delete confirmation as the
          // Delete button (selection cleared, Esc dismisses without deleting).
          clear();
          setBulkDeleteTargets(selectAllMatching ? [] : selected);
        }}
        selectionBar={(selected, clear, selectAllOnPage) => {
          const matchingCount = data?.count ?? 0;
          return (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-medium">
                {selectAllMatching ? (
                  <>
                    All <span className="text-foreground">{matchingCount}</span> matching{" "}
                    document{matchingCount === 1 ? "" : "s"} selected
                  </>
                ) : (
                  <>
                    <span className="text-foreground">{selected.length}</span> selected{" "}
                    {selected.length < (data?.results.length ?? 0) && (
                      <button
                        type="button"
                        onClick={selectAllOnPage}
                        className="ml-1 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
                      >
                        <SquareCheckBig className="size-3.5" /> Select all {data?.results.length ?? 0} on this page
                      </button>
                    )}
                  </>
                )}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    clear();
                    setSelectAllMatching(false);
                  }}
                >
                  {selectAllMatching ? "Cancel" : "Clear"}
                </Button>
                {!selectAllMatching && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      clear();
                      setSelectAllMatching(true);
                    }}
                    title="Select every document matching the current search and filters, across all pages"
                  >
                    <SquareCheckBig className="size-4" /> Select all {matchingCount} matching
                  </Button>
                )}
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    // Drop the visual selection now; the confirm dialog works
                    // from the captured targets and the list refetches without them.
                    clear();
                    setBulkDeleteTargets(selectAllMatching ? [] : selected);
                  }}
                >
                  <ListChecks className="size-4" />
                  {selectAllMatching ? "Delete All Matching" : "Delete Selected"}
                </Button>
              </div>
            </div>
          );
        }}
      />

      {/* key remounts the dialog on open so file/selection state starts fresh. */}
      <UploadDocumentDialog
        key={String(uploadOpen)}
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        meta={meta}
        lockBranchSection={isCr}
        onUploaded={handleUploaded}
      />

      <ShareDocumentDialog
        key={shareTarget?.id ?? "none"}
        open={!!shareTarget}
        onOpenChange={(open) => !open && setShareTarget(null)}
        document={shareTarget}
        meta={meta}
        onShared={invalidateDocuments}
      />

      <ShareRequestDialog
        key={requestTarget?.id ?? "none"}
        open={!!requestTarget}
        onOpenChange={(open) => !open && setRequestTarget(null)}
        document={requestTarget}
        meta={meta}
        onRequested={invalidateDocuments}
      />

      <ShareRequestsDialog
        open={requestsOpen}
        onOpenChange={setRequestsOpen}
        onResponded={invalidateDocuments}
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

      <ConfirmDialog
        open={bulkDeleteTargets.length > 0 || selectAllMatching}
        onOpenChange={(open) => {
          if (!open) {
            setBulkDeleteTargets([]);
            setSelectAllMatching(false);
          }
        }}
        title={
          selectAllMatching
            ? `Delete all ${data?.count ?? 0} matching document${data?.count === 1 ? "" : "s"}?`
            : `Delete ${bulkDeleteTargets.length} document${bulkDeleteTargets.length === 1 ? "" : "s"}?`
        }
        description={
          selectAllMatching
            ? `This removes every document matching your current search and filters (across all pages). The file is only removed from Cloudinary when no other section still uses it.`
            : `This removes ${bulkDeleteTargets.length === 1 ? "this document" : `these ${bulkDeleteTargets.length} documents`} from the portal. The file is only removed from Cloudinary when no other section still uses it.`
        }
        confirmLabel="Delete"
        destructive
        loading={bulkDeleting}
        onConfirm={confirmBulkDelete}
      />
    </div>
  );
}
