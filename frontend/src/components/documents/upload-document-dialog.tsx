"use client";

import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { FileUp, Loader2, UploadCloud } from "lucide-react";
import { toast } from "sonner";

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
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
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
      return meta.subjects.filter(
        (s) =>
          s.semester === Number(semester) &&
          (!branch || !s.branch || s.branch === Number(branch))
      );
    },
    [meta.subjects, watch]
  );

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
      });
      setFile(null);
    }
  }, [open, reset, lockBranchSection, user?.branch, user?.section]);


  const onSubmit = async (values: FormValues) => {
    if (!file) {
      toast.error("Please choose a PDF file.");
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
    form.append("semester", values.semester);
    form.append("category", values.category);
    form.append("subject", values.subject);

    setSubmitting(true);
    try {
      const doc = await http.upload<DocumentItem>("/documents/", form);
      toast.success("Document uploaded successfully.");
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
            PDFs are stored securely in Cloudinary — only the link is saved in the database.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="doc-title">Title</Label>
            <Input id="doc-title" placeholder="e.g. Unit 1 Notes - DBMS" {...register("title")} />
            {errors.title && <p className="text-xs text-destructive">{errors.title.message}</p>}
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

          <div className="space-y-2">
            <Label>PDF File</Label>
            <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-6 text-center transition-colors hover:border-primary/50 hover:bg-muted/40">
              <FileUp className="size-6 text-muted-foreground" />
              {file ? (
                <div>
                  <p className="text-sm font-medium text-foreground">{file.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {(file.size / 1024 / 1024).toFixed(2)} MB
                  </p>
                </div>
              ) : (
                <>
                  <p className="text-sm font-medium">Click to choose a PDF</p>
                  <p className="text-xs text-muted-foreground">PDF only, max 20 MB</p>
                </>
              )}
              <input
                type="file"
                accept="application/pdf,.pdf"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Branch</Label>
              <Select
                value={selectedBranch}
                onValueChange={(v) => {
                  setValue("branch", v ?? "");
                  setValue("section", "");
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
              <Select value={selectedSemester} onValueChange={(v) => setValue("semester", v ?? "")}>
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
            <Label>Subject</Label>
            <Select value={watch("subject")} onValueChange={(v) => setValue("subject", v ?? "")}>
              <SelectTrigger>
                <SelectValue placeholder="Select subject" />
              </SelectTrigger>
              <SelectContent>
                {subjects.map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.subject && <p className="text-xs text-destructive">{errors.subject.message}</p>}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || !file}>
              {submitting && <Loader2 className="size-4 animate-spin" />}
              {submitting ? "Uploading…" : "Upload PDF"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
