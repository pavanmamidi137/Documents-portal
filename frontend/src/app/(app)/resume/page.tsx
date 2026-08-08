"use client";

import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  CheckCircle2,
  Clock,
  Eye,
  FileText,
  FileUp,
  Loader2,
  RefreshCw,
  Send,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/empty-state";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { fetchMyResume, http, openResumeInNewTab } from "@/lib/api";
import type { Resume } from "@/lib/types";
import { formatBytes, formatDate, getErrorMessage } from "@/lib/utils";

const ACCEPTED = ".pdf,.doc,.docx";

export default function ResumePage() {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const { data: resume, isLoading } = useQuery({
    queryKey: ["resume", "mine"],
    queryFn: fetchMyResume,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["resume"] });

  const pickFile = () => fileRef.current?.click();

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const saved = await http.upload<Resume>("/resumes/", form);
      toast.success(resume ? "Resume updated and delivered to faculty." : "Resume delivered to faculty.");
      queryClient.setQueryData(["resume", "mine"], saved);
      invalidate();
    } catch (error) {
      toast.error(`Failed to send to faculty — ${getErrorMessage(error)}`);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const confirmDelete = async () => {
    if (!resume) return;
    setDeleting(true);
    try {
      await http.delete(`/resumes/${resume.id}/`);
      toast.success("Resume deleted.");
      setDeleteOpen(false);
      queryClient.setQueryData(["resume", "mine"], null);
      invalidate();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="My Resume"
        description="Upload your resume so faculty can review it. You can preview, replace or delete it anytime."
      />

      <input
        ref={fileRef}
        type="file"
        accept={ACCEPTED}
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />

      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="mx-auto max-w-xl"
      >
        {isLoading ? (
          <Card>
            <CardContent className="flex items-center justify-center py-16">
              <Loader2 className="size-6 animate-spin text-primary" />
            </CardContent>
          </Card>
        ) : resume ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="size-5 text-primary" /> Your Resume
              </CardTitle>
              <CardDescription>
                Your resume is shared with every faculty member in your branch. Re-upload anytime to keep it current.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3 rounded-xl border bg-muted/30 p-4">
                <div className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-rose-500/10 text-rose-500">
                  <FileText className="size-6" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{resume.file_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatBytes(resume.file_size)} · Updated {formatDate(resume.updated_at)}
                  </p>
                  <p className="mt-0.5 text-xs text-sky-600 dark:text-sky-400">
                    <CheckCircle2 className="mr-1 inline size-3.5" /> Delivered to faculty
                  </p>
                  {resume.is_reviewed ? (
                    <p className="mt-0.5 text-xs text-emerald-600 dark:text-emerald-400">
                      Reviewed by {resume.reviewed_by_name ?? "faculty"}
                      {resume.reviewed_at ? ` on ${formatDate(resume.reviewed_at)}` : ""}
                    </p>
                  ) : (
                    <p className="mt-0.5 text-xs text-amber-600 dark:text-amber-400">
                      Pending faculty review — you&apos;ll see a status here once it&apos;s checked.
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  <Badge
                    variant="outline"
                    className="gap-1 border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400"
                  >
                    <Send className="size-3.5" /> Delivered
                  </Badge>
                  {resume.is_reviewed ? (
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
                  )}
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={async () => {
                    if (!(await openResumeInNewTab(resume))) {
                      toast.error("Could not load the resume file. Please try again.");
                    }
                  }}
                >
                  <Eye className="size-4" /> Preview
                </Button>
                <Button variant="outline" onClick={pickFile} disabled={uploading}>
                  {uploading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                  Replace
                </Button>
                <Button
                  variant="outline"
                  className="text-destructive hover:text-destructive"
                  onClick={() => setDeleteOpen(true)}
                  disabled={uploading}
                >
                  <Trash2 className="size-4" /> Delete
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="py-12">
              <EmptyState
                icon={FileUp}
                title="No resume uploaded yet"
                description="Upload your resume (PDF, DOC or DOCX) — faculty in your branch will be able to view it."
              />
              <div className="mt-6 flex justify-center">
                <Button onClick={pickFile} disabled={uploading} className="gap-2">
                  {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
                  {uploading ? "Uploading…" : "Upload Resume"}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <p className="mt-4 text-center text-xs text-muted-foreground">
          Only PDF, DOC and DOCX files up to 10MB are accepted.
        </p>
      </motion.div>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete your resume?"
        description="Your resume will be removed from the portal and faculty will no longer see it. This cannot be undone."
        confirmLabel="Delete"
        destructive
        loading={deleting}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
