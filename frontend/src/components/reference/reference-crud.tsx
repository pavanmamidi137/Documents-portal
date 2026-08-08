"use client";

import { useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/data-table";
import { PageHeader } from "@/components/layout/page-header";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ReferenceFormDialog, type FieldConfig } from "./reference-form-dialog";
import { http } from "@/lib/api";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import type { Paginated } from "@/lib/types";
import { getErrorMessage } from "@/lib/utils";

interface Props<T extends { id: number }> {
  apiPath: string;
  title: string;
  description: string;
  singular: string;
  fields: FieldConfig[];
  columns: Column<T>[];
  meta?: {
    branches?: { id: number; name: string }[];
    semesters?: { id: number; name: string }[];
  };
  /** Extra buttons rendered in the page header, before the "Add" button. */
  extraActions?: React.ReactNode;
}

export function ReferenceCrud<T extends { id: number }>({
  apiPath,
  title,
  description,
  singular,
  fields,
  columns,
  meta,
  extraActions,
}: Props<T>) {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [pageSize] = useState(15);
  const [q, setQ] = useState("");
  const debouncedQ = useDebouncedValue(q);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<T | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<T | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [bulkDeleteTargets, setBulkDeleteTargets] = useState<T[]>([]);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const currentQueryKey = [apiPath, page, pageSize, debouncedQ] as const;

  const { data, isLoading } = useQuery({
    queryKey: currentQueryKey,
    queryFn: () =>
      http.get<Paginated<T>>(`/${apiPath}/`, {
        page,
        page_size: pageSize,
        search: debouncedQ || undefined,
      }),
    // Keep the current rows visible while paging/searching loads the next one.
    placeholderData: keepPreviousData,
  });

  // Also refresh shared dropdown data (meta) so new branches/sections appear everywhere.
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: [apiPath] });
    queryClient.invalidateQueries({ queryKey: ["meta"] });
  };

  const prefetchNextPage = (next: number) => {
    void queryClient.prefetchQuery({
      queryKey: [apiPath, next, pageSize, debouncedQ],
      queryFn: () =>
        http.get<Paginated<T>>(`/${apiPath}/`, {
          page: next,
          page_size: pageSize,
          search: debouncedQ || undefined,
        }),
      staleTime: 30_000,
    });
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const previous = queryClient.getQueryData<Paginated<T>>(currentQueryKey);
    // Optimistic removal: the row disappears instantly, no refetch needed.
    queryClient.setQueryData<Paginated<T>>(currentQueryKey, (old) =>
      old
        ? {
            ...old,
            count: Math.max(0, old.count - 1),
            results: old.results.filter((r) => r.id !== deleteTarget.id),
          }
        : old
    );
    try {
      await http.delete(`/${apiPath}/${deleteTarget.id}/`);
      toast.success(`${singular} deleted.`);
      setDeleteTarget(null);
      invalidate();
    } catch (error) {
      queryClient.setQueryData(currentQueryKey, previous);
      toast.error(getErrorMessage(error));
    } finally {
      setDeleting(false);
    }
  };

  const confirmBulkDelete = async () => {
    if (bulkDeleteTargets.length === 0) return;
    setBulkDeleting(true);
    const targetIds = new Set(bulkDeleteTargets.map((r) => r.id));
    const previous = queryClient.getQueryData<Paginated<T>>(currentQueryKey);
    // Optimistic removal of every selected row, then fire the deletes.
    queryClient.setQueryData<Paginated<T>>(currentQueryKey, (old) =>
      old
        ? {
            ...old,
            count: Math.max(0, old.count - targetIds.size),
            results: old.results.filter((r) => !targetIds.has(r.id)),
          }
        : old
    );
    let ok = 0;
    const failed: string[] = [];
    try {
      for (const item of bulkDeleteTargets) {
        try {
          await http.delete(`/${apiPath}/${item.id}/`);
          ok += 1;
        } catch {
          failed.push(String(item.id));
        }
      }
      if (ok > 0)
        toast.success(`${ok} ${singular.toLowerCase()}${ok === 1 ? "" : "s"} deleted.`);
      if (failed.length > 0)
        toast.error(
          `${failed.length} in use or protected (${failed.join(", ")}) — delete them individually.`
        );
      setBulkDeleteTargets([]);
      // Background refetch reconciles the optimistic removal with the server.
      invalidate();
    } catch (error) {
      queryClient.setQueryData(currentQueryKey, previous);
      toast.error(getErrorMessage(error));
    } finally {
      setBulkDeleting(false);
    }
  };

  const actionsColumn: Column<T> = {
    key: "actions",
    header: "",
    cell: (row) => (
      <div className="flex items-center justify-end gap-1">
        <Button
          size="icon"
          variant="ghost"
          className="size-8"
          onClick={() => {
            setEditing(row);
            setFormOpen(true);
          }}
        >
          <Pencil className="size-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="size-8 text-destructive hover:text-destructive"
          onClick={() => setDeleteTarget(row)}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
    ),
  };

  return (
    <div>
      <PageHeader
        title={title}
        description={description}
        actions={
          <>
            {extraActions}
            <Button
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              <Plus className="size-4" /> Add {singular}
            </Button>
          </>
        }
      />

      <DataTable
        columns={[...columns, actionsColumn]}
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
        searchPlaceholder={`Search ${title.toLowerCase()}…`}
        rowKey={(row) => row.id}
        prefetchNextPage={prefetchNextPage}
        selectable
        selectionBar={(selected, clear) => (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-medium">
              <span className="text-foreground">{selected.length}</span> selected — hold{" "}
              <kbd className="rounded border bg-background px-1 text-[10px]">Ctrl</kbd> and click rows
            </p>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={clear}>
                Clear
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setBulkDeleteTargets(selected)}
              >
                <Trash2 className="size-4" /> Delete Selected
              </Button>
            </div>
          </div>
        )}
      />

      <ReferenceFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        apiPath={apiPath}
        fields={fields}
        editing={editing}
        singular={singular}
        meta={meta}
        onSaved={invalidate}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`Delete this ${singular.toLowerCase()}?`}
        description="Related records may prevent deletion if they are in use."
        confirmLabel="Delete"
        destructive
        loading={deleting}
        onConfirm={confirmDelete}
      />

      <ConfirmDialog
        open={bulkDeleteTargets.length > 0}
        onOpenChange={(open) => !open && setBulkDeleteTargets([])}
        title={`Delete ${bulkDeleteTargets.length} ${singular.toLowerCase()}${bulkDeleteTargets.length === 1 ? "" : "s"}?`}
        description={`This permanently removes ${bulkDeleteTargets.length === 1 ? "this record" : `these ${bulkDeleteTargets.length} records`}. Records still in use cannot be deleted.`}
        confirmLabel="Delete"
        destructive
        loading={bulkDeleting}
        onConfirm={confirmBulkDelete}
      />
    </div>
  );
}
