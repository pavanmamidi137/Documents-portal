"use client";

import { useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { RoleGuard } from "@/components/role-guard";
import { DataTable, type Column } from "@/components/data-table";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FacultyFormDialog } from "./faculty-form-dialog";
import { useMetaData } from "@/lib/use-meta";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { http } from "@/lib/api";
import type { Paginated, User } from "@/lib/types";
import { formatDate, getErrorMessage } from "@/lib/utils";

export default function FacultyPage() {
  const queryClient = useQueryClient();
  const { data: meta } = useMetaData();

  const [page, setPage] = useState(1);
  const [pageSize] = useState(15);
  const [q, setQ] = useState("");
  const debouncedQ = useDebouncedValue(q);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [passwordTarget, setPasswordTarget] = useState<User | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [resetting, setResetting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);
  const [deleting, setDeleting] = useState(false);

  const currentQueryKey = ["faculty", page, pageSize, debouncedQ] as const;

  const { data, isLoading } = useQuery({
    queryKey: currentQueryKey,
    queryFn: () =>
      http.get<Paginated<User>>("/faculty/", {
        page,
        page_size: pageSize,
        search: debouncedQ || undefined,
      }),
    placeholderData: keepPreviousData,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["faculty"] });

  const prefetchNextPage = (next: number) => {
    void queryClient.prefetchQuery({
      queryKey: ["faculty", next, pageSize, debouncedQ],
      queryFn: () =>
        http.get<Paginated<User>>("/faculty/", {
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
    const previous = queryClient.getQueryData<Paginated<User>>(currentQueryKey);
    queryClient.setQueryData<Paginated<User>>(currentQueryKey, (old) =>
      old
        ? {
            ...old,
            count: Math.max(0, old.count - 1),
            results: old.results.filter((f) => f.id !== deleteTarget.id),
          }
        : old
    );
    try {
      await http.delete(`/faculty/${deleteTarget.id}/`);
      toast.success("Faculty member deleted.");
      setDeleteTarget(null);
      invalidate();
    } catch (error) {
      queryClient.setQueryData(currentQueryKey, previous);
      toast.error(getErrorMessage(error));
    } finally {
      setDeleting(false);
    }
  };

  const confirmReset = async () => {
    if (!passwordTarget || newPassword.length < 6) return;
    setResetting(true);
    try {
      await http.post(`/faculty/${passwordTarget.id}/reset_password/`, {
        new_password: newPassword,
      });
      toast.success(`Password reset for ${passwordTarget.full_name}.`);
      setPasswordTarget(null);
      setNewPassword("");
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setResetting(false);
    }
  };

  const columns: Column<User>[] = [
    {
      key: "faculty",
      header: "Faculty",
      cell: (f) => (
        <div className="flex items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500/15 to-teal-500/15 text-xs font-bold text-emerald-600 ring-1 ring-emerald-500/30 dark:text-emerald-400">
            {f.full_name
              .split(/\s+/)
              .slice(0, 2)
              .map((p) => p[0])
              .join("")
              .toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="truncate font-medium">{f.full_name}</p>
            <p className="truncate text-xs text-muted-foreground">{f.roll_number}</p>
          </div>
        </div>
      ),
    },
    {
      key: "contact",
      header: "Contact",
      cell: (f) => (
        <div className="text-sm">
          <p>{f.email || "—"}</p>
          <p className="text-xs text-muted-foreground">{f.phone || ""}</p>
        </div>
      ),
    },
    {
      key: "branch",
      header: "Branch",
      cell: (f) => (f.branch_name ? <Badge variant="secondary">{f.branch_name}</Badge> : "—"),
    },
    {
      key: "active",
      header: "Active",
      cell: (f) => (
        <Badge variant={f.is_active ? "default" : "outline"} className={f.is_active ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : ""}>
          {f.is_active ? "Active" : "Inactive"}
        </Badge>
      ),
    },
    {
      key: "joined",
      header: "Joined",
      cell: (f) => <span className="text-sm text-muted-foreground">{formatDate(f.date_joined)}</span>,
    },
    {
      key: "actions",
      header: "",
      cell: (f) => (
        <div className="flex items-center justify-end gap-0.5">
          <Button
            size="icon"
            variant="ghost"
            className="size-8"
            title="Edit faculty"
            aria-label={`Edit ${f.full_name}`}
            onClick={() => {
              setEditing(f);
              setFormOpen(true);
            }}
          >
            <Pencil className="size-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-8"
            title="Reset password"
            aria-label={`Reset password for ${f.full_name}`}
            onClick={() => setPasswordTarget(f)}
          >
            <KeyRound className="size-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-8 text-destructive hover:text-destructive"
            title="Delete faculty"
            aria-label={`Delete ${f.full_name}`}
            onClick={() => setDeleteTarget(f)}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <RoleGuard roles={["SUPER_ADMIN"]}>
      <PageHeader
        title="Faculty Management"
        description="Create faculty accounts so they can review student resumes in their branch."
        actions={
          <Button
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <Plus className="size-4" /> Add Faculty
          </Button>
        }
      />

      <DataTable
        columns={columns}
        data={data?.results ?? []}
        count={data?.count ?? 0}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        loading={isLoading}
        prefetchNextPage={prefetchNextPage}
        searchValue={q}
        onSearchChange={(v) => {
          setQ(v);
          setPage(1);
        }}
        searchPlaceholder="Search name, roll number, email…"
        rowKey={(f) => f.id}
        emptyTitle="No faculty yet"
        emptyDescription="Add faculty members so they can view student resumes."
      />

      <FacultyFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        faculty={editing}
        meta={meta}
        onSaved={invalidate}
      />

      {/* Reset password dialog */}
      <Dialog
        open={!!passwordTarget}
        onOpenChange={(v) => {
          if (!v) setNewPassword("");
          setPasswordTarget(v ? passwordTarget : null);
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="size-5 text-primary" />
              Reset password
            </DialogTitle>
            <DialogDescription>
              Set a new password for <span className="font-medium text-foreground">{passwordTarget?.full_name}</span>{" "}
              ({passwordTarget?.roll_number}).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="faculty-new-password">New password</Label>
            <Input
              id="faculty-new-password"
              type="text"
              placeholder="Minimum 6 characters"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setPasswordTarget(null)} disabled={resetting}>
              Cancel
            </Button>
            <Button onClick={confirmReset} disabled={resetting || newPassword.length < 6}>
              {resetting && <span className="mr-1 size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />}
              Reset Password
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete faculty member?"
        description={`${deleteTarget?.full_name} (${deleteTarget?.roll_number}) will lose access to the portal. This cannot be undone.`}
        confirmLabel="Delete"
        destructive
        loading={deleting}
        onConfirm={confirmDelete}
      />
    </RoleGuard>
  );
}
