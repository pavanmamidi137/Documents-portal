"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { RoleGuard } from "@/components/role-guard";
import { DataTable, type Column } from "@/components/data-table";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { http } from "@/lib/api";
import type { AuditLog, Paginated } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";

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
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [q, setQ] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["audit-logs", page, pageSize, q],
    queryFn: () =>
      http.get<Paginated<AuditLog>>("/audit-logs/", {
        page,
        page_size: pageSize,
        search: q || undefined,
      }),
  });

  const columns: Column<AuditLog>[] = [
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
    { key: "target", header: "Target", cell: (log) => <span className="text-sm">{log.target_type}</span> },
    {
      key: "detail",
      header: "Detail",
      cell: (log) => (
        <span className="block max-w-72 truncate font-mono text-xs text-muted-foreground">
          {JSON.stringify(log.details)}
        </span>
      ),
    },
    { key: "time", header: "When", cell: (log) => <span className="text-sm text-muted-foreground">{formatDateTime(log.created_at)}</span> },
  ];

  return (
    <RoleGuard roles={["SUPER_ADMIN"]}>
      <PageHeader
        title="Audit Logs"
        description="A trail of every important action taken on the portal."
      />
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
        searchPlaceholder="Search actor, target…"
        rowKey={(log) => log.id}
        emptyTitle="No audit events"
        emptyDescription="Actions you take will be recorded here."
      />
    </RoleGuard>
  );
}
