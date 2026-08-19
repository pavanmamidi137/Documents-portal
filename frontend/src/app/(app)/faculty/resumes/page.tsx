"use client";

import { useState, type ReactNode } from "react";
import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  AlertTriangle,
  Clock,
  Download,
  Eye,
  FileText,
  FileUp,
  Loader2,
  RotateCcw,
  RefreshCw,
  Sparkles,
  UserRoundCheck,
} from "lucide-react";
import { toast } from "sonner";

import { RoleGuard } from "@/components/role-guard";
import { DataTable, type Column } from "@/components/data-table";
import { PageHeader } from "@/components/layout/page-header";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
import { http } from "@/lib/api";
import type { Paginated, Resume, StudentStatusRow } from "@/lib/types";
import { cn, formatBytes, formatDate, getErrorMessage } from "@/lib/utils";
import { scoreTone, StarRating } from "@/lib/resume-score";
import { PdfPreviewDialog } from "@/components/pdf-preview-dialog";

/** Admin-only: the resume's AI review state - status badge, star rating, ATS
 * score and (when failed) the error. Faculty keep the plain table. */
function AiReviewSummary({
  status,
  score,
  error,
  analyzedAt,
  summary,
  formatScore,
  contentScore,
  skillsScore,
  impactScore,
}: {
  status: Resume["ai_status"] | null;
  score: number | null;
  error?: string;
  analyzedAt?: string | null;
  summary?: string;
  formatScore?: number;
  contentScore?: number;
  skillsScore?: number;
  impactScore?: number;
}) {
  if (!status) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  return (
    <div className="min-w-0 space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {status === "COMPLETE" ? (
          <Badge
            variant="outline"
            className="gap-1 border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          >
            <Sparkles className="size-3" /> Analyzed
          </Badge>
        ) : status === "FAILED" ? (
          <Badge
            variant="outline"
            className="gap-1 border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400"
            title={error || "AI analysis failed"}
          >
            <AlertTriangle className="size-3" /> Failed
          </Badge>
        ) : (
          <Badge
            variant="outline"
            className="gap-1 border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400"
          >
            <Clock className="size-3" /> Pending
          </Badge>
        )}
        {analyzedAt && (
          <span className="text-[11px] text-muted-foreground">{formatDate(analyzedAt)}</span>
        )}
      </div>
      {status === "COMPLETE" && score != null && (
        <div className="flex flex-wrap items-center gap-2">
          <StarRating score={score} />
          <span className={cn("text-sm font-bold tabular-nums", scoreTone(score))}>
            {score}
            <span className="text-xs font-normal text-muted-foreground"> /100</span>
          </span>
        </div>
      )}
      {/* Sub-score mini bars */}
      {status === "COMPLETE" && (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
          {contentScore != null && <span>C:{contentScore}</span>}
          {skillsScore != null && <span>S:{skillsScore}</span>}
          {impactScore != null && <span>I:{impactScore}</span>}
          {formatScore != null && <span>F:{formatScore}</span>}
        </div>
      )}
      {status === "COMPLETE" && summary ? (
        <p className="line-clamp-2 max-w-56 text-xs text-muted-foreground">{summary}</p>
      ) : status === "FAILED" && error ? (
        <p className="line-clamp-2 max-w-56 text-xs text-destructive">{error}</p>
      ) : null}
    </div>
  );
}

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
  const [crOnly, setCrOnly] = useState("");
  const [previewResume, setPreviewResume] = useState<Resume | null>(null);
  const [retryingId, setRetryingId] = useState<number | null>(null);

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
    else if (key === "section") setSection(value);
    else if (key === "cr") setCrOnly(value);
  };

  const currentQueryKey = [
    "resumes",
    "list",
    page,
    pageSize,
    debouncedQ,
    branch,
    section,
    crOnly,
  ] as const;

  // Resumes deleted directly in Cloudinary are removed from this view instantly.
  useCloudinaryCheck<Resume>({
    url: "/resumes/check-files/",
    params: {
      search: debouncedQ || undefined,
      branch: branch || undefined,
      section: section || undefined,
      cr: crOnly || undefined,
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
        cr: crOnly || undefined,
      }),
    placeholderData: keepPreviousData,
  });

  const prefetchNextPage = (next: number) => {
    void queryClient.prefetchQuery({
      queryKey: [
        "resumes",
        "list",
        next,
        pageSize,
        debouncedQ,
        branch,
        section,
        crOnly,
      ],
      queryFn: () =>
        http.get<Paginated<Resume>>("/resumes/", {
          page: next,
          page_size: pageSize,
          search: debouncedQ || undefined,
          branch: branch || undefined,
          section: section || undefined,
          cr: crOnly || undefined,
        }),
      staleTime: 30_000,
    });
  };



  const handleDownload = async (resume: Resume) => {
    try {
      const base = `${resume.student_roll} ${resume.student_name}`.trim() || "resume";
      const ext = resume.file_name.includes(".")
        ? "." + resume.file_name.split(".").pop()
        : ".pdf";
      await http.download(
        `/resumes/${resume.id}/preview/?download=1`,
        undefined,
        `${base.replace(/[\\/:*?"<>|]+/g, "")}${ext}`
      );
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  const hasFilters = q !== "" || branch !== "" || section !== "" || crOnly !== "";
  const clearFilters = () => {
    setQ("");
    setBranch("");
    setSection("");
    setCrOnly("");
    setPage(1);
  };

  const handleRetryAI = async (resume: Resume) => {
    if (retryingId) return;
    setRetryingId(resume.id);
    try {
      await http.post(`/resumes/${resume.id}/analyze/`);
      toast.success(`AI review complete for ${resume.student_name} — they can now see the result.`);
      void queryClient.invalidateQueries({ queryKey: ["resumes", "list"] });
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setRetryingId(null);
    }
  };

  // Every student of the branch with their resume upload status - the
  // faculty member can see at a glance who has uploaded and who hasn't.
  const { data: statusRows, isLoading: statusLoading } = useQuery({
    queryKey: ["resumes", "student-status", debouncedQ, branch, section, crOnly],
    queryFn: () =>
      http.get<{ results: StudentStatusRow[] }>("/resumes/student_status/", {
        search: debouncedQ || undefined,
        branch: branch || undefined,
        section: section || undefined,
        cr: crOnly || undefined,
      }),
    enabled: tab === "students",
  });

  const statusColumns: Column<StudentStatusRow>[] = [
    {
      key: "student",
      header: "Student",
      cell: (s) => (
        <div className="flex items-center gap-3">
          <Avatar className="size-9 shrink-0 ring-1 ring-primary/30">
            {s.avatar_url ? <AvatarImage src={s.avatar_url} alt={s.full_name} /> : null}
            <AvatarFallback className="bg-primary/10 text-xs font-bold text-primary">
              {s.full_name
                .split(/\s+/)
                .slice(0, 2)
                .map((p) => p[0])
                .join("")
                .toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 truncate font-medium">
              {s.full_name}
              {s.role === "CR" && (
                <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                  CR
                </Badge>
              )}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {s.roll_number}
              {s.gender_label ? ` · ${s.gender_label}` : ""}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: "class",
      header: "Section",
      cell: (s) => (
        <div className="flex flex-wrap gap-1">
          <Badge variant="secondary">{s.branch_code || s.branch_name || "—"}</Badge>
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
    ...(isAdmin
      ? [
          {
            key: "ai",
            header: "AI Review",
            cell: (s: StudentStatusRow) => (
              <AiReviewSummary status={s.ai_status} score={s.ai_score} />
            ),
          },
        ]
      : []),
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
          <Avatar className="size-9 shrink-0 ring-1 ring-primary/30">
            {r.student_avatar_url ? (
              <AvatarImage src={r.student_avatar_url} alt={r.student_name} />
            ) : null}
            <AvatarFallback className="bg-primary/10 text-xs font-bold text-primary">
              {r.student_name
                .split(/\s+/)
                .slice(0, 2)
                .map((p) => p[0])
                .join("")
                .toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate font-medium">{r.student_name}</p>
            <p className="truncate text-xs text-muted-foreground">
              {r.student_roll}
              {r.student_gender_label ? ` · ${r.student_gender_label}` : ""}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: "class",
      header: "Branch / Section",
      cell: (r) => (
        <div className="flex flex-wrap gap-1">
          <Badge variant="secondary">{r.branch_code || r.branch_name || "—"}</Badge>
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
    ...(isAdmin
      ? [
          {
            key: "ai-review",
            header: "AI Review",
            cell: (r: Resume) => (
              <AiReviewSummary
                status={r.ai_status}
                score={r.ai_score}
                error={r.ai_error}
                analyzedAt={r.ai_analyzed_at}
                summary={r.ai_analysis?.summary}
                formatScore={r.ai_analysis?.format_score}
                contentScore={r.ai_analysis?.content_score}
                skillsScore={r.ai_analysis?.skills_score}
                impactScore={r.ai_analysis?.impact_score}
              />
            ),
          },
        ]
      : []),
    {
      key: "actions",
      header: "",
      cell: (r) => (
        <div className="flex items-center justify-end gap-1">
          <Button
            size="icon"
            variant="ghost"
            className="size-8"
            title="Preview resume"
            aria-label={`Preview ${r.student_name}'s resume`}
            onClick={() => setPreviewResume(r)}
          >
            <Eye className="size-4" />
          </Button>
          {isAdmin && (
            <Button
              size="icon"
              variant="ghost"
              className="size-8"
              title="Download resume"
              aria-label={`Download ${r.student_name}'s resume`}
              onClick={() => handleDownload(r)}
            >
              <Download className="size-4" />
            </Button>
          )}
          {isAdmin && (
            <Button
              size="icon"
              variant="ghost"
              className="size-8"
              title={r.ai_status === "COMPLETE" ? "Re-run AI analysis" : "Run AI analysis"}
              aria-label={`AI review for ${r.student_name}`}
              onClick={() => handleRetryAI(r)}
              disabled={retryingId === r.id}
            >
              {retryingId === r.id ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Sparkles className="size-4" />
              )}
            </Button>
          )}
        </div>
      ),
    },
  ];

  // Shared filter bar - shown on both tabs. Search, CR-only, branch (admins)
  // and section filters apply to whichever list is visible.
  const filtersBar = (actions?: ReactNode) => (
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
      <Select value={crOnly} onValueChange={(v) => setFilter("cr", v ?? "")}>
        <SelectTrigger className="w-36">
          <SelectValue placeholder="All students">
            {crOnly ? "CRs only" : undefined}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="1">CRs only</SelectItem>
        </SelectContent>
      </Select>
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
      {actions}
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
  );

  return (
    <RoleGuard roles={["FACULTY", "SUPER_ADMIN"]}>
      <PageHeader
        title="Student Resumes"
        description={
          isAdmin
            ? "Browse resumes uploaded by students across every branch, or see every student's upload status."
            : `Resumes of every student in the ${user?.branch_code || user?.branch_name || ""} branch, organised by section.`
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
          {filtersBar()}
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
          {filtersBar()}

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
            Students manage their own resumes — they can upload, preview, replace or delete them from their profile.
          </p>
        </TabsContent>
      </Tabs>

      {previewResume && (
        <PdfPreviewDialog
          apiPath={`/resumes/${previewResume.id}/preview/`}
          title={`${previewResume.student_name} — ${previewResume.file_name}`}
          open={!!previewResume}
          onOpenChange={(open) => { if (!open) setPreviewResume(null); }}
        />
      )}
    </RoleGuard>
  );
}
