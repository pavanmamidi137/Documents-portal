"use client";

import { useState } from "react";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { CheckCircle2, Circle, Clock, Download, Eye, FileText } from "lucide-react";
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
import { useMetaData } from "@/lib/use-meta";
import { useAuth } from "@/lib/auth";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { http } from "@/lib/api";
import type { Paginated, Resume } from "@/lib/types";
import { cn, formatBytes, formatDate, getErrorMessage } from "@/lib/utils";

export default function FacultyResumesPage() {
  const { user } = useAuth();
  const { data: meta } = useMetaData();
  const queryClient = useQueryClient();
  const isAdmin = user?.is_super_admin ?? false;

  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [q, setQ] = useState("");
  const debouncedQ = useDebouncedValue(q);
  const [branch, setBranch] = useState("");
  const [section, setSection] = useState("");

  const branches = meta?.branches ?? [];
  // Faculty are locked to their own branch; admins pick from all branches.
  const effectiveBranch = isAdmin ? branch : String(user?.branch ?? "");
  const sections = (meta?.sections ?? []).filter((s) =>
    effectiveBranch ? s.branch === Number(effectiveBranch) : true
  );

  const setFilter = (key: string, value: string) => {
    setPage(1);
    if (key === "branch") setSection("");
    if (key === "branch") setBranch(value);
    else setSection(value);
  };

  const currentQueryKey = ["resumes", "list", page, pageSize, debouncedQ, branch, section] as const;

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
      // Cloudinary attachment URL forces a download of the file.
      const url = resume.cloudinary_url.replace("/raw/upload/", "/raw/upload/fl_attachment/");
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = resume.file_name;
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  const columns: Column<Resume>[] = [
    {
      key: "student",
      header: "Student",
      cell: (r) => (
        <div className="flex items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500/15 to-violet-500/15 text-xs font-bold text-indigo-600 ring-1 ring-indigo-500/30 dark:text-indigo-400">
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
            title="Preview resume"
            aria-label={`Preview ${r.student_name}'s resume`}
            onClick={() => window.open(r.cloudinary_url, "_blank", "noopener")}
          >
            <Eye className="size-4" />
          </Button>
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
            ? "Browse resumes uploaded by students across every branch."
            : `Resumes of every student in the ${user?.branch_name ?? ""} branch, organised by section.`
        }
      />

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
        {isAdmin && (
          <Select value={branch} onValueChange={(v) => setFilter("branch", v ?? "")}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Branch" />
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
            <SelectValue placeholder="Section" />
          </SelectTrigger>
          <SelectContent>
            {sections.map((s) => (
              <SelectItem key={s.id} value={String(s.id)}>
                Sec {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
        Students manage their own resumes — they can upload, preview, replace or delete them from their profile.
      </p>
    </RoleGuard>
  );
}
