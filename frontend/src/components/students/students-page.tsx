"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpCircle,
  ArrowDownCircle,
  Download,
  FileSpreadsheet,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  Power,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { StudentFormDialog } from "./student-form-dialog";
import { CsvImportDialog } from "./csv-import-dialog";
import { http } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { MetaData, Paginated, User } from "@/lib/types";
import { formatDate, getErrorMessage, roleColor } from "@/lib/utils";

interface Props {
  meta: MetaData;
  isCr?: boolean;
}

export function StudentsPage({ meta, isCr = false }: Props) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isAdmin = user?.is_super_admin ?? false;

  const [page, setPage] = useState(1);
  const [pageSize] = useState(15);
  const [q, setQ] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [csvOpen, setCsvOpen] = useState(false);
  const [passwordTarget, setPasswordTarget] = useState<User | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [resetting, setResetting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);
  const [deleting, setDeleting] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["students", page, pageSize, q, filters],
    queryFn: () =>
      http.get<Paginated<User>>("/students/", {
        page,
        page_size: pageSize,
        search: q || undefined,
        ...filters,
      }),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["students"] });

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
      await http.download("/students/export_csv/", { search: q || undefined, ...filters }, "students.csv");
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  const runAction = async (fn: () => Promise<unknown>, message: string) => {
    try {
      await fn();
      toast.success(message);
      invalidate();
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;
    setDeleting(true);
    runAction(() => http.delete(`/students/${deleteTarget.id}/`), "Student deleted.").finally(() => {
      setDeleting(false);
      setDeleteTarget(null);
    });
  };

  const confirmReset = () => {
    if (!passwordTarget || newPassword.length < 6) return;
    setResetting(true);
    runAction(
      () => http.post(`/students/${passwordTarget.id}/reset_password/`, { new_password: newPassword }),
      "Password reset."
    ).finally(() => {
      setResetting(false);
      setPasswordTarget(null);
      setNewPassword("");
    });
  };

  const columns: Column<User>[] = [
    {
      key: "student",
      header: "Student",
      cell: (s) => (
        <div className="flex items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500/15 to-violet-500/15 text-xs font-bold text-indigo-600 ring-1 ring-indigo-500/30 dark:text-indigo-400">
            {s.full_name
              .split(/\s+/)
              .slice(0, 2)
              .map((p) => p[0])
              .join("")
              .toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="truncate font-medium">{s.full_name}</p>
            <p className="truncate text-xs text-muted-foreground">{s.roll_number}</p>
          </div>
        </div>
      ),
    },
    {
      key: "contact",
      header: "Contact",
      cell: (s) => (
        <div className="text-sm">
          <p>{s.email || "—"}</p>
          <p className="text-xs text-muted-foreground">{s.phone || ""}</p>
        </div>
      ),
    },
    {
      key: "class",
      header: "Branch / Section",
      cell: (s) => (
        <div className="flex flex-wrap gap-1">
          <Badge variant="secondary">{s.branch_name ?? "—"}</Badge>
          <Badge variant="outline">{s.section_name ?? "—"}</Badge>
        </div>
      ),
    },
    {
      key: "role",
      header: "Role",
      cell: (s) => (
        <Badge className={roleColor(s.role)} variant="outline">
          {s.role === "CR" ? "CR" : "Student"}
        </Badge>
      ),
    },
    {
      key: "active",
      header: "Active",
      cell: (s) =>
        isAdmin ? (
          <Switch
            checked={s.is_active}
            onCheckedChange={(v) =>
              runAction(
                () => http.post(`/students/${s.id}/${v ? "activate" : "deactivate"}/`),
                v ? "Student activated." : "Student deactivated."
              )
            }
          />
        ) : (
          <Badge variant={s.is_active ? "default" : "outline"} className={s.is_active ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : ""}>
            {s.is_active ? "Active" : "Inactive"}
          </Badge>
        ),
    },
    {
      key: "joined",
      header: "Joined",
      cell: (s) => <span className="text-sm text-muted-foreground">{formatDate(s.date_joined)}</span>,
    },
    {
      key: "actions",
      header: "",
      cell: (s) => (
        <div className="flex items-center justify-end gap-0.5">
          {isAdmin && s.role === "STUDENT" && (
            <Button
              size="icon"
              variant="ghost"
              className="size-8 text-violet-500 hover:bg-violet-500/10 hover:text-violet-500"
              title={`Promote ${s.full_name} to CR`}
              aria-label={`Promote ${s.full_name} to CR`}
              onClick={() =>
                runAction(
                  () => http.post(`/students/${s.id}/promote/`),
                  `${s.full_name} promoted to CR.`
                )
              }
            >
              <ArrowUpCircle className="size-4" />
            </Button>
          )}
          {isAdmin && s.role === "CR" && (
            <Button
              size="icon"
              variant="ghost"
              className="size-8 text-orange-500 hover:bg-orange-500/10 hover:text-orange-500"
              title={`Demote ${s.full_name} to Student`}
              aria-label={`Demote ${s.full_name} to Student`}
              onClick={() =>
                runAction(
                  () => http.post(`/students/${s.id}/demote/`),
                  `${s.full_name} demoted to student.`
                )
              }
            >
              <ArrowDownCircle className="size-4" />
            </Button>
          )}
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="sm">Actions</Button>} />
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem
              onClick={() => {
                setEditing(s);
                setFormOpen(true);
              }}
            >
              <Pencil className="size-4" /> Edit
            </DropdownMenuItem>
            {isAdmin && (
              <>
                {s.role === "STUDENT" ? (
                  <DropdownMenuItem
                    onClick={() =>
                      runAction(() => http.post(`/students/${s.id}/promote/`), `${s.full_name} promoted to CR.`)
                    }
                  >
                    <ArrowUpCircle className="size-4" /> Promote to CR
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem
                    onClick={() =>
                      runAction(() => http.post(`/students/${s.id}/demote/`), `${s.full_name} demoted to student.`)
                    }
                  >
                    <ArrowDownCircle className="size-4" /> Demote to Student
                  </DropdownMenuItem>
                )}
              </>
            )}
            <DropdownMenuItem onClick={() => setPasswordTarget(s)}>
              <KeyRound className="size-4" /> Reset Password
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => setDeleteTarget(s)}
            >
              <Power className="size-4" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Students"
        description={
          isCr
            ? "Manage students in your assigned section."
            : "Add, edit, activate and manage students across all sections."
        }
        actions={
          isAdmin ? (
            <>
              <Button variant="outline" onClick={() => setCsvOpen(true)}>
                <FileSpreadsheet className="size-4" /> CSV Import
              </Button>
              <Button variant="outline" onClick={handleExport}>
                <Download className="size-4" /> Export
              </Button>
              <Button onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}>
                <Plus className="size-4" /> Add Student
              </Button>
            </>
          ) : (
            <Button onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}>
              <Plus className="size-4" /> Add Student
            </Button>
          )
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {!isCr && (
          <>
            <Select value={filters.branch ?? ""} onValueChange={(v) => setFilter("branch", v ?? "")}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Branch" />
              </SelectTrigger>
              <SelectContent>
                {meta.branches.map((b) => (
                  <SelectItem key={b.id} value={String(b.id)}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filters.section ?? ""} onValueChange={(v) => setFilter("section", v ?? "")}>
              <SelectTrigger className="w-32">
                <SelectValue placeholder="Section" />
              </SelectTrigger>
              <SelectContent>
                {meta.sections.map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filters.role ?? ""} onValueChange={(v) => setFilter("role", v ?? "")}>
              <SelectTrigger className="w-32">
                <SelectValue placeholder="Role" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="STUDENT">Students</SelectItem>
                <SelectItem value="CR">CRs</SelectItem>
              </SelectContent>
            </Select>
          </>
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
        }}
        searchPlaceholder="Search roll number, name, email…"
        rowKey={(s) => s.id}
      />

      <StudentFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        student={editing}
        meta={meta}
        isCr={isCr}
        onSaved={invalidate}
      />

      <CsvImportDialog open={csvOpen} onOpenChange={setCsvOpen} onImported={invalidate} />

      {/* Reset password dialog */}
      <ResetPasswordDialog
        open={!!passwordTarget}
        student={passwordTarget}
        onOpenChange={(open) => !open && setPasswordTarget(null)}
        value={newPassword}
        onValueChange={setNewPassword}
        loading={resetting}
        onConfirm={confirmReset}
      />

      <DeleteStudentSheet
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        loading={deleting}
        onConfirm={confirmDelete}
      />
    </div>
  );
}

function ResetPasswordDialog({
  open,
  student,
  onOpenChange,
  value,
  onValueChange,
  loading,
  onConfirm,
}: {
  open: boolean;
  student: User | null;
  onOpenChange: (open: boolean) => void;
  value: string;
  onValueChange: (v: string) => void;
  loading: boolean;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onValueChange("");
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="size-5 text-primary" />
            Reset password
          </DialogTitle>
          <DialogDescription>
            Set a new password for <span className="font-medium text-foreground">{student?.full_name}</span>{" "}
            ({student?.roll_number}).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="new-password">New password</Label>
          <Input
            id="new-password"
            type="text"
            placeholder="Minimum 6 characters"
            value={value}
            onChange={(e) => onValueChange(e.target.value)}
          />
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={loading || value.length < 6}>
            {loading && <Loader2 className="size-4 animate-spin" />}
            Reset Password
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteStudentSheet({
  open,
  onOpenChange,
  loading,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loading: boolean;
  onConfirm: () => void;
}) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Delete student?"
      description="This permanently removes the student account. This cannot be undone."
      confirmLabel="Delete"
      destructive
      loading={loading}
      onConfirm={onConfirm}
    />
  );
}
