"use client";

import { useState } from "react";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  Archive,
  CheckCheck,
  CheckCircle2,
  Circle,
  Clock,
  Download,
  Eye,
  FileText,
  FileUp,
  Loader2,
  RotateCcw,
  UserRoundCheck,
} from "lucide-react";
import { toast } from "sonner";

import { RoleGuard } from "@/components/role-guard";
import { DataTable, type Column } from "@/components/data-table";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/empty-state";
import { useMetaData } from "@/lib/use-meta";
import { useAuth } from "@/lib/auth";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { useCloudinaryCheck } from "@/lib/use-cloudinary-check";
import { http, openResumeInNewTab } from "@/lib/api";
import { ConfirmDialog } from "@/components/confirm-dialog";
import type { Paginated, Resume, StudentStatusRow } from "@/lib/types";
import { cn, formatBytes, formatDate, getErrorMessage } from "@/lib/utils";

export default function FacultyResumesPage() {
  const { user } = useAuth();
  const { data: meta } = useMetaData();
  const queryClient = useQueryClient();
  const isAdmin = user?.is_super_admin ?? false;

  const [tab, setTab] = useState<"uploaded" | "students">("uploaded");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [q, setQ] = useState("");
  const debouncedQ = useDebouncedValue(q);
  const [branch, setBranch] = useState("");
  const [section, setSection] = useState("");
  const [markAllOpen, setMarkAllOpen] = useState(false);
  const [zipping, setZipping] = useState(false);

  const branches = meta?.branches ?? [];
  // Faculty are locked to their own branch; admins pick from all branches.
  const effectiveBranch = isAdmin ? branch : String(user?.branch ?? "");
  const sections = (meta?.sections ?? []).filter((s) =>
    effectiveBranch ? s.branch === Number(effectiveBranch) : true
  );
  const selectedSection = sections.find((s) => String(s.id) === section);

  const setFilter = (key: string, value: string) => {
    setPage(1);
    if (key === "branch") setSection("");
    if (key === "branch") setBranch(value);
    else setSection(value);
  };

  const currentQueryKey = ["resumes", "list", page, pageSize, debouncedQ, branch, section] as const;

  // Resumes deleted directly in Cloudinary are removed from this view instantly.
  useCloudinaryCheck<Resume>({
    url: "/resumes/check-files/",
    params: {
      search: debouncedQ || undefined,
      branch: branch || undefined,
      section: section || undefined,
    },
    queryKey: currentQueryKey,
    kind: "resume",
  });

  const { data, isLoading } = useQuery({
    queryKey: currentQueryKey,
    queryFn: () =>
      http.get<Paginated<Resume>>("/resumes/", {
        page,
        page_size: pageSize,
        search: debouncedQ || undefined,
        branch: branch || undefined,
        section: section || undefined,
      }),
    placeholderData: keepPreviousData,
  });

  // Toggle review status with an optimistic update - the badge flips instantly.
  const markReviewed = useMutation({
    mutationFn: (r: Resume) =>
      http.post<Resume>(`/resumes/${r.id}/mark_reviewed/`, { reviewed: !r.is_reviewed }),
    onMutate: async (r) => {
      await queryClient.cancelQueries({ queryKey: ["resumes", "list"] });
      const previous = queryClient.getQueryData<Paginated<Resume>>(currentQueryKey);
      queryClient.setQueryData<Paginated<Resume>>(currentQueryKey, (old) =>
        old
          ? {
              ...old,
              results: old.results.map((x) =>
                x.id === r.id ? { ...x, is_reviewed: !x.is_reviewed } : x
              ),
            }
          : old
      );
      return { previous };
    },
    onError: (error, r, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(currentQueryKey, ctx.previous);
      toast.error(getErrorMessage(error));
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["resumes", "list"] }),
  });

  /** Open/download a resume and automatically mark it as reviewed. */
  const viewResume = (r: Resume, open: (r: Resume) => Promise<void> | void) => {
    // Read the live review state from the cache so a fast second click on the
    // same row can't double-toggle (the optimistic flip already updated it).
    const live = queryClient
      .getQueryData<Paginated<Resume>>(currentQueryKey)
      ?.results.find((x) => x.id === r.id);
    if (!(live?.is_reviewed ?? r.is_reviewed)) markReviewed.mutate(r);
    void open(r);
  };

  // Bulk action: mark every resume in the current filtered view as reviewed.
  const markAll = useMutation({
    mutationFn: () => http.post<{ updated: number }>("/resumes/mark_all_reviewed/", {}),
    onSuccess: (res) => {
      setMarkAllOpen(false);
      toast.success(`Marked ${res.updated} resume${res.updated === 1 ? "" : "s"} as reviewed.`);
    },
    onError: (error) => toast.error(getErrorMessage(error)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["resumes", "list"] }),
  });

  const prefetchNextPage = (next: number) => {
    void queryClient.prefetchQuery({
      queryKey: ["resumes", "list", next, pageSize, debouncedQ, branch, section],
      queryFn: () =>
        http.get<Paginated<Resume>>("/resumes/", {
          page: next,
          page_size: pageSize,
          search: debouncedQ || undefined,
          branch: branch || undefined,
          section: section || undefined,
        }),
      staleTime: 30_000,
    });
  };

  const handleDownload = async (resume: Resume) => {
    try {
      // Stream through the portal (auth + signed Cloudinary fetch), forcing a
      // browser download - direct Cloudinary URLs 401 on restricted accounts.
      await http.download(`/resumes/${resume.id}/preview/?download=1`, undefined, resume.file_name);
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  const handleZip = async () => {
    if (zipping) return;
    setZipping(true);
    try {
      await http.download(
        "/resumes/download_zip/",
        {
          search: q || undefined,
          branch: branch || undefined,
          section: section || undefined,
        },
        "resumes.zip"
      );
      if ((data?.count ?? 0) > 100)
        toast.info("ZIP includes the first 100 resumes in the current view.");
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setZipping(false);
    }
  };

  const hasFilters = q !== "" || branch !== "" || section !== "";
  const clearFilters = () => {
    setQ("");
    setBranch("");
    setSection("");
    setPage(1);
  };

  // Every student of the branch with their resume upload/review status - the
  // faculty member can see at a glance who has uploaded and who hasn't.
  const { data: statusRows, isLoading: statusLoading } = useQuery({
    queryKey: ["resumes", "student-status", debouncedQ, branch, section],
    queryFn: () =>
      http.get<{ results: StudentStatusRow[] }>("/resumes/student_status/", {
        search: debouncedQ || undefined,
        branch: branch || undefined,
        section: section || undefined,
      }),
    enabled: tab === "students",
  });

  const statusColumns: Column<StudentStatusRow>[] = [
    {
      key: "student",
      header: "Student",
      cell: (s) => (
        <div className="flex items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary ring-1 ring-primary/30">
            {s.full_name
              .split(/\s+/)
              .slice(0, 2)
              .map((p) => p[0])
              .join("")
              .toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 truncate font-medium">
              {s.full_name}
              {s.role === "CR" && (
                <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                  CR
                </Badge>
              )}
            </p>
            <p className="truncate text-xs text-muted-foreground">{s.roll_number}</p>
          </div>
        </div>
      ),
    },
    {
      key: "class",
      header: "Section",
      cell: (s) => (
        <div className="flex flex-wrap gap-1">
          <Badge variant="secondary">{s.branch_name ?? "—"}</Badge>
          <Badge variant="outline">{s.section_name ? `Sec ${s.section_name}` : "—"}</Badge>
        </div>
      ),
    },
    {
      key: "batch",
      header: "Batch",
      cell: (s) => <span className="text-sm">{s.passout_year ?? "—"}</span>,
    },
    {
      key: "resume",
      header: "Resume",
      cell: (s) =>
        s.has_resume ? (
          <Badge
            variant="outline"
            className="gap-1 border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          >
            <FileText className="size-3.5" /> Uploaded
          </Badge>
        ) : (
          <Badge
            variant="outline"
            className="gap-1 border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400"
          >
            <FileUp className="size-3.5" /> Not uploaded
          </Badge>
        ),
    },
    {
      key: "review",
      header: "Review",
      cell: (s) =>
        s.is_reviewed ? (
          <Badge
            variant="outline"
            className="gap-1 border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          >
            <CheckCircle2 className="size-3.5" /> Reviewed
          </Badge>
        ) : s.has_resume ? (
          <Badge
            variant="outline"
            className="gap-1 border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400"
          >
            <Clock className="size-3.5" /> Pending
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
  ];

  const uploadedCount = data?.count ?? 0;
  const statusList = statusRows?.results ?? [];
  const uploadedIds = new Set(statusList.filter((s) => s.has_resume).map((s) => s.student_id));

  const columns: Column<Resume>[] = [
    {
      key: "student",
      header: "Student",
      cell: (r) => (
        <div className="flex items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary ring-1 ring-primary/30">
            {r.student_name
              .split(/\s+/)
              .slice(0, 2)
              .map((p) => p[0])
              .join("")
              .toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="truncate font-medium">{r.student_name}</p>
            <p className="truncate text-xs text-muted-foreground">{r.student_roll}</p>
          </div>
        </div>
      ),
    },
    {
      key: "class",
      header: "Branch / Section",
      cell: (r) => (
        <div className="flex flex-wrap gap-1">
          <Badge variant="secondary">{r.branch_name ?? "—"}</Badge>
          <Badge variant="outline">{r.section_name ? `Sec ${r.section_name}` : "—"}</Badge>
        </div>
      ),
    },
    {
      key: "file",
      header: "Resume",
      cell: (r) => (
        <div className="flex items-center gap-2 text-sm">
          <FileText className="size-4 shrink-0 text-rose-500" />
          <span className="max-w-44 truncate">{r.file_name}</span>
          <span className="text-xs text-muted-foreground">{formatBytes(r.file_size)}</span>
          {r.restored_at && (
            <Badge
              variant="outline"
              className="gap-1 border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              title="This resume was deleted in Cloudinary and restored recently."
            >
              <RotateCcw className="size-3" /> Restored
            </Badge>
          )}
        </div>
      ),
    },
    {
      key: "updated",
      header: "Updated",
      cell: (r) => <span className="text-sm text-muted-foreground">{formatDate(r.updated_at)}</span>,
    },
    {
      key: "status",
      header: "Status",
      cell: (r) =>
        r.is_reviewed ? (
          <Badge
            variant="outline"
            className="gap-1 border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          >
            <CheckCircle2 className="size-3.5" /> Reviewed
          </Badge>
        ) : (
          <Badge
            variant="outline"
            className="gap-1 border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400"
          >
            <Clock className="size-3.5" /> Pending
          </Badge>
        ),
    },
    {
      key: "actions",
      header: "",
      cell: (r) => (
        <div className="flex items-center justify-end gap-1">
          <Button
            size="icon"
            variant="ghost"
            className="size-8"
            title="Preview resume (marks as reviewed)"
            aria-label={`Preview ${r.student_name}'s resume`}
            onClick={() =>
              viewResume(r, async (res) => {
                const err = await openResumeInNewTab(res);
                if (err) toast.error(err);
              })
            }
          >
            <Eye className="size-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-8"
            title="Download resume (marks as reviewed)"
            aria-label={`Download ${r.student_name}'s resume`}
            onClick={() => viewResume(r, (res) => handleDownload(res))}
          >
            <Download className="size-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className={cn("size-8", r.is_reviewed ? "text-emerald-500" : "text-muted-foreground")}
            title={r.is_reviewed ? "Mark as not reviewed" : "Mark as reviewed"}
            aria-label={
              r.is_reviewed
                ? `Mark ${r.student_name}'s resume as not reviewed`
                : `Mark ${r.student_name}'s resume as reviewed`
            }
            onClick={() => markReviewed.mutate(r)}
            disabled={markReviewed.isPending}
          >
            {r.is_reviewed ? <CheckCircle2 className="size-4" /> : <Circle className="size-4" />}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <RoleGuard roles={["FACULTY", "SUPER_ADMIN"]}>
      <PageHeader
        title="Student Resumes"
        description={
          isAdmin
            ? "Browse resumes uploaded by students across every branch, or see every student's upload status."
            : `Resumes of every student in the ${user?.branch_name ?? ""} branch, organised by section.`
        }
      />

      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as "uploaded" | "students")}
        className="mb-5"
      >
        <TabsList>
          <TabsTrigger value="uploaded" className="gap-1.5">
            <FileText className="size-4" /> Uploaded{uploadedCount > 0 ? ` (${uploadedCount})` : ""}
          </TabsTrigger>
          <TabsTrigger value="students" className="gap-1.5">
            <UserRoundCheck className="size-4" /> All students
          </TabsTrigger>
        </TabsList>
        <TabsContent value="students" className="mt-4">
          {statusLoading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="size-6 animate-spin text-primary" />
            </div>
          ) : statusList.length === 0 ? (
            <EmptyState
              icon={FileUp}
              title="No students found"
              description="No students match the current search or filters in your branch."
            />
          ) : (
            <>
              <div className="mb-4 flex flex-wrap gap-2">
                <Badge variant="outline" className="gap-1 border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                  <FileText className="size-3" /> {uploadedIds.size} uploaded
                </Badge>
                <Badge variant="outline" className="gap-1 border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400">
                  <FileUp className="size-3" /> {statusList.length - uploadedIds.size} not uploaded
                </Badge>
              </div>
              <DataTable
                columns={statusColumns}
                data={statusList}
                count={statusList.length}
                page={1}
                pageSize={statusList.length}
                onPageChange={() => {}}
                loading={false}
                rowKey={(s) => s.student_id}
                emptyTitle="No students found"
                emptyDescription="No students match the current filters."
              />
              <p className="mt-3 text-xs text-muted-foreground">
                Students manage their own resumes — they upload, preview, replace or delete them from
                their profile. Students who haven&apos;t uploaded yet show an amber &quot;Not uploaded&quot; badge.
              </p>
            </>
          )}
        </TabsContent>
        <TabsContent value="uploaded" className="mt-4">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div className="relative w-full max-w-xs">
              <Input
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setPage(1);
                }}
                placeholder="Search by name or roll number…"
                className="h-9 bg-muted/50 pl-3"
              />
            </div>
            <Button
              variant="outline"
              className="gap-2"
              disabled={!data?.count || markAll.isPending}
              onClick={() => setMarkAllOpen(true)}
            >
              <CheckCheck className="size-4" /> Mark all reviewed
            </Button>
            <Button
              variant="outline"
              className="gap-2"
              onClick={handleZip}
              disabled={zipping}
              title={
                (data?.count ?? 0) > 100
                  ? "ZIP includes the first 100 resumes in the current view"
                  : "Download every resume in the current view as a ZIP"
              }
            >
              <Archive className="size-4" /> {zipping ? "Preparing ZIP…" : "Download ZIP"}
            </Button>
            {isAdmin && (
              <Select value={branch} onValueChange={(v) => setFilter("branch", v ?? "")}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="Branch">
                    {branches.find((b) => String(b.id) === branch)?.name}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {branches.map((b) => (
                    <SelectItem key={b.id} value={String(b.id)}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Select value={section} onValueChange={(v) => setFilter("section", v ?? "")}>
              <SelectTrigger className="w-36">
                <SelectValue placeholder="Section">
                  {selectedSection ? `Sec ${selectedSection.name}` : undefined}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {sections.map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    Sec {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {hasFilters && (
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 text-muted-foreground hover:text-foreground"
                onClick={clearFilters}
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
            prefetchNextPage={prefetchNextPage}
            rowKey={(r) => r.id}
            emptyTitle="No resumes found"
            emptyDescription="Students haven't uploaded resumes yet, or none match your filters."
          />

          <p className="mt-4 text-xs text-muted-foreground">
            Students manage their own resumes — they can upload, preview, replace or delete them from their profile. Viewing or downloading a resume marks it as reviewed.
          </p>
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={markAllOpen}
        onOpenChange={setMarkAllOpen}
        title="Mark all resumes as reviewed?"
        description={`This marks every resume in the current filtered view (${data?.count ?? 0} resume${(data?.count ?? 0) === 1 ? "" : "s"}) as reviewed.`}
        confirmLabel="Mark all reviewed"
        loading={markAll.isPending}
        onConfirm={() => markAll.mutate()}
      />
    </RoleGuard>
  );
}
