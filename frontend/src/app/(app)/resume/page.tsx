"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  BrainCircuit,
  CheckCircle2,
  Clock,
  Eye,
  FileText,
  FileUp,
  Lightbulb,
  ListChecks,
  Loader2,
  RefreshCw,
  RotateCcw,
  Send,
  Sparkles,
  Star,
  Trash2,
  TriangleAlert,
  TrendingUp,
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

function scoreTone(score: number) {
  if (score >= 70) return "text-emerald-600 dark:text-emerald-400";
  if (score >= 45) return "text-amber-600 dark:text-amber-400";
  return "text-rose-600 dark:text-rose-400";
}

function scoreRing(score: number) {
  if (score >= 70) return "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";
  if (score >= 45) return "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400";
  return "border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400";
}

function AiReviewCard({
  resume,
  analyzing,
  onAnalyze,
}: {
  resume: Resume;
  analyzing: boolean;
  onAnalyze: () => void;
}) {
  const analysis = resume.ai_analysis;
  const matches = resume.ai_match
    ? Object.values(resume.ai_match)
        .filter((m) => typeof m.score === "number")
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)
    : [];

  if (resume.ai_status === "PENDING") {
    return (
      <Card className="border-violet-500/30 bg-gradient-to-br from-violet-500/5 to-transparent">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BrainCircuit className="size-5 text-violet-500" /> AI Resume Review
          </CardTitle>
          <CardDescription>
            {analyzing
              ? "Analyzing your resume — this takes a few seconds."
              : resume.is_reviewed
                ? "Faculty reviewed your resume — run the AI review for a quality score and drive matches."
                : "Get a quality score and see which open drives match you best."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {analyzing ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin text-violet-500" /> Analyzing your resume…
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm text-muted-foreground">
                {resume.is_reviewed
                  ? "The review takes a few seconds and uses your AI credits."
                  : "Once faculty review your resume this runs automatically. You can also run it now to see your drive match chances early."}
              </p>
              <Button onClick={onAnalyze} variant="outline">
                <Sparkles className="size-4" /> Analyze with AI
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  if (resume.ai_status === "FAILED") {
    return (
      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TriangleAlert className="size-5 text-destructive" /> AI Resume Review
          </CardTitle>
          <CardDescription>The analysis could not be completed.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {resume.ai_error || "The AI service did not respond. Please try again."}
          </p>
          <Button onClick={onAnalyze} disabled={analyzing} className="mt-4">
            {analyzing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            Try Again
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!analysis) return null;

  return (
    <Card className="border-violet-500/30 bg-gradient-to-br from-violet-500/5 to-transparent">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BrainCircuit className="size-5 text-violet-500" /> AI Resume Review
        </CardTitle>
        <CardDescription>
          {resume.is_reviewed
            ? `Reviewed by ${resume.reviewed_by_name ?? "faculty"} — here's what the AI found.`
            : "Based on your resume, here's what the AI found."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Score + summary */}
        <div className="flex items-start gap-4">
          <div
            className={`flex size-16 shrink-0 flex-col items-center justify-center rounded-2xl border ${scoreRing(resume.ai_score ?? 0)}`}
          >
            <span className={`text-2xl font-bold tabular-nums ${scoreTone(resume.ai_score ?? 0)}`}>
              {resume.ai_score ?? 0}
            </span>
            <span className="text-[9px] font-semibold tracking-widest text-muted-foreground uppercase">
              /100
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Resume quality score</p>
            <p className="mt-1 text-sm text-muted-foreground">{analysis.summary}</p>
          </div>
        </div>

        {/* Strengths / improvements */}
        <div className="grid gap-4 sm:grid-cols-2">
          {analysis.strengths.length > 0 && (
            <div className="rounded-xl border bg-card/60 p-3">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                <Star className="size-3.5" /> Strengths
              </p>
              <ul className="space-y-1.5">
                {analysis.strengths.map((s, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                    <CheckCircle2 className="mt-0.5 size-3 shrink-0 text-emerald-500" /> {s}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {analysis.improvements.length > 0 && (
            <div className="rounded-xl border bg-card/60 p-3">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-amber-600 dark:text-amber-400">
                <Lightbulb className="size-3.5" /> Improve this
              </p>
              <ul className="space-y-1.5">
                {analysis.improvements.map((s, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                    <Lightbulb className="mt-0.5 size-3 shrink-0 text-amber-500" /> {s}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Skills + missing ATS keywords */}
        {analysis.skills.length > 0 && (
          <div>
            <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
              <ListChecks className="size-3.5" /> Skills found
            </p>
            <div className="flex flex-wrap gap-1.5">
              {analysis.skills.map((s, i) => (
                <Badge key={i} variant="outline" className="text-[11px]">
                  {s}
                </Badge>
              ))}
            </div>
          </div>
        )}
        {analysis.ats_keywords.length > 0 && (
          <div>
            <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
              <Sparkles className="size-3.5" /> Missing keywords to add (ATS)
            </p>
            <div className="flex flex-wrap gap-1.5">
              {analysis.ats_keywords.map((s, i) => (
                <Badge key={i} variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-700 text-[11px] dark:text-amber-400">
                  + {s}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Best matching drives */}
        {matches.length > 0 && (
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
              <TrendingUp className="size-3.5" /> Your best drive matches
            </p>
            <div className="space-y-2">
              {matches.map((m, i) => (
                <div key={i} className="flex items-center gap-3 rounded-xl border bg-card/60 p-3">
                  <span
                    className={`flex size-9 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${scoreRing(m.score)}`}
                  >
                    {m.score}%
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{m.company_name}</p>
                    <p className="truncate text-xs text-muted-foreground">{m.reason}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-3 border-t pt-3">
          <p className="text-[11px] text-muted-foreground">
            {resume.ai_analyzed_at ? `Analyzed ${formatDate(resume.ai_analyzed_at)}` : ""} · uses your AI credits
          </p>
          <Button onClick={onAnalyze} disabled={analyzing} size="sm" variant="outline">
            {analyzing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-3.5" />}
            Re-run
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function ResumePage() {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const autoRanRef = useRef(false);

  const { data: resume, isLoading } = useQuery({
    queryKey: ["resume", "mine"],
    queryFn: fetchMyResume,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["resume"] });

  const analyze = async () => {
    if (!resume || analyzing) return;
    setAnalyzing(true);
    try {
      const updated = await http.post<Resume>(`/resumes/${resume.id}/analyze/`, {});
      queryClient.setQueryData(["resume", "mine"], updated);
      invalidate();
      if (updated.ai_status === "COMPLETE") {
        toast.success("Resume AI review complete — check your score and drive matches.");
      } else if (updated.ai_error) {
        toast.error(updated.ai_error);
      }
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setAnalyzing(false);
    }
  };

  // Once faculty mark the resume as reviewed, run the AI review automatically
  // so the quality report is ready when the student checks. Runs once.
  useEffect(() => {
    if (!resume || resume.is_missing) return;
    if (resume.is_reviewed && resume.ai_status === "PENDING" && !autoRanRef.current) {
      autoRanRef.current = true;
      void analyze();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resume?.id, resume?.is_reviewed, resume?.ai_status]);

  // Live-check the stored file against Cloudinary once per page load, so a
  // resume deleted directly in Cloudinary shows the re-upload prompt instantly
  // and a file restored in Cloudinary reappears with a "Restored" badge.
  useEffect(() => {
    if (!resume) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await http.get<{
          id: number;
          is_missing: boolean;
          restored_at: string | null;
        }>(`/resumes/${resume.id}/check/`);
        if (cancelled) return;
        const next = {
          ...resume,
          is_missing: res.is_missing,
          restored_at: res.restored_at,
        };
        // Only write when something actually changed so the check can't loop.
        if (next.is_missing !== resume.is_missing || next.restored_at !== resume.restored_at) {
          queryClient.setQueryData(["resume", "mine"], next);
        }
      } catch {
        // Best-effort - never block the page on the check.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [resume, queryClient]);

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
                  {resume.is_missing ? (
                    <p className="mt-0.5 text-xs font-medium text-destructive">
                      <TriangleAlert className="mr-1 inline size-3.5" /> File deleted from storage —
                      re-upload to keep it visible to faculty
                    </p>
                  ) : resume.restored_at ? (
                    <p className="mt-0.5 text-xs text-emerald-600 dark:text-emerald-400">
                      <RotateCcw className="mr-1 inline size-3.5" /> File restored in storage —
                      visible to faculty again
                    </p>
                  ) : (
                    <p className="mt-0.5 text-xs text-sky-600 dark:text-sky-400">
                      <CheckCircle2 className="mr-1 inline size-3.5" /> Delivered to faculty
                    </p>
                  )}
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
                  {resume.is_missing ? (
                    <Badge
                      variant="outline"
                      className="gap-1 border-destructive/40 bg-destructive/10 text-destructive"
                    >
                      <TriangleAlert className="size-3.5" /> File missing
                    </Badge>
                  ) : resume.restored_at ? (
                    <Badge
                      variant="outline"
                      className="gap-1 border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                    >
                      <RotateCcw className="size-3.5" /> Restored
                    </Badge>
                  ) : (
                    <Badge
                      variant="outline"
                      className="gap-1 border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400"
                    >
                      <Send className="size-3.5" /> Delivered
                    </Badge>
                  )}
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
                  disabled={resume.is_missing}
                  title={resume.is_missing ? "File deleted from storage - re-upload first" : undefined}
                  onClick={async () => {
                    const err = await openResumeInNewTab(resume);
                    if (err) toast.error(err);
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

        {resume && !resume.is_missing && (
          <div className="mt-6">
            <AiReviewCard resume={resume} analyzing={analyzing} onAnalyze={analyze} />
          </div>
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
