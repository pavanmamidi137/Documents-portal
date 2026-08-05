"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/data-table";
import { PageHeader } from "@/components/layout/page-header";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ReferenceFormDialog, type FieldConfig } from "./reference-form-dialog";
import { http } from "@/lib/api";
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
}

export function ReferenceCrud<T extends { id: number }>({
  apiPath,
  title,
  description,
  singular,
  fields,
  columns,
  meta,
}: Props<T>) {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [pageSize] = useState(15);
  const [q, setQ] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<T | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<T | null>(null);
  const [deleting, setDeleting] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: [apiPath, page, pageSize, q],
    queryFn: () =>
      http.get<Paginated<T>>(`/${apiPath}/`, { page, page_size: pageSize, search: q || undefined }),
  });

  // Also refresh shared dropdown data (meta) so new branches/sections appear everywhere.
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: [apiPath] });
    queryClient.invalidateQueries({ queryKey: ["meta"] });
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await http.delete(`/${apiPath}/${deleteTarget.id}/`);
      toast.success(`${singular} deleted.`);
      setDeleteTarget(null);
      invalidate();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setDeleting(false);
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
          <Button
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <Plus className="size-4" /> Add {singular}
          </Button>
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
    </div>
  );
}
