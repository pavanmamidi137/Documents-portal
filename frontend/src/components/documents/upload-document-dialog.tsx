"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  FileStack,
  FileUp,
  Loader2,
  Share2,
  UploadCloud,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";

import {
  ALLOWED_UPLOAD_EXTENSIONS,
  getDocumentTypeMeta,
  isAllowedDocument,
  MAX_DOCUMENT_INPUT_MB,
  MAX_DOCUMENT_SIZE_MB,
  UPLOAD_UNITS,
} from "@/lib/document-types";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { http } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { MetaData, DocumentItem } from "@/lib/types";
import { cn, formatBytes, getErrorMessage } from "@/lib/utils";

const schema = z.object({
  description: z.string().optional(),
  branch: z.string().optional(),
  section: z.string().optional(),
  semester: z.string().min(1, "Select a semester"),
  category: z.string().min(1, "Select a category"),
  subject: z.string().min(1, "Select a subject"),
  unit: z.string().optional(),
  // For assignments: the last date students can submit (optional).
  submission_deadline: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

type QueueStatus = "queued" | "uploading" | "done" | "error";

interface QueueItem {
  id: string;
  file: File;
  /** Editable per file - defaults to the auto title (subject - unit) or the file name. */
  title: string;
  status: QueueStatus;
  progress: { percent: number; loaded: number; total: number } | null;
  error?: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  meta: MetaData;
  lockBranchSection?: boolean;
  onUploaded: (doc: DocumentItem) => void;
}

function newQueueId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function UploadDocumentDialog({
  open,
  onOpenChange,
  meta,
  lockBranchSection = false,
  onUploaded,
}: Props) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isAdmin = user?.is_super_admin ?? false;
  const isCr = user?.is_cr ?? false;
  // Multi-file queue: every file uploads with the SAME metadata (branch,
  // semester, subject, unit, target sections) but keeps its own editable
  // title and a live per-file progress bar.
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [fileErrors, setFileErrors] = useState<string[]>([]);
  const [titleError, setTitleError] = useState<string | null>(null);
  // Admin only: "all" = entire branch, "specific" = ticked sections.
  const [target, setTarget] = useState<"all" | "specific">("all");
  // Ticked sections for the admin target grid + the CR share-request targets.
  const [sharedSections, setSharedSections] = useState<number[]>([]);
  const pickerRef = useRef<HTMLInputElement>(null);

  const {
    register,
    handleSubmit,
    setValue,
    reset,
    control,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { description: "" } });

  // useWatch is the linter-friendly way to observe fields during render.
  const selectedBranch = useWatch({ control, name: "branch" });
  const selectedSemester = useWatch({ control, name: "semester" });
  const selectedSection = useWatch({ control, name: "section" });
  const selectedCategory = useWatch({ control, name: "category" });
  const selectedSubject = useWatch({ control, name: "subject" });
  const selectedUnit = useWatch({ control, name: "unit" });
  const selectedDeadline = useWatch({ control, name: "submission_deadline" });

  // Derived from useWatch so the selects stay in sync without re-watching
  // inside the memo (subjects with no branch are college-wide, so they appear
  // for every branch of the semester).
  const sections = useMemo(
    () => meta.sections.filter((s) => !selectedBranch || s.branch === Number(selectedBranch)),
    [meta.sections, selectedBranch]
  );
  const subjects = useMemo(
    () =>
      meta.subjects.filter(
        (s) =>
          s.semester === Number(selectedSemester) &&
          (!selectedBranch || !s.branch || s.branch === Number(selectedBranch))
      ),
    [meta.subjects, selectedSemester, selectedBranch]
  );
  const subjectName =
    meta.subjects.find((s) => s.id === Number(selectedSubject))?.name ?? "";
  // Branch codes only (per the portal-wide convention) with the full name as
  // a fallback for branches that don't have a code set.
  const branchName = (() => {
    const b = meta.branches.find((x) => x.id === Number(selectedBranch));
    return b?.code || b?.name || "";
  })();
  const semesterName =
    meta.semesters.find((s) => s.id === Number(selectedSemester))?.name ?? "";
  // Other sections in the CR's branch they can request a share with.
  const shareableSections = useMemo(
    () => {
      if (!isCr) return [];
      return meta.sections.filter(
        (s) => s.branch === Number(selectedBranch) && s.id !== user?.section
      );
    },
    [meta.sections, isCr, selectedBranch, user?.section]
  );

  const toggleShared = (id: number, checked: boolean) => {
    setSharedSections((prev) =>
      checked ? [...prev, id] : prev.filter((x) => x !== id)
    );
  };

  const setAllSections = (checked: boolean) => {
    setSharedSections(checked ? sections.map((s) => s.id) : []);
  };

  const resetSubjectChain = () => {
    setValue("subject", "");
    setValue("unit", "");
  };

  useEffect(() => {
    if (open) {
      // Refetch the shared reference data so subjects/branches/sections added
      // by the admin appear here instantly (the old bug: stale meta cache).
      void queryClient.invalidateQueries({ queryKey: ["meta"] });
      // CRs are locked to their own branch/section - default the values so
      // the submit payload always carries valid ids.
      reset({
        description: "",
        branch: lockBranchSection && user?.branch ? String(user.branch) : "",
        section: lockBranchSection && user?.section ? String(user.section) : "",
        semester: "",
        category: "",
        subject: "",
        unit: "",
        submission_deadline: "",
      });
      // Queue/file/error state starts fresh because the parent remounts the
      // dialog with a key per open.
    }
  }, [open, reset, lockBranchSection, user?.branch, user?.section, queryClient]);

  const handleFilesChange = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setFileErrors([]);
    // New files inherit the current auto title (subject - unit) or fall back
    // to the file name - every row stays editable before uploading.
    const autoTitle =
      selectedUnit && subjectName ? `${subjectName} - ${selectedUnit}` : "";
    const items: QueueItem[] = [];
    const errors: string[] = [];
    for (const f of Array.from(files)) {
      if (!isAllowedDocument(f.name)) {
        errors.push(
          `Skipped "${f.name}" — unsupported format. Choose a ${ALLOWED_UPLOAD_EXTENSIONS.join(", ").toUpperCase()} file.`
        );
        continue;
      }
      if (f.size > MAX_DOCUMENT_INPUT_MB * 1024 * 1024) {
        errors.push(
          `Skipped "${f.name}" — it exceeds the ${MAX_DOCUMENT_INPUT_MB} MB upload ceiling.`
        );
        continue;
      }
      const fallbackTitle = f.name.replace(/\.[^.]+$/, "");
      items.push({
        id: newQueueId(),
        file: f,
        title: autoTitle || fallbackTitle,
        status: "queued",
        progress: null,
      });
    }
    if (items.length > 0) {
      setQueue((prev) => [...prev, ...items]);
      setTitleError(null);
    }
    if (errors.length > 0) setFileErrors(errors);
    // Let the picker be re-opened with the same files (e.g. after skipping).
    if (pickerRef.current) pickerRef.current.value = "";
  };

  const updateTitle = (id: string, title: string) => {
    setTitleError(null);
    setQueue((q) => q.map((x) => (x.id === id ? { ...x, title } : x)));
  };

  const removeItem = (id: string) => {
    setQueue((q) => q.filter((x) => x.id !== id));
  };

  const clearQueue = () => {
    setQueue([]);
    setFileErrors([]);
    setTitleError(null);
  };

  const doneCount = queue.filter((x) => x.status === "done").length;
  const failedCount = queue.filter((x) => x.status === "error").length;
  const pendingCount = queue.filter((x) => x.status !== "done").length;
  // Overall progress = bytes completed across the whole batch.
  const overallProgress = useMemo(() => {
    const total = queue.reduce((s, x) => s + x.file.size, 0);
    if (total === 0) return 0;
    const loaded = queue.reduce(
      (s, x) => s + (x.status === "done" ? x.file.size : (x.progress?.loaded ?? 0)),
      0
    );
    return Math.round((loaded / total) * 100);
  }, [queue]);

  const onSubmit = async (values: FormValues) => {
    const pending = queue.filter((x) => x.status !== "done");
    if (queue.length === 0) {
      toast.error("Please choose at least one document file.");
      return;
    }
    if (pending.length === 0) {
      toast.error("Nothing to upload — every file in the queue is already uploaded.");
      return;
    }
    // Titles are per-file now (validated here instead of the form schema).
    const untitled = pending.filter((x) => x.title.trim().length < 3);
    if (untitled.length > 0) {
      const msg = `Give every file a title of at least 3 characters (${
        untitled.length === 1 ? "1 file needs" : `${untitled.length} files need`
      } one).`;
      setTitleError(msg);
      toast.error(msg);
      return;
    }
    setTitleError(null);
    if (!values.branch) {
      toast.error("Please select a branch.");
      return;
    }

    // Shared metadata is validated ONCE for the whole batch.
    let uploadedSectionCount = 0;
    let adminTargetIds: number[] = [];
    if (isAdmin) {
      if (sections.length === 0) {
        toast.error("This branch has no sections yet. Add sections in Admin → Sections.");
        return;
      }
      adminTargetIds =
        target === "all"
          ? sections.map((s) => s.id)
          : Array.from(new Set(sharedSections));
      if (adminTargetIds.length === 0) {
        toast.error("Select at least one section.");
        return;
      }
      uploadedSectionCount = adminTargetIds.length;
    } else if (!values.section) {
      toast.error("Please select a section.");
      return;
    }

    setSubmitting(true);
    let ok = 0;
    let failed = 0;
    for (const item of pending) {
      setQueue((q) =>
        q.map((x) =>
          x.id === item.id
            ? { ...x, status: "uploading" as const, progress: null, error: undefined }
            : x
        )
      );
      const form = new FormData();
      form.append("title", item.title.trim());
      form.append("description", values.description ?? "");
      form.append("file", item.file);
      form.append("branch", values.branch);
      if (isAdmin) {
        adminTargetIds.forEach((id) => form.append("sections", String(id)));
      } else {
        form.append("section", values.section as string);
        // Request sharing with other sections' CRs (multi-select).
        sharedSections.forEach((id) => form.append("share_with_sections", String(id)));
      }
      form.append("semester", values.semester);
      form.append("category", values.category);
      form.append("subject", values.subject);
      if (values.submission_deadline) {
        form.append("submission_deadline", values.submission_deadline);
      }

      try {
        const doc = await http.uploadWithProgress<DocumentItem>("/documents/", form, (p) =>
          setQueue((q) =>
            q.map((x) => (x.id === item.id ? { ...x, progress: p } : x))
          )
        );
        setQueue((q) =>
          q.map((x) =>
            x.id === item.id
              ? {
                  ...x,
                  status: "done" as const,
                  progress: { percent: 100, loaded: x.file.size, total: x.file.size },
                }
              : x
          )
        );
        onUploaded(doc);
        ok += 1;
      } catch (error) {
        const msg = getErrorMessage(error);
        setQueue((q) =>
          q.map((x) => (x.id === item.id ? { ...x, status: "error" as const, error: msg } : x))
        );
        failed += 1;
      }
    }
    setSubmitting(false);

    const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
    if (failed === 0) {
      if (isAdmin) {
        toast.success(
          ok === 1
            ? target === "all"
              ? `Document uploaded to all ${uploadedSectionCount} sections of ${branchName}.`
              : `Document uploaded to ${uploadedSectionCount} section${uploadedSectionCount === 1 ? "" : "s"}.`
            : `${plural(ok, "document")} uploaded to ${
                target === "all"
                  ? `all ${uploadedSectionCount} sections of ${branchName}`
                  : `${uploadedSectionCount} section${uploadedSectionCount === 1 ? "" : "s"}`
              }.`
        );
      } else if (isCr && sharedSections.length > 0) {
        toast.success(
          `${ok === 1 ? "Document" : plural(ok, "documents")} uploaded & share requests sent to ${
            sharedSections.length
          } section${sharedSections.length === 1 ? "" : "s"}.`
        );
      } else {
        toast.success(ok === 1 ? "Document uploaded successfully." : `${plural(ok, "document")} uploaded successfully.`);
      }
      onOpenChange(false);
    } else {
      toast.error(
        `${ok} uploaded, ${failed} failed — fix or remove the failed files below, then press Retry.`
      );
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        // Never let ESC/backdrop close the dialog mid-batch - the uploads
        // would keep running invisibly. The Cancel button is already disabled.
        if (submitting && !v) return;
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UploadCloud className="size-5 text-primary" /> Upload Document
          </DialogTitle>
          <DialogDescription>
            Pick the subject, then choose the unit — the title fills in by itself. You can select
            multiple files at once — each gets its own title and progress bar.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Branch</Label>
              <Select
                value={selectedBranch}
                onValueChange={(v) => {
                  setValue("branch", v ?? "");
                  setValue("section", "");
                  setSharedSections([]);
                  setTarget("all");
                  resetSubjectChain();
                }}
                disabled={lockBranchSection || submitting}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select branch" />
                </SelectTrigger>
                <SelectContent>
                  {meta.branches.map((b) => (
                    <SelectItem key={b.id} value={String(b.id)}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {isCr ? (
              <div className="space-y-2">
                <Label>Section</Label>
                <Select
                  value={selectedSection}
                  onValueChange={(v) => setValue("section", v ?? "")}
                  disabled={lockBranchSection || sections.length === 0 || submitting}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Your section" />
                  </SelectTrigger>
                  <SelectContent>
                    {sections.map((s) => (
                      <SelectItem key={s.id} value={String(s.id)}>
                        {s.branch_code || s.branch_name} - {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="flex items-end pb-1">
                <div
                  className="flex w-full items-center gap-2 rounded-lg border bg-muted/20 px-3 py-2"
                  title="Upload to every section of the selected branch"
                >
                  <Switch
                    disabled={!selectedBranch || submitting}
                    checked={target === "all"}
                    onCheckedChange={(v) => {
                      const next = v ? "all" : "specific";
                      setTarget(next);
                      // Switching to specific sections starts with all ticked,
                      // so the admin just unchecks what they don't want.
                      if (next === "specific" && sharedSections.length === 0) {
                        setSharedSections(sections.map((s) => s.id));
                      }
                    }}
                  />
                  <span className="text-xs font-medium leading-tight">
                    Entire branch
                    <span className="block font-normal text-muted-foreground">
                      all sections
                    </span>
                  </span>
                </div>
              </div>
            )}
          </div>

          {isAdmin && selectedBranch && (
            <div className="space-y-2 rounded-xl border bg-muted/20 p-3">
              {target === "all" ? (
                <p className="flex items-center gap-2 text-sm">
                  <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
                  {queue.length > 0
                    ? `All ${queue.length} file${queue.length === 1 ? "" : "s"} will be uploaded to `
                    : "This document will be uploaded to "}
                  <span className="font-semibold">
                    all {sections.length} section{sections.length === 1 ? "" : "s"}
                  </span>{" "}
                  of {branchName}.
                </p>
              ) : (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <Label className="text-sm">Choose sections</Label>
                    <div className="flex gap-3 text-xs">
                      <button
                        type="button"
                        className="font-medium text-primary hover:underline"
                        onClick={() => setAllSections(true)}
                      >
                        Select all
                      </button>
                      <button
                        type="button"
                        className="font-medium text-muted-foreground hover:underline"
                        onClick={() => setAllSections(false)}
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                  <div className="grid max-h-44 grid-cols-2 gap-1.5 overflow-y-auto">
                    {sections.map((s) => (
                      <label
                        key={s.id}
                        className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted/50"
                      >
                        <Checkbox
                          checked={sharedSections.includes(s.id)}
                          onCheckedChange={(v) => toggleShared(s.id, v === true)}
                        />
                        <span className="truncate">
                          {s.branch_code || s.branch_name} · Sec {s.name}
                        </span>
                      </label>
                    ))}
                    {sections.length === 0 && (
                      <p className="col-span-2 text-xs text-muted-foreground">
                        No sections in this branch yet.
                      </p>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Semester</Label>
              <Select
                value={selectedSemester}
                onValueChange={(v) => {
                  setValue("semester", v ?? "");
                  resetSubjectChain();
                }}
                disabled={submitting}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select semester" />
                </SelectTrigger>
                <SelectContent>
                  {meta.semesters.map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.semester && <p className="text-xs text-destructive">{errors.semester.message}</p>}
            </div>
            <div className="space-y-2">
              <Label>Category</Label>
              <Select value={selectedCategory} onValueChange={(v) => setValue("category", v ?? "")} disabled={submitting}>
                <SelectTrigger>
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {meta.categories.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.category && <p className="text-xs text-destructive">{errors.category.message}</p>}
            </div>
          </div>

          <div className="space-y-2">
            <Label className="flex items-center gap-1.5">
              <BookOpen className="size-3.5 text-muted-foreground" /> Subject
            </Label>
            <Select
              value={selectedSubject}
              onValueChange={(v) => {
                setValue("subject", v ?? "");
                setValue("unit", "");
              }}
              disabled={!selectedSemester || subjects.length === 0 || submitting}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={
                    !selectedSemester
                      ? "Select semester first"
                      : subjects.length === 0
                      ? "No subjects available"
                      : "Select subject"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {subjects.map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    <span>{s.name}</span>
                    {s.code && <span className="ml-1 text-xs text-muted-foreground">({s.code})</span>}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!selectedSemester ? (
              <p className="text-xs text-muted-foreground">
                Select a semester first to load its subjects.
              </p>
            ) : subjects.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No subjects for {semesterName}
                {selectedBranch ? ` in ${branchName}` : ""} yet — add them in Admin → Subjects
                (or use Bulk Import), then reopen this dialog to see them.
              </p>
            ) : null}
            {errors.subject && <p className="text-xs text-destructive">{errors.subject.message}</p>}
          </div>

          <div className="space-y-2">
            <Label>Unit</Label>
            <Select
              value={selectedUnit}
              onValueChange={(v) => setValue("unit", v ?? "")}
              disabled={submitting}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select unit (fills new file titles)" />
              </SelectTrigger>
              <SelectContent>
                {UPLOAD_UNITS.map((u) => (
                  <SelectItem key={u} value={u}>
                    {u}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              New files you add get the title “{subjectName || "Subject"} - {selectedUnit || "Unit"}”
              automatically — you can still edit each title before uploading.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Submission Deadline</Label>
            <Input
              type="date"
              value={selectedDeadline}
              onChange={(e) => setValue("submission_deadline", e.target.value)}
              placeholder="Last date to submit (optional)"
              disabled={submitting}
            />
            <p className="text-xs text-muted-foreground">
              For assignments: the last date students can submit. Shown as a badge on the
              document — optional for other files.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Document Files</Label>
            <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-6 text-center transition-colors hover:border-primary/50 hover:bg-muted/40">
              <FileUp className="size-6 text-muted-foreground" />
              <p className="text-sm font-medium">
                Click to choose document{queue.length === 1 ? "" : "s"}
              </p>
              <p className="text-xs text-muted-foreground">
                You can pick multiple files at once — each file uploads with its own progress bar.
              </p>
              <p className="text-[11px] text-muted-foreground">
                PDF, PPT, PPTX, DOC, DOCX or TXT · up to {MAX_DOCUMENT_SIZE_MB} MB (larger files are compressed automatically)
              </p>
              <input
                ref={pickerRef}
                type="file"
                multiple
                accept=".pdf,.ppt,.pptx,.doc,.docx,.txt,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/plain"
                className="hidden"
                disabled={submitting}
                onChange={(e) => handleFilesChange(e.target.files)}
              />
            </label>
            {fileErrors.length > 0 && (
              <ul className="space-y-1 text-xs text-destructive">
                {fileErrors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            )}
          </div>

          {queue.length > 0 && (
            <div className="space-y-2 rounded-xl border bg-muted/20 p-3" aria-live="polite">
              <div className="flex items-center justify-between gap-2">
                <Label className="flex items-center gap-1.5 text-sm">
                  <FileStack className="size-3.5 text-muted-foreground" />
                  Upload queue
                  <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary tabular-nums">
                    {queue.length}
                  </span>
                </Label>
                {queue.length > 1 && (
                  <button
                    type="button"
                    onClick={clearQueue}
                    disabled={submitting}
                    className="text-xs font-medium text-muted-foreground transition-colors hover:text-destructive hover:underline disabled:opacity-40"
                  >
                    Clear all
                  </button>
                )}
              </div>
              {titleError && (
                <p className="flex items-center gap-1.5 rounded-lg border border-destructive/30 bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">
                  <AlertCircle className="size-3.5 shrink-0" /> {titleError}
                </p>
              )}
              <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
                {queue.map((item) => {
                  const metaIcon = getDocumentTypeMeta(item.file.name);
                  return (
                    <div key={item.id} className="space-y-1.5 rounded-lg border bg-background p-2.5">
                      <div className="flex items-start gap-2.5">
                        <div
                          className={`flex size-8 shrink-0 items-center justify-center rounded-md ring-1 ${metaIcon.classes}`}
                        >
                          <metaIcon.Icon className="size-4" />
                        </div>
                        <div className="min-w-0 flex-1 space-y-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <p className="truncate text-xs font-medium">{item.file.name}</p>
                            <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
                              {(item.file.size / 1024 / 1024).toFixed(2)} MB
                            </span>
                          </div>
                          <Input
                            value={item.title}
                            onChange={(e) => updateTitle(item.id, e.target.value)}
                            disabled={submitting || item.status === "done"}
                            placeholder="Title (min 3 characters)"
                            aria-label={`Title for ${item.file.name}`}
                            className="h-7 text-xs"
                          />
                          <div className="flex items-center gap-2">
                            {item.status === "queued" && (
                              <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                                <span className="size-1.5 rounded-full bg-muted-foreground/50" />
                                Queued
                              </span>
                            )}
                            {item.status === "uploading" && (
                              <>
                                <Loader2 className="size-3 shrink-0 animate-spin text-primary" />
                                <div className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                                  <div
                                    className="h-full rounded-full bg-primary transition-[width] duration-150 ease-out"
                                    style={{ width: `${item.progress?.percent ?? 0}%` }}
                                  />
                                </div>
                                <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                                  {item.progress?.percent ?? 0}% ·{" "}
                                  {formatBytes(item.progress?.loaded ?? 0)}
                                </span>
                              </>
                            )}
                            {item.status === "done" && (
                              <span className="flex items-center gap-1 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                                <CheckCircle2 className="size-3" /> Uploaded
                              </span>
                            )}
                            {item.status === "error" && (
                              <span className="flex min-w-0 flex-1 items-center gap-1 text-[10px] text-destructive">
                                <AlertCircle className="size-3 shrink-0" />
                                <span className="truncate">{item.error ?? "Upload failed"}</span>
                              </span>
                            )}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeItem(item.id)}
                          disabled={submitting || item.status === "uploading"}
                          title="Remove from queue"
                          aria-label={`Remove ${item.file.name} from queue`}
                          className={cn(
                            "rounded-md p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
                          )}
                        >
                          <X className="size-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
              {/* Overall progress across the whole batch */}
              {submitting && (
                <div className="space-y-1 pt-1">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-muted-foreground">Overall</span>
                    <span className="font-medium tabular-nums">
                      {doneCount} of {queue.length} · {overallProgress}%
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-primary to-primary/60 transition-[width] duration-200 ease-out"
                      style={{ width: `${overallProgress}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="doc-desc">Description (optional)</Label>
            <Textarea
              id="doc-desc"
              rows={2}
              placeholder="Short description…"
              disabled={submitting}
              {...register("description")}
            />
          </div>

          {isCr && selectedBranch && (
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5">
                <Share2 className="size-3.5 text-muted-foreground" /> Request share with other
                sections
                <span className="text-xs font-normal text-muted-foreground">(optional)</span>
              </Label>
              <div className="grid max-h-44 grid-cols-2 gap-1.5 overflow-y-auto rounded-xl border p-3">
                {shareableSections.map((s) => (
                  <label
                    key={s.id}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted/50"
                  >
                    <Checkbox
                      checked={sharedSections.includes(s.id)}
                      onCheckedChange={(v) => toggleShared(s.id, v === true)}
                    />
                    <span className="truncate">
                      {s.branch_code || s.branch_name} · Sec {s.name}
                    </span>
                  </label>
                ))}
                {shareableSections.length === 0 && (
                  <p className="col-span-2 text-xs text-muted-foreground">
                    No other sections in {branchName} yet — ask the admin to add sections.
                  </p>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Their CRs get a notification and accept the document into their section — no extra
                upload or storage. Tick multiple sections to send the request to all of them at once.
              </p>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || queue.length === 0} className="min-w-36">
              {submitting && <Loader2 className="size-4 animate-spin" />}
              {submitting
                ? `Uploading… ${overallProgress}%`
                : failedCount > 0
                ? pendingCount > failedCount
                  ? "Retry uploads"
                  : `Retry ${failedCount} failed`
                : `Upload ${queue.length > 1 ? `${queue.length} ` : ""}Document${queue.length === 1 ? "" : "s"}`}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
