"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  BookOpen,
  CheckCircle2,
  FileUp,
  Loader2,
  Share2,
  UploadCloud,
} from "lucide-react";
import { toast } from "sonner";

import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";

import {
  ALLOWED_UPLOAD_EXTENSIONS,
  getDocumentTypeMeta,
  isAllowedDocument,
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
import { getErrorMessage } from "@/lib/utils";

const schema = z.object({
  title: z.string().min(3, "Title must be at least 3 characters"),
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

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  meta: MetaData;
  lockBranchSection?: boolean;
  onUploaded: (doc: DocumentItem) => void;
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
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [fileError, setFileError] = useState("");
  // Admin only: "all" = entire branch, "specific" = ticked sections.
  const [target, setTarget] = useState<"all" | "specific">("all");
  // Ticked sections for the admin target grid + the CR share-request targets.
  const [sharedSections, setSharedSections] = useState<number[]>([]);
  const titleDirty = useRef(false);
  const fileMeta = file ? getDocumentTypeMeta(file.name) : null;

  const handleFileChange = (f: File | null) => {
    setFileError("");
    if (!f) {
      setFile(null);
      return;
    }
    if (!isAllowedDocument(f.name)) {
      setFileError(
        `Unsupported format. Choose a ${ALLOWED_UPLOAD_EXTENSIONS.join(", ").toUpperCase()} file.`
      );
      setFile(null);
      return;
    }
    if (f.size > MAX_DOCUMENT_SIZE_MB * 1024 * 1024) {
      setFileError(`File exceeds the ${MAX_DOCUMENT_SIZE_MB} MB size limit.`);
      setFile(null);
      return;
    }
    setFile(f);
  };
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
  const selectedTitle = useWatch({ control, name: "title" });
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
  const branchName =
    meta.branches.find((b) => b.id === Number(selectedBranch))?.name ?? "";
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
    titleDirty.current = false;
    setValue("title", "");
  };

  useEffect(() => {
    if (open) {
      // Refetch the shared reference data so subjects/branches/sections added
      // by the admin appear here instantly (the old bug: stale meta cache).
      void queryClient.invalidateQueries({ queryKey: ["meta"] });
      // CRs are locked to their own branch/section - default the values so
      // the submit payload always carries valid ids.
      reset({
        title: "",
        description: "",
        branch: lockBranchSection && user?.branch ? String(user.branch) : "",
        section: lockBranchSection && user?.section ? String(user.section) : "",
        semester: "",
        category: "",
        subject: "",
        unit: "",
        submission_deadline: "",
      });
      titleDirty.current = false;
      // File/error/selection state is reset by the parent's `key` remount.
    }
  }, [open, reset, lockBranchSection, user?.branch, user?.section, queryClient]);

  const onSubmit = async (values: FormValues) => {
    if (!file) {
      toast.error("Please choose a document file.");
      return;
    }
    if (!isAllowedDocument(file.name)) {
      toast.error("Unsupported file format.");
      return;
    }
    if (!values.branch) {
      toast.error("Please select a branch.");
      return;
    }
    const form = new FormData();
    form.append("title", values.title);
    form.append("description", values.description ?? "");
    form.append("file", file);
    form.append("branch", values.branch);

    let uploadedSectionCount = 0;
    if (isAdmin) {
      // Admin: one upload to the whole branch (every section) or to the
      // specific sections they ticked.
      if (sections.length === 0) {
        toast.error("This branch has no sections yet. Add sections in Admin → Sections.");
        return;
      }
      const targetIds =
        target === "all"
          ? sections.map((s) => s.id)
          : Array.from(new Set(sharedSections));
      if (targetIds.length === 0) {
        toast.error("Select at least one section.");
        return;
      }
      targetIds.forEach((id) => form.append("sections", String(id)));
      uploadedSectionCount = targetIds.length;
    } else {
      // CR: always uploads to their own assigned section.
      if (!values.section) {
        toast.error("Please select a section.");
        return;
      }
      form.append("section", values.section);
      // Request sharing with other sections' CRs (multi-select).
      sharedSections.forEach((id) => form.append("share_with_sections", String(id)));
    }

    form.append("semester", values.semester);
    form.append("category", values.category);
    form.append("subject", values.subject);
    if (values.submission_deadline) {
      form.append("submission_deadline", values.submission_deadline);
    }

    setSubmitting(true);
    try {
      const doc = await http.upload<DocumentItem>("/documents/", form);
      if (isAdmin) {
        toast.success(
          target === "all"
            ? `Document uploaded to all ${uploadedSectionCount} sections of ${branchName}.`
            : `Document uploaded to ${uploadedSectionCount} section${uploadedSectionCount === 1 ? "" : "s"}.`
        );
      } else if (isCr && sharedSections.length > 0) {
        toast.success(
          `Document uploaded & share requests sent to ${sharedSections.length} section${sharedSections.length === 1 ? "" : "s"}.`
        );
      } else {
        toast.success("Document uploaded successfully.");
      }
      onUploaded(doc);
      onOpenChange(false);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UploadCloud className="size-5 text-primary" /> Upload Document
          </DialogTitle>
          <DialogDescription>
            Pick the subject, then choose the unit — the title fills in by itself. PDF, PPT, DOCX
            or TXT files are stored securely in Cloudinary.
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
                disabled={lockBranchSection}
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
                  disabled={lockBranchSection || sections.length === 0}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Your section" />
                  </SelectTrigger>
                  <SelectContent>
                    {sections.map((s) => (
                      <SelectItem key={s.id} value={String(s.id)}>
                        {s.branch_name} - {s.name}
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
                    disabled={!selectedBranch}
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
                  This document will be uploaded to{" "}
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
              <Select value={selectedCategory} onValueChange={(v) => setValue("category", v ?? "")}>
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
                titleDirty.current = false;
                setValue("title", "");
              }}
              disabled={!selectedSemester || subjects.length === 0}
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
              onValueChange={(v) => {
                const unit = v ?? "";
                setValue("unit", unit);
                if (unit && subjectName && !titleDirty.current) {
                  setValue("title", `${subjectName} - ${unit}`);
                }
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select unit (fills the title)" />
              </SelectTrigger>
              <SelectContent>
                {UPLOAD_UNITS.map((u) => (
                  <SelectItem key={u} value={u}>
                    {u}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Submission Deadline</Label>
            <Input
              type="date"
              value={selectedDeadline}
              onChange={(e) => setValue("submission_deadline", e.target.value)}
              placeholder="Last date to submit (optional)"
            />
            <p className="text-xs text-muted-foreground">
              For assignments: the last date students can submit. Shown as a badge on the
              document — optional for other files.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="doc-title">Title</Label>
            <Input
              id="doc-title"
              placeholder="e.g. DBMS - Unit 1"
              value={selectedTitle}
              onChange={(e) => {
                titleDirty.current = true;
                setValue("title", e.target.value);
              }}
            />
            {errors.title && <p className="text-xs text-destructive">{errors.title.message}</p>}
          </div>

          <div className="space-y-2">
            <Label>Document File</Label>
            <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-6 text-center transition-colors hover:border-primary/50 hover:bg-muted/40">
              {file && fileMeta ? (
                <>
                  <div className={`flex size-10 items-center justify-center rounded-lg ring-1 ${fileMeta.classes}`}>
                    <fileMeta.Icon className="size-5" />
                  </div>
                  <p className="text-sm font-medium text-foreground">{file.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {(file.size / 1024 / 1024).toFixed(2)} MB · {fileMeta.label}
                  </p>
                </>
              ) : (
                <>
                  <FileUp className="size-6 text-muted-foreground" />
                  <p className="text-sm font-medium">Click to choose a document</p>
                  <p className="text-xs text-muted-foreground">
                    PDF, PPT, PPTX, DOC, DOCX or TXT · max {MAX_DOCUMENT_SIZE_MB} MB
                  </p>
                </>
              )}
              <input
                type="file"
                accept=".pdf,.ppt,.pptx,.doc,.docx,.txt,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/plain"
                className="hidden"
                onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
              />
            </label>
            {fileError && <p className="text-xs text-destructive">{fileError}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="doc-desc">Description (optional)</Label>
            <Textarea
              id="doc-desc"
              rows={2}
              placeholder="Short description…"
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
            <Button type="submit" disabled={submitting || !file}>
              {submitting && <Loader2 className="size-4 animate-spin" />}
              {submitting ? "Uploading…" : "Upload Document"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
