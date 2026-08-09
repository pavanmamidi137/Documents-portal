"use client";

import { useEffect, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpCircle,
  ArrowDownCircle,
  BrainCircuit,
  Download,
  FileSpreadsheet,
  KeyRound,
  ListChecks,
  Loader2,
  Pencil,
  Plus,
  Power,
  RotateCcw,
  SquareCheckBig,
  Trash2,
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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
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
import { useDebouncedValue } from "@/lib/use-debounced-value";
import type { AiAccessConfig, MetaData, Paginated, User } from "@/lib/types";
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
  const debouncedQ = useDebouncedValue(q);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [csvOpen, setCsvOpen] = useState(false);
  const [passwordTarget, setPasswordTarget] = useState<User | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [resetting, setResetting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [aiAccessTarget, setAiAccessTarget] = useState<User | null>(null);
  const [bulkTargets, setBulkTargets] = useState<User[]>([]);
  const [pendingBulk, setPendingBulk] = useState<BulkAction | null>(null);
  const [bulkRunning, setBulkRunning] = useState(false);
  // "Select all across all pages" - deletes every student matching the
  // current search/filters in one request instead of one row at a time.
  const [selectAllMatching, setSelectAllMatching] = useState(false);

  // Debounce filter changes (like search) so rapid changes batch into one
  // request instead of firing one query per selection.
  const debouncedFilters = useDebouncedValue(filters, 250);

  const currentQueryKey = ["students", page, pageSize, debouncedQ, debouncedFilters] as const;

  const { data, isLoading } = useQuery({
    queryKey: currentQueryKey,
    queryFn: () =>
      http.get<Paginated<User>>("/students/", {
        page,
        page_size: pageSize,
        search: debouncedQ || undefined,
        ...debouncedFilters,
      }),
    // Keep the current rows visible while paging/filtering loads the next one.
    placeholderData: keepPreviousData,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["students"] });

  const prefetchNextPage = (next: number) => {
    void queryClient.prefetchQuery({
      queryKey: ["students", next, pageSize, debouncedQ, debouncedFilters],
      queryFn: () =>
        http.get<Paginated<User>>("/students/", {
          page: next,
          page_size: pageSize,
          search: debouncedQ || undefined,
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

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const previous = queryClient.getQueryData<Paginated<User>>(currentQueryKey);
    // Optimistic removal: the row disappears instantly, no refetch needed.
    queryClient.setQueryData<Paginated<User>>(currentQueryKey, (old) =>
      old
        ? {
            ...old,
            count: Math.max(0, old.count - 1),
            results: old.results.filter((s) => s.id !== deleteTarget.id),
          }
        : old
    );
    try {
      await http.delete(`/students/${deleteTarget.id}/`);
      toast.success("Student deleted.");
      invalidate();
    } catch (error) {
      // runAction swallows errors, so the delete must be handled here directly
      // or the optimistic removal would never be rolled back on failure.
      queryClient.setQueryData(currentQueryKey, previous);
      toast.error(getErrorMessage(error));
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  };

  const executeBulk = async (targets: User[], action: BulkAction) => {
    if (targets.length === 0 && !selectAllMatching) return;
    setBulkRunning(true);
    const targetIds = new Set(targets.map((s) => s.id));
    const previous = queryClient.getQueryData<Paginated<User>>(currentQueryKey);
    if (action.type === "delete") {
      // Optimistic removal of every matching row before the requests fire.
      queryClient.setQueryData<Paginated<User>>(currentQueryKey, (old) =>
        old
          ? {
              ...old,
              count: selectAllMatching ? 0 : Math.max(0, old.count - targetIds.size),
              results: selectAllMatching
                ? []
                : old.results.filter((s) => !targetIds.has(s.id)),
            }
          : old
      );
    }
    let ok = 0;
    const failed: string[] = [];
    try {
      if (selectAllMatching) {
        // Delete EVERY matching student in ONE request, scoped server-side by
        // the same filters the list is showing (search/branch/section/role).
        try {
          const res = await http.post<{ deleted: number }>(
            "/students/bulk_delete/",
            { all_matching: true },
            { search: debouncedQ || undefined, ...debouncedFilters }
          );
          ok = res.deleted;
          const skipped = Math.max(0, (data?.count ?? 0) - res.deleted);
          if (skipped > 0) {
            failed.push(
              `${skipped} could not be deleted (outside your section scope or already removed)`
            );
          }
        } catch {
          failed.push("the bulk request could not be completed");
        }
      } else if (action.type === "delete") {
        // ONE request for the whole selection - instant even for hundreds of
        // rows (scope checks happen server-side per student).
        try {
          const res = await http.post<{ deleted: number }>("/students/bulk_delete/", {
            ids: targets.map((s) => s.id),
          });
          ok = res.deleted;
          const skipped = targets.length - res.deleted;
          if (skipped > 0) {
            failed.push(
              `${skipped} could not be deleted (outside your section scope or already removed)`
            );
          }
        } catch {
          failed.push(...targets.map((s) => s.roll_number));
        }
      } else {
        for (const s of targets) {
          try {
            switch (action.type) {
              case "reset_password":
                await http.post(`/students/${s.id}/reset_password/`, {
                  new_password: s.roll_number,
                });
                break;
              case "activate":
                await http.post(`/students/${s.id}/activate/`);
                break;
              case "deactivate":
                await http.post(`/students/${s.id}/deactivate/`);
                break;
              case "promote":
                await http.post(`/students/${s.id}/promote/`);
                break;
              case "demote":
                await http.post(`/students/${s.id}/demote/`);
                break;
            }
            ok += 1;
          } catch {
            failed.push(s.roll_number);
          }
        }
      }
      if (ok > 0)
        toast.success(`${ok} student${ok === 1 ? "" : "s"} ${action.doneLabel}.`);
      if (failed.length > 0)
        toast.error(`Couldn't ${FAILURE_LABELS[action.type]} ${failed.length}: ${failed.join(", ")}`);
      // Background refetch reconciles the optimistic removal with the server.
      invalidate();
    } catch (error) {
      queryClient.setQueryData(currentQueryKey, previous);
      toast.error(getErrorMessage(error));
    } finally {
      setBulkRunning(false);
      setSelectAllMatching(false);
    }
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
          <Avatar className="size-9 shrink-0 ring-1 ring-indigo-500/30">
            {s.avatar_url ? <AvatarImage src={s.avatar_url} alt={s.full_name} /> : null}
            <AvatarFallback className="bg-gradient-to-br from-indigo-500/15 to-violet-500/15 text-xs font-bold text-indigo-600 dark:text-indigo-400">
              {s.full_name
                .split(/\s+/)
                .slice(0, 2)
                .map((p) => p[0])
                .join("")
                .toUpperCase()}
            </AvatarFallback>
          </Avatar>
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
      key: "batch",
      header: "Batch",
      cell: (s) =>
        s.passout_year ? (
          <Badge variant="outline" className="tabular-nums">
            Class of {s.passout_year}
          </Badge>
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
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
            {isAdmin && (
              <DropdownMenuItem onClick={() => setAiAccessTarget(s)}>
                <BrainCircuit className="size-4" /> AI Access Limits
              </DropdownMenuItem>
            )}
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
          <>
            {(isAdmin || isCr) && (
              <Button variant="outline" onClick={() => setCsvOpen(true)}>
                <FileSpreadsheet className="size-4" /> CSV Import
              </Button>
            )}
            {(isAdmin || isCr) && (
              <Button variant="outline" onClick={handleExport}>
                <Download className="size-4" /> Export
              </Button>
            )}
            <Button
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              <Plus className="size-4" /> Add Student
            </Button>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {!isCr && (
          <>
            <Select value={filters.branch ?? ""} onValueChange={(v) => setFilter("branch", v ?? "")}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Branch">
                  {meta.branches.find((b) => String(b.id) === filters.branch)?.name}
                </SelectValue>
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
                <SelectValue placeholder="Section">
                  {meta.sections.find((s) => String(s.id) === filters.section)?.name}
                </SelectValue>
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
                <SelectValue placeholder="Role">
                  {filters.role === "STUDENT" ? "Students" : filters.role === "CR" ? "CRs" : undefined}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="STUDENT">Students</SelectItem>
                <SelectItem value="CR">CRs</SelectItem>
              </SelectContent>
            </Select>
          </>
        )}
        {!isCr && (Object.keys(filters).length > 0 || q !== "") && (
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-muted-foreground hover:text-foreground"
            onClick={() => {
              setFilters({});
              setQ("");
              setPage(1);
              setSelectAllMatching(false);
            }}
          >
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
        searchPlaceholder="Search roll number, name, email…"
        rowKey={(s) => s.id}
        prefetchNextPage={prefetchNextPage}
        selectable={isAdmin || isCr}
        selectionActive={selectAllMatching}
        onSelectionChange={(keys) => {
          // Ticking an individual row leaves all-pages mode.
          if (keys.length > 0) setSelectAllMatching(false);
        }}
        onDeleteKey={(selected, clear) => {
          // Keyboard Delete = same confirm flow as the Delete button, which
          // drops the visual selection while the dialog works from the
          // captured targets (Esc dismisses without deleting).
          if (selectAllMatching) {
            setBulkTargets([]);
            setPendingBulk({ type: "delete", doneLabel: "deleted" });
          } else if (selected.length > 0) {
            clear();
            setBulkTargets(selected);
            setPendingBulk({ type: "delete", doneLabel: "deleted" });
          }
        }}
        selectionBar={(selected, clear, selectAllOnPage) => {
          const matchingCount = data?.count ?? 0;
          const requestBulk = (action: BulkAction) => {
            if (selectAllMatching) {
              // All-pages mode has no per-row targets; the confirm dialog
              // reads the flag + matching count instead.
              setBulkTargets([]);
              setPendingBulk(action);
            } else {
              setBulkTargets(selected);
              if (action.type === "activate" || action.type === "deactivate") {
                // Reversible actions run immediately, no confirmation needed.
                void executeBulk(selected, action).then(clear);
              } else {
                // Drop the visual selection now; the confirm dialog works from
                // the captured targets and the list refetches without them.
                clear();
                setPendingBulk(action);
              }
            }
          };
          return (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-medium">
                {selectAllMatching ? (
                  <>
                    All{" "}
                    <span className="text-foreground">{matchingCount}</span> matching{" "}
                    student{matchingCount === 1 ? "" : "s"} selected
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
                    title="Select every student matching the current search and filters, across all pages"
                  >
                    <SquareCheckBig className="size-4" /> Select all {matchingCount} matching
                  </Button>
                )}
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => requestBulk({ type: "delete", doneLabel: "deleted" })}
                >
                  <Trash2 className="size-4" />
                  {selectAllMatching ? "Delete All Matching" : "Delete"}
                </Button>
                {!selectAllMatching && (
                  <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button variant="outline" size="sm">
                        <ListChecks className="size-4" /> Bulk Actions
                      </Button>
                    }
                  />
                  <DropdownMenuContent align="end" className="w-60">
                    <DropdownMenuItem onClick={() => requestBulk({ type: "reset_password", doneLabel: "password reset" })}>
                      <KeyRound className="size-4" /> Reset password to roll number
                    </DropdownMenuItem>
                    {isAdmin && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => requestBulk({ type: "activate", doneLabel: "activated" })}>
                          <Power className="size-4 text-emerald-500" /> Activate
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => requestBulk({ type: "deactivate", doneLabel: "deactivated" })}>
                          <Power className="size-4 text-orange-500" /> Deactivate
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => requestBulk({ type: "promote", doneLabel: "promoted to CR" })}>
                          <ArrowUpCircle className="size-4 text-violet-500" /> Promote to CR
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => requestBulk({ type: "demote", doneLabel: "demoted to student" })}>
                          <ArrowDownCircle className="size-4 text-orange-500" /> Demote to Student
                        </DropdownMenuItem>
                      </>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={() => requestBulk({ type: "delete", doneLabel: "deleted" })}
                    >
                      <Trash2 className="size-4" /> Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                )}
              </div>
            </div>
          );
        }}
      />

      <StudentFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        student={editing}
        meta={meta}
        isCr={isCr}
        onSaved={invalidate}
      />

      <CsvImportDialog open={csvOpen} onOpenChange={setCsvOpen} onImported={invalidate} meta={meta} isCr={isCr} />

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

      <AiAccessDialog
        key={aiAccessTarget?.id ?? "none"}
        open={!!aiAccessTarget}
        onOpenChange={(open) => !open && setAiAccessTarget(null)}
        student={aiAccessTarget}
      />

      <ConfirmDialog
        open={!!pendingBulk}
        onOpenChange={(open) => {
          if (!open) {
            setPendingBulk(null);
            // Matches the documents page: cancelling leaves all-pages mode.
            setSelectAllMatching(false);
          }
        }}
        title={bulkConfirmTitle(
          pendingBulk,
          selectAllMatching ? (data?.count ?? 0) : bulkTargets.length
        )}
        description={
          pendingBulk?.type === "delete" && selectAllMatching
            ? `This permanently removes ALL ${data?.count ?? 0} students matching your current search and filters (across every page). This cannot be undone.`
            : bulkConfirmDescription(pendingBulk)
        }
        confirmLabel={pendingBulk?.type === "delete" ? "Delete" : "Continue"}
        destructive={pendingBulk?.type === "delete"}
        loading={bulkRunning}
        onConfirm={async () => {
          if (!pendingBulk) return;
          await executeBulk(bulkTargets, pendingBulk);
          setPendingBulk(null);
        }}
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

/** Admin: raise/lower a specific student's AI limits (or grant unlimited). */
function AiAccessDialog({
  open,
  onOpenChange,
  student,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  student: User | null;
}) {
  const queryClient = useQueryClient();
  const [data, setData] = useState<AiAccessConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dailyAi, setDailyAi] = useState("");
  const [atsInterval, setAtsInterval] = useState("");
  const [dailyUploads, setDailyUploads] = useState("");
  const [unlimited, setUnlimited] = useState(false);

  // Load the student's current limits when the dialog opens. State updates
  // happen only after the await, so the fetch never blocks rendering.
  useEffect(() => {
    if (!open || !student) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await http.get<AiAccessConfig>(`/students/${student.id}/ai_access/`);
        if (cancelled) return;
        setData(res);
        setDailyAi(res.daily_ai_requests == null ? "" : String(res.daily_ai_requests));
        setAtsInterval(res.ats_view_interval_days == null ? "" : String(res.ats_view_interval_days));
        setDailyUploads(res.daily_resume_uploads == null ? "" : String(res.daily_resume_uploads));
        setUnlimited(res.unlimited_ai);
      } catch (error) {
        if (!cancelled) toast.error(getErrorMessage(error));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, student?.id]);

  const save = async () => {
    if (!student) return;
    setSaving(true);
    try {
      const res = await http.patch<AiAccessConfig>(`/students/${student.id}/ai_access/`, {
        daily_ai_requests: dailyAi ? Number(dailyAi) : null,
        ats_view_interval_days: atsInterval ? Number(atsInterval) : null,
        daily_resume_uploads: dailyUploads ? Number(dailyUploads) : null,
        unlimited_ai: unlimited,
      });
      setData(res);
      toast.success(`AI limits updated for ${student.full_name}.`);
      queryClient.invalidateQueries({ queryKey: ["students"] });
      onOpenChange(false);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const effective = data?.effective;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BrainCircuit className="size-5 text-primary" /> AI Access Limits
          </DialogTitle>
          <DialogDescription>
            Raise or lower the AI limits for{" "}
            <span className="font-medium text-foreground">{student?.full_name}</span>{" "}
            ({student?.roll_number}). Blank fields use the portal defaults.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="size-6 animate-spin text-primary" />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-3 py-2.5">
              <div>
                <p className="text-sm font-medium">Unlimited AI</p>
                <p className="text-xs text-muted-foreground">
                  Bypasses the daily request limit for this student.
                </p>
              </div>
              <Switch checked={unlimited} onCheckedChange={setUnlimited} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="ai-daily">AI requests per day</Label>
              <Input
                id="ai-daily"
                type="number"
                min={0}
                placeholder={effective ? `Default: ${effective.daily_ai_requests}` : "Portal default"}
                value={dailyAi}
                onChange={(e) => setDailyAi(e.target.value)}
                disabled={unlimited}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="ai-ats">ATS report refresh interval (days)</Label>
              <Input
                id="ai-ats"
                type="number"
                min={1}
                placeholder={effective ? `Default: ${effective.ats_view_interval_days ?? "—"}` : "Portal default"}
                value={atsInterval}
                onChange={(e) => setAtsInterval(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                How often the student can open the full ATS report (e.g. 10 = once every 10 days).
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ai-uploads">Resume uploads per day</Label>
              <Input
                id="ai-uploads"
                type="number"
                min={0}
                placeholder={effective ? `Default: ${effective.daily_resume_uploads}` : "Portal default"}
                value={dailyUploads}
                onChange={(e) => setDailyUploads(e.target.value)}
              />
            </div>

            {data && (
              <p className="rounded-lg border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                Used today: {data.ai_requests_used_today} AI request
                {data.ai_requests_used_today === 1 ? "" : "s"} · {data.resume_uploads_used_today} resume
                upload{data.resume_uploads_used_today === 1 ? "" : "s"}
              </p>
            )}

            <DialogFooter className="gap-2 pt-2">
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
                Cancel
              </Button>
              <Button onClick={save} disabled={saving}>
                {saving && <Loader2 className="size-4 animate-spin" />}
                Save Limits
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

type BulkAction = {
  type: "delete" | "reset_password" | "activate" | "deactivate" | "promote" | "demote";
  doneLabel: string;
};

const FAILURE_LABELS: Record<BulkAction["type"], string> = {
  delete: "delete",
  reset_password: "reset the password of",
  activate: "activate",
  deactivate: "deactivate",
  promote: "promote",
  demote: "demote",
};

function bulkConfirmTitle(action: BulkAction | null, count: number): string {
  switch (action?.type) {
    case "delete":
      return `Delete ${count} student${count === 1 ? "" : "s"}?`;
    case "reset_password":
      return "Reset passwords to roll numbers?";
    case "promote":
      return `Promote ${count} student${count === 1 ? "" : "s"} to CR?`;
    case "demote":
      return `Demote ${count} student${count === 1 ? "" : "s"}?`;
    default:
      return "Continue?";
  }
}

function bulkConfirmDescription(action: BulkAction | null): string {
  switch (action?.type) {
    case "delete":
      return "This permanently removes these student accounts. This cannot be undone.";
    case "reset_password":
      return "Each student's password is reset to their Roll Number (in capitals). They can change it after logging in.";
    case "promote":
      return "Selected students become CRs and can manage their assigned section. They need a branch and section assigned.";
    case "demote":
      return "Selected CRs become regular students again.";
    default:
      return "";
  }
}
