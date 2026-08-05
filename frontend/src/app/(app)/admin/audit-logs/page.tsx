"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Eraser, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { RoleGuard } from "@/components/role-guard";
import { DataTable, type Column } from "@/components/data-table";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { http } from "@/lib/api";
import type { AuditLog, Paginated } from "@/lib/types";
import { formatDateTime, getErrorMessage } from "@/lib/utils";

const ACTION_STYLES: Record<string, string> = {
  LOGIN: "bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/30",
  CREATE: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  UPDATE: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
  DELETE: "bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30",
  PROMOTE: "bg-violet-500/15 text-violet-600 dark:text-violet-400 border-violet-500/30",
  DEMOTE: "bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/30",
  DOCUMENT_UPLOAD: "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border-indigo-500/30",
  DOCUMENT_DELETE: "bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30",
  PASSWORD_RESET: "bg-fuchsia-500/15 text-fuchsia-600 dark:text-fuchsia-400 border-fuchsia-500/30",
  CSV_IMPORT: "bg-teal-500/15 text-teal-600 dark:text-teal-400 border-teal-500/30",
};

export default function AuditLogsPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [clearing, setClearing] = useState<"selected" | "all" | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["audit-logs", page, pageSize, q],
    queryFn: () =>
      http.get<Paginated<AuditLog>>("/audit-logs/", {
        page,
        page_size: pageSize,
        search: q || undefined,
      }),
  });

  const rows = data?.results ?? [];
  const allSelected = rows.length > 0 && rows.every((log) => selected.has(log.id));

  const toggle = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) rows.forEach((log) => next.delete(log.id));
      else rows.forEach((log) => next.add(log.id));
      return next;
    });
  };

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["audit-logs"] });
    setSelected(new Set());
  };

  const runClear = async () => {
    if (!clearing) return;
    try {
      const res = clearing === "all"
        ? await http.post<{ deleted: number }>("/audit-logs/clear/", { all: true })
        : await http.post<{ deleted: number }>("/audit-logs/clear/", {
            ids: [...selected],
          });
      toast.success(
        clearing === "all"
          ? `Cleared all audit logs (${res.deleted} entries removed).`
          : `Cleared ${res.deleted} selected log entr${res.deleted === 1 ? "y" : "ies"}.`
      );
      invalidate();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setClearing(null);
    }
  };

  const selectionColumn: Column<AuditLog> = useMemo(
    () => ({
      key: "select",
      header: (
        <Checkbox
          checked={allSelected}
          onCheckedChange={toggleAll}
          aria-label="Select all on page"
        />
      ),
      className: "w-10 pr-0",
      headerClassName: "w-10 pr-0",
      cell: (log) => (
        <Checkbox
          checked={selected.has(log.id)}
          onCheckedChange={() => toggle(log.id)}
          aria-label={`Select log ${log.id}`}
        />
      ),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allSelected, selected]
  );

  const columns: Column<AuditLog>[] = useMemo(
    () => [
      selectionColumn,
      {
        key: "action",
        header: "Action",
        cell: (log) => (
          <Badge variant="outline" className={ACTION_STYLES[log.action] ?? ""}>
            {log.action.replace("_", " ")}
          </Badge>
        ),
      },
      {
        key: "actor",
        header: "Actor",
        cell: (log) => (
          <div className="text-sm">
            <p className="font-medium">{log.actor_name}</p>
            <p className="text-xs text-muted-foreground">{log.actor_roll}</p>
          </div>
        ),
      },
      {
        key: "target",
        header: "Target",
        cell: (log) => <span className="text-sm">{log.target_type}</span>,
      },
      {
        key: "detail",
        header: "Detail",
        cell: (log) => (
          <span className="block max-w-72 truncate font-mono text-xs text-muted-foreground">
            {JSON.stringify(log.details)}
          </span>
        ),
      },
      {
        key: "time",
        header: "When",
        cell: (log) => (
          <span className="text-sm text-muted-foreground">{formatDateTime(log.created_at)}</span>
        ),
      },
    ],
    [selectionColumn]
  );

  return (
    <RoleGuard roles={["SUPER_ADMIN"]}>
      <PageHeader
        title="Audit Logs"
        description="A trail of every important action taken on the portal."
        actions={
          <>
            <Button
              variant="outline"
              disabled={selected.size === 0 || !!clearing}
              onClick={() => setClearing("selected")}
              className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              <Eraser className="size-4" />
              Clear Selected {selected.size > 0 && `(${selected.size})`}
            </Button>
            <Button
              variant="outline"
              disabled={!!clearing}
              onClick={() => setClearing("all")}
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="size-4" />
              Clear All
            </Button>
          </>
        }
      />

      <DataTable
        columns={columns}
        data={rows}
        count={data?.count ?? 0}
        page={page}
        pageSize={pageSize}
        onPageChange={(p) => {
          setSelected(new Set());
          setPage(p);
        }}
        loading={isLoading}
        searchValue={q}
        onSearchChange={(v) => {
          setQ(v);
          setPage(1);
          setSelected(new Set());
        }}
        searchPlaceholder="Search actor, target…"
        rowKey={(log) => log.id}
        emptyTitle="No audit events"
        emptyDescription="Actions you take will be recorded here."
      />

      <ConfirmDialog
        open={!!clearing}
        onOpenChange={(open) => !open && setClearing(null)}
        title={clearing === "all" ? "Clear all audit logs?" : `Clear ${selected.size} selected log${selected.size === 1 ? "" : "s"}?`}
        description={
          clearing === "all"
            ? "This permanently deletes every audit log entry. Only this clearing action itself will remain. This cannot be undone."
            : "The selected entries will be permanently deleted. This cannot be undone."
        }
        confirmLabel="Clear"
        destructive
        loading={!!clearing}
        onConfirm={runClear}
      />
    </RoleGuard>
  );
}
