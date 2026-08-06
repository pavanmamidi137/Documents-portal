"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { BookOpen, FileUp, Loader2, Share2, UploadCloud } from "lucide-react";
import { toast } from "sonner";

import { Checkbox } from "@/components/ui/checkbox";

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
  const isAdmin = user?.is_super_admin ?? false;
  const isCr = user?.is_cr ?? false;
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [fileError, setFileError] = useState("");
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
    watch,
    setValue,
    reset,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { description: "" } });

  const selectedBranch = watch("branch");
  const selectedSemester = watch("semester");

  // watch() inside useMemo keeps dependent selects in sync (RHF-safe pattern).
  const sections = useMemo(
    () => {
      const branch = watch("branch");
      return meta.sections.filter((s) => !branch || s.branch === Number(branch));
    },
    [meta.sections, watch]
  );
  const subjects = useMemo(
    () => {
      const semester = watch("semester");
      const branch = watch("branch");
      // Subjects allotted by the admin branch-wise (a subject with no branch is
      // college-wide and available to every branch of that semester).
      return meta.subjects.filter(
        (s) =>
          s.semester === Number(semester) &&
          (!branch || !s.branch || s.branch === Number(branch))
      );
    },
    [meta.subjects, watch]
  );
  const selectedSubject = watch("subject");
  const subjectName =
    meta.subjects.find((s) => s.id === Number(selectedSubject))?.name ?? "";
  // Sections the admin can additionally share with (same branch, excluding the
  // primary one). For CRs the primary is always their own assigned section.
  const shareableSections = useMemo(
    () => {
      const branch = watch("branch");
      const primary = isCr ? user?.section : Number(watch("section"));
      return meta.sections.filter(
        (s) => s.branch === Number(branch) && s.id !== primary
      );
    },
    [meta.sections, watch, isCr, user?.section]
  );

  const toggleShared = (id: number, checked: boolean) => {
    setSharedSections((prev) =>
      checked ? [...prev, id] : prev.filter((x) => x !== id)
    );
  };

  const resetSubjectChain = () => {
    setValue("subject", "");
    setValue("unit", "");
    titleDirty.current = false;
    setValue("title", "");
  };

  useEffect(() => {
    if (open) {
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
      });
      titleDirty.current = false;
      setFile(null);
      setFileError("");
      setSharedSections([]);
    }
  }, [open, reset, lockBranchSection, user?.branch, user?.section]);

  const onSubmit = async (values: FormValues) => {
    if (!file) {
      toast.error("Please choose a document file.");
      return;
    }
    if (!isAllowedDocument(file.name)) {
      toast.error("Unsupported file format.");
      return;
    }
    if (!values.branch || !values.section) {
      toast.error("Please select a branch and section.");
      return;
    }
    const form = new FormData();
    form.append("title", values.title);
    form.append("description", values.description ?? "");
    form.append("file", file);
    form.append("branch", values.branch);
    form.append("section", values.section);
    // Admin: one upload, shared to the primary section + any additional ones.
    const extraSections = isAdmin
      ? Array.from(new Set([Number(values.section), ...sharedSections])).filter(Boolean)
      : [];
    extraSections.forEach((id) => form.append("sections", String(id)));
    // CR: request that other sections' CRs accept this document.
    if (isCr) {
      sharedSections.forEach((id) => form.append("share_with_sections", String(id)));
    }
    form.append("semester", values.semester);
    form.append("category", values.category);
    form.append("subject", values.subject);

    setSubmitting(true);
    try {
      const doc = await http.upload<DocumentItem>("/documents/", form);
      toast.success(
        isCr && sharedSections.length > 0
          ? `Document uploaded & share requests sent to ${sharedSections.length} section${sharedSections.length === 1 ? "" : "s"}.`
          : extraSections.length > 1
          ? `Document uploaded & shared with ${extraSections.length} sections.`
          : "Document uploaded successfully."
      );
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
            <div className="space-y-2">
              <Label>Section</Label>
              <Select
                value={watch("section")}
                onValueChange={(v) => setValue("section", v ?? "")}
                disabled={lockBranchSection || sections.length === 0}
              >
                <SelectTrigger>
                  <SelectValue placeholder={lockBranchSection ? "Your section" : "Select section"} />
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
          </div>

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
              <Select value={watch("category")} onValueChange={(v) => setValue("category", v ?? "")}>
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
              value={watch("subject")}
              onValueChange={(v) => {
                setValue("subject", v ?? "");
                setValue("unit", "");
                titleDirty.current = false;
                setValue("title", "");
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select subject" />
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
            {subjects.length === 0 && selectedSemester && (
              <p className="text-xs text-muted-foreground">
                No subjects for this semester{selectedBranch ? " and branch" : ""} yet.
              </p>
            )}
            {errors.subject && <p className="text-xs text-destructive">{errors.subject.message}</p>}
          </div>

          <div className="space-y-2">
            <Label>Unit</Label>
            <Select
              value={watch("unit")}
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
            <Label htmlFor="doc-title">Title</Label>
            <Input
              id="doc-title"
              placeholder="e.g. DBMS - Unit 1"
              value={watch("title")}
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

          {selectedBranch && (isAdmin || isCr) && (
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5">
                <Share2 className="size-3.5 text-muted-foreground" />{" "}
                {isCr ? "Request share with other sections" : "Share with additional sections"}
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
                      {s.branch_name} - Sec {s.name}
                    </span>
                  </label>
                ))}
                {shareableSections.length === 0 && (
                  <p className="col-span-2 text-xs text-muted-foreground">
                    No other sections in this branch.
                  </p>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {isCr
                  ? "Their CRs get a notification and accept the document into their section — no extra upload or storage. Tick multiple sections to send the request to all of them at once."
                  : "Students in the selected sections will see this document. Tick multiple sections at once."}
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
