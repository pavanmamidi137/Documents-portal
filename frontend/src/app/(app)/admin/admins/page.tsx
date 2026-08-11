"use client";

import { useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftRight, KeyRound, Plus, ShieldCheck, Trash2, UserMinus, UserPlus } from "lucide-react";
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
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { http } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Paginated, User } from "@/lib/types";
import { cn, formatDate, getErrorMessage } from "@/lib/utils";
import { AdminFormDialog } from "./admin-form-dialog";
import { DemoteAdminDialog } from "./demote-admin-dialog";
import { PromoteAdminDialog } from "./promote-admin-dialog";

export default function AdminsPage() {
  const queryClient = useQueryClient();
  const { user, logout } = useAuth();

  const [page, setPage] = useState(1);
  const [pageSize] = useState(15);
  const [q, setQ] = useState("");
  const debouncedQ = useDebouncedValue(q);
  const [addOpen, setAddOpen] = useState(false);
  const [promoteOpen, setPromoteOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [passwordTarget, setPasswordTarget] = useState<User | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [resetting, setResetting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [demoteTarget, setDemoteTarget] = useState<User | null>(null);

  const currentQueryKey = ["admins", page, pageSize, debouncedQ] as const;

  const { data, isLoading } = useQuery({
    queryKey: currentQueryKey,
    queryFn: () =>
      http.get<Paginated<User>>("/admins/", {
        page,
        page_size: pageSize,
        search: debouncedQ || undefined,
      }),
    placeholderData: keepPreviousData,
  });

  const isPrimaryAdmin = user?.is_primary_admin ?? false;

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["admins"] });

  const prefetchNextPage = (next: number) => {
    void queryClient.prefetchQuery({
      queryKey: ["admins", next, pageSize, debouncedQ],
      queryFn: () =>
        http.get<Paginated<User>>("/admins/", {
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
            results: old.results.filter((a) => a.id !== deleteTarget.id),
          }
        : old
    );
    try {
      await http.delete(`/admins/${deleteTarget.id}/`);
      toast.success("Admin account removed.");
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
      await http.post(`/admins/${passwordTarget.id}/reset_password/`, {
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
      key: "admin",
      header: "Admin",
      cell: (a) => (
        <div className="flex items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary ring-1 ring-primary/30">
            {a.full_name
              .split(/\s+/)
              .slice(0, 2)
              .map((p) => p[0])
              .join("")
              .toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="truncate font-medium">
              {a.full_name}
              {a.is_primary_admin && (
                <Badge
                  variant="outline"
                  className="ml-2 align-middle border-primary/40 bg-primary/10 text-[10px] text-primary"
                >
                  Primary
                </Badge>
              )}
              {a.id === user?.id && (
                <Badge variant="outline" className="ml-1 align-middle text-[10px]">
                  You
                </Badge>
              )}
            </p>
            <p className="truncate text-xs text-muted-foreground">{a.roll_number}</p>
          </div>
        </div>
      ),
    },
    {
      key: "contact",
      header: "Contact",
      cell: (a) => (
        <div className="text-sm">
          <p>{a.email || "—"}</p>
          <p className="text-xs text-muted-foreground">{a.phone || ""}</p>
        </div>
      ),
    },
    {
      key: "active",
      header: "Active",
      cell: (a) => (
        <Badge
          variant={a.is_active ? "default" : "outline"}
          className={a.is_active ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : ""}
        >
          {a.is_active ? "Active" : "Inactive"}
        </Badge>
      ),
    },
    {
      key: "joined",
      header: "Joined",
      cell: (a) => <span className="text-sm text-muted-foreground">{formatDate(a.date_joined)}</span>,
    },
    {
      key: "actions",
      header: "",
      cell: (a) => (
        <div className="flex items-center justify-end gap-0.5">
          {!isPrimaryAdmin && (
            <span className="pr-2 text-xs text-muted-foreground">View only</span>
          )}
          {isPrimaryAdmin && (
          <>
          <Button
            size="icon"
            variant="ghost"
            className="size-8"
            title="Reset password"
            aria-label={`Reset password for ${a.full_name}`}
            onClick={() => setPasswordTarget(a)}
          >
            <KeyRound className="size-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className={cn(
              "size-8",
              a.id === user?.id
                ? "cursor-not-allowed text-muted-foreground/40"
                : "text-amber-600 hover:bg-amber-500/10 hover:text-amber-600 dark:text-amber-400"
            )}
            title={
              a.id === user?.id
                ? "Use 'Transfer admin' to hand over your own access"
                : "Remove admin access (revert to student/faculty)"
            }
            aria-label={`Remove admin access for ${a.full_name}`}
            disabled={a.id === user?.id}
            onClick={() => setDemoteTarget(a)}
          >
            <UserMinus className="size-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className={cn(
              "size-8",
              a.id === user?.id
                ? "cursor-not-allowed text-muted-foreground/40"
                : "text-destructive hover:text-destructive"
            )}
            title={a.id === user?.id ? "Use 'Transfer admin' to hand over your own access" : "Delete admin"}
            aria-label={`Delete ${a.full_name}`}
            disabled={a.id === user?.id}
            onClick={() => setDeleteTarget(a)}
          >
            <Trash2 className="size-4" />
          </Button>
          </>
          )}
        </div>
      ),
    },
  ];

  return (
    <RoleGuard roles={["SUPER_ADMIN"]}>
      <PageHeader
        title="Admin Management"
        description={
          isPrimaryAdmin
            ? "Promote an existing student or faculty member, create new admin accounts, or hand your admin access over to another person."
            : "You can view the admin list — only the primary admin can add, promote, demote or remove admins."
        }
        actions={
          isPrimaryAdmin ? (
            <>
              <Button
                variant="outline"
                className="gap-2 border-amber-500/40 text-amber-600 hover:bg-amber-500/10 hover:text-amber-600 dark:text-amber-400"
                onClick={() => setTransferOpen(true)}
              >
                <ArrowLeftRight className="size-4" /> Transfer Admin
              </Button>
              <Button variant="outline" onClick={() => setPromoteOpen(true)}>
                <UserPlus className="size-4" /> Promote User
              </Button>
              <Button onClick={() => setAddOpen(true)}>
                <Plus className="size-4" /> Add Admin
              </Button>
            </>
          ) : undefined
        }
      />

      {!isPrimaryAdmin && (
        <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
          <ShieldCheck className="mt-0.5 size-4 shrink-0" />
          <p>
            You are a <span className="font-semibold">secondary admin</span>. The primary admin (the
            first-created admin) controls who has admin access — ask them to promote, demote or add
            admins. You keep every other portal power (students, faculty, documents, drives, AI).
          </p>
        </div>
      )}

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
        rowKey={(a) => a.id}
        emptyTitle="No admins found"
        emptyDescription="You are the only admin right now. Add another to share portal access."
      />

      <p className="mt-4 flex items-start gap-2 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
        <span>
          <span className="font-medium text-foreground">Promote User</span> turns an existing{" "}
          student, CR or faculty account into a Super Admin — they keep their login. The{" "}
          <span className="font-medium text-foreground">UserMinus icon</span> removes admin access{" "}
          from another admin (reverting them to a student or faculty member). These actions are{" "}
          limited to the <span className="font-medium text-foreground">primary admin</span> (the
          first-created admin) — secondary admins can view the list but not change it. You cannot{" "}
          demote or delete your own account — use{" "}
          <span className="font-medium text-foreground">Transfer Admin</span> to hand control to
          someone else (this signs you out).
        </span>
      </p>

      <AdminFormDialog open={addOpen} onOpenChange={setAddOpen} mode="add" />

      <PromoteAdminDialog open={promoteOpen} onOpenChange={setPromoteOpen} onPromoted={invalidate} />

      <DemoteAdminDialog
        target={demoteTarget}
        onOpenChange={(open) => !open && setDemoteTarget(null)}
        onDemoted={() => {
          setDemoteTarget(null);
          invalidate();
        }}
      />

      <AdminFormDialog
        open={transferOpen}
        onOpenChange={setTransferOpen}
        mode="transfer"
        onTransferred={logout}
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
              Set a new password for{" "}
              <span className="font-medium text-foreground">{passwordTarget?.full_name}</span> (
              {passwordTarget?.roll_number}).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="admin-new-password">New password</Label>
            <Input
              id="admin-new-password"
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
              {resetting && (
                <span className="mr-1 size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
              )}
              Reset Password
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete admin account?"
        description={`${deleteTarget?.full_name} (${deleteTarget?.roll_number}) will lose all admin access to the portal. This cannot be undone.`}
        confirmLabel="Delete"
        destructive
        loading={deleting}
        onConfirm={confirmDelete}
      />
    </RoleGuard>
  );
}
