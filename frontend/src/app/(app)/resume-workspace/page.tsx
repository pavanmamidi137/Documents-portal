"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BrainCircuit,
  Check,
  Copy,
  Download,
  Eye,
  FileCode2,
  FileText,
  FileUp,
  Lightbulb,
  Loader2,
  RefreshCw,
  Sparkles,
  Star,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  TriangleAlert,
  Upload,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/layout/page-header";
import { useAuth } from "@/lib/auth";
import { useRouter } from "next/navigation";
import { EmptyState } from "@/components/empty-state";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { http } from "@/lib/api";
import type { ResumeWorkspace, ResumeAiAnalysis } from "@/lib/types";
import { cn, formatBytes, formatDate, getErrorMessage } from "@/lib/utils";

const ACCEPTED = ".pdf,.doc,.docx";

/** A safe file-name prefix for the rebuilt resume downloads. */
function slugName(p: ResumeWorkspace): string {
  const base = (p.owner_name || "resume").toLowerCase();
  return base.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "resume";
}

/** 0-100 AI score -> 0-5 stars. */
function scoreToStars(score: number | null): number {
  if (score == null) return 0;
  return Math.min(5, Math.max(0, Math.round(score / 10) / 2));
}

function scoreRing(score: number) {
  if (score >= 70) return "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";
  if (score >= 45) return "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400";
  return "border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400";
}

function StarRating({ score }: { score: number | null }) {
  const stars = scoreToStars(score);
  return (
    <div className="flex items-center gap-0.5" aria-label={`${stars} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => {
        const filled = stars >= i;
        const half = !filled && stars >= i - 0.5;
        return (
          <Star
            key={i}
            className={cn(
              "size-5",
              filled
                ? "fill-amber-400 text-amber-400"
                : half
                  ? "fill-amber-400/40 text-amber-400"
                  : "text-muted-foreground/30"
            )}
          />
        );
      })}
      <span className="ml-1.5 text-sm font-semibold tabular-nums">
        {stars.toFixed(1)}
        <span className="font-normal text-muted-foreground">/5</span>
      </span>
    </div>
  );
}

function AnalysisBlock({ analysis }: { analysis: ResumeAiAnalysis }) {
  const rows = [
    { icon: ThumbsUp, title: "Pros", items: analysis.pros, tone: "text-emerald-600 dark:text-emerald-400" },
    { icon: ThumbsDown, title: "Cons", items: analysis.cons, tone: "text-rose-600 dark:text-rose-400" },
    { icon: Lightbulb, title: "Improvements", items: analysis.improvements, tone: "text-primary" },
  ];
  return (
    <div className="space-y-4">
      {analysis.summary && (
        <p className="text-sm leading-relaxed text-muted-foreground">{analysis.summary}</p>
      )}
      <div className="grid gap-4 md:grid-cols-3">
        {rows.map((row) => (
          <div key={row.title} className="rounded-xl border bg-muted/30 p-3.5">
            <p className={cn("flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide", row.tone)}>
              <row.icon className="size-3.5" /> {row.title}
            </p>
            <ul className="mt-2 space-y-1.5">
              {row.items.length === 0 && (
                <li className="text-xs text-muted-foreground/70">None listed</li>
              )}
              {row.items.map((item, i) => (
                <li key={i} className="flex gap-1.5 text-xs leading-relaxed text-foreground/90">
                  <span className="mt-1 size-1 shrink-0 rounded-full bg-current opacity-50" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      {analysis.ats_keywords.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Missing ATS keywords
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {analysis.ats_keywords.map((k) => (
              <Badge key={k} variant="outline">{k}</Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ScoreChip({ score }: { score: number | null }) {
  if (score == null) return null;
  return (
    <div className={cn("flex size-16 shrink-0 flex-col items-center justify-center rounded-2xl border", scoreRing(score))}>
      <span className="text-xl font-bold tabular-nums">{score}</span>
      <span className="text-[9px] font-semibold uppercase tracking-wider opacity-70">/ 100</span>
    </div>
  );
}

export default function ResumeWorkspacePage() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [sourceDraft, setSourceDraft] = useState<string | null>(null);
  const [showTex, setShowTex] = useState(false);

  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const isAdmin = user?.is_super_admin ?? false;

  // Super Admin only - students use the resume page (/resume) instead.
  useEffect(() => {
    if (!authLoading && user && !isAdmin) router.replace("/dashboard");
  }, [authLoading, user, isAdmin, router]);

  const { data: workspace, isLoading } = useQuery({
    queryKey: ["resume-workspace"],
    queryFn: () => http.get<ResumeWorkspace>("/resume-workspace/"),
    enabled: isAdmin,
  });

  // While a background analysis or rebuild is running, keep polling until it settles.
  const pending =
    Boolean(workspace?.public_id) &&
    (workspace?.ai_status === "PENDING" || workspace?.rebuilt_ai_status === "PENDING");
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => queryClient.invalidateQueries({ queryKey: ["resume-workspace"] }), 2500);
    return () => clearInterval(timer);
  }, [pending, queryClient]);

  // Download URLs for the rebuilt formats (plain text downloads only).
  const rebuiltBlobs = useMemo(() => {
    const make = (content: string, type: string) =>
      content ? URL.createObjectURL(new Blob([content], { type })) : null;
    return {
      tex: make(workspace?.rebuilt_tex ?? "", "text/plain"),
      txt: make(workspace?.rebuilt_text ?? "", "text/plain"),
    };
  }, [workspace?.rebuilt_tex, workspace?.rebuilt_text]);

  if (authLoading || !user) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="size-7 animate-spin text-primary" />
      </div>
    );
  }
  if (!isAdmin) return null;
  if (isLoading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="size-7 animate-spin text-primary" />
      </div>
    );
  }

  const onPickFile = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const updated = await http.post<ResumeWorkspace>("/resume-workspace/upload-resume/", form);
      queryClient.setQueryData(["resume-workspace"], updated);
      toast.success("Resume uploaded — AI review started in the background.");
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setUploading(false);
    }
  };

  const runAnalysis = async () => {
    setAnalyzing(true);
    try {
      const updated = await http.post<ResumeWorkspace>("/resume-workspace/analyze/", {});
      queryClient.setQueryData(["resume-workspace"], updated);
      if (updated.ai_status === "PENDING") toast.success("Analysis started.");
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setAnalyzing(false);
    }
  };

  const runRebuild = async () => {
    setRebuilding(true);
    try {
      const updated = await http.post<ResumeWorkspace>("/resume-workspace/rebuild/", {});
      queryClient.setQueryData(["resume-workspace"], updated);
      toast.success(
        updated.rebuilt_ai_status === "COMPLETE"
          ? "Rebuilt resume is ready — download it below."
          : "Rebuild started — it takes a minute or two, this page updates automatically."
      );
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setRebuilding(false);
    }
  };

  const saveSource = async () => {
    if (sourceDraft == null) {
      toast.success("No changes to save.");
      return;
    }
    try {
      const updated = await http.patch<ResumeWorkspace>("/resume-workspace/", { resume_source: sourceDraft });
      queryClient.setQueryData(["resume-workspace"], updated);
      setSourceDraft(null);
      toast.success("Resume source saved — it will be used on the next rebuild.");
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  const deleteResume = async () => {
    if (!workspace) return;
    try {
      const updated = await http.delete<ResumeWorkspace>("/resume-workspace/resume/");
      queryClient.setQueryData(["resume-workspace"], updated);
      setConfirmDelete(false);
      toast.success("Resume removed.");
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  return (
    <div>
      <PageHeader
        title="AI Resume Workspace"
        description="Your private resume review and AI rebuild — only you can see this. Upload your resume, get pros/cons/improvements, then rebuild it into a polished version you can download."
      />

      {/* Resume upload / management */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="size-4.5 text-primary" /> Your resume
          </CardTitle>
          <CardDescription>
            Upload your own resume (PDF, DOC or DOCX). Only you can see it — it never appears in faculty
            or student lists. The AI reviews it automatically.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!workspace?.public_id ? (
            <EmptyState
              icon={FileUp}
              title="No resume uploaded yet"
              description="Upload your resume and the AI will review it and rebuild a polished version for you."
              action={
                <Button onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                  {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
                  Upload resume
                </Button>
              }
            />
          ) : (
            <div className="space-y-4">
              <div className="flex flex-col gap-3 rounded-xl border bg-muted/30 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <FileText className="size-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{workspace.file_name}</p>
                    <p className="text-xs text-muted-foreground">{formatBytes(workspace.file_size)}</p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant={
                      workspace.ai_status === "COMPLETE"
                        ? "default"
                        : workspace.ai_status === "FAILED"
                          ? "destructive"
                          : "outline"
                    }
                  >
                    {workspace.ai_status === "COMPLETE"
                      ? "Analyzed"
                      : workspace.ai_status === "FAILED"
                        ? "Analysis failed"
                        : "Analyzing…"}
                  </Badge>
                  <Button variant="outline" size="sm" onClick={() => window.open(workspace.cloudinary_url, "_blank")}>
                    Preview
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                    {uploading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                    Replace
                  </Button>
                  <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setConfirmDelete(true)}>
                    <Trash2 className="size-4" /> Remove
                  </Button>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={runAnalysis} disabled={analyzing || pending}>
                  {analyzing || pending ? <Loader2 className="size-4 animate-spin" /> : <BrainCircuit className="size-4" />}
                  Run AI review
                </Button>
                <Button variant="outline" onClick={runRebuild} disabled={rebuilding || !workspace.public_id}>
                  {rebuilding ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
                  Rebuild resume with AI
                </Button>
              </div>
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              onPickFile(file);
              e.target.value = "";
            }}
          />
        </CardContent>
      </Card>

      {/* Private AI review */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BrainCircuit className="size-4.5 text-primary" /> AI review
            <Badge variant="outline" className="ml-1 text-[10px]">Private — only you see this</Badge>
          </CardTitle>
          <CardDescription>
            Pros, cons and improvement suggestions for your resume. Never shown to faculty, students or visitors.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!workspace?.public_id ? (
            <p className="text-sm text-muted-foreground">Upload your resume to get an AI review.</p>
          ) : workspace.ai_status === "PENDING" ? (
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin text-primary" />
              The AI is reviewing your resume — this can take a minute…
            </div>
          ) : workspace.ai_status === "FAILED" ? (
            <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
              <TriangleAlert className="mt-0.5 size-4.5 shrink-0 text-destructive" />
              <div>
                <p className="text-sm font-medium">The review could not be completed</p>
                <p className="mt-1 text-xs text-muted-foreground">{workspace.ai_error || "Try again in a moment."}</p>
                <Button size="sm" variant="outline" className="mt-3" onClick={runAnalysis} disabled={analyzing}>
                  {analyzing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                  Try again
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                <ScoreChip score={workspace.ai_score} />
                <div className="space-y-1">
                  <StarRating score={workspace.ai_score} />
                  {workspace.ai_analyzed_at && (
                    <p className="text-xs text-muted-foreground">
                      Reviewed {formatDate(workspace.ai_analyzed_at)}
                      {workspace.ai_analysis?.ocr ? " · analyzed from page images (OCR)" : ""}
                    </p>
                  )}
                </div>
              </div>
              {workspace.ai_analysis && <AnalysisBlock analysis={workspace.ai_analysis} />}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Resume source (LaTeX) */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileCode2 className="size-4.5 text-primary" /> Resume source (LaTeX)
            <Badge variant="outline" className="ml-1 text-[10px]">Optional</Badge>
          </CardTitle>
          <CardDescription>
            Have the LaTeX code of the resume you like? Paste it here — the AI keeps your exact layout and
            only improves the content when it rebuilds. No code? Leave this empty and the AI generates a
            clean design for you.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="max-w-2xl">
            <Textarea
              rows={12}
              value={sourceDraft ?? workspace?.resume_source ?? ""}
              onChange={(e) => setSourceDraft(e.target.value)}
              placeholder={"%\\documentclass{article}\n\\begin{document}\n% your original LaTeX resume…\n\\end{document}"}
              className="h-64 w-full resize-none font-mono text-xs"
            />
          </div>
          <div className="mt-3 flex items-center gap-2">
            <Button size="sm" onClick={saveSource} disabled={sourceDraft == null}>
              <Check className="size-4" /> Save source
            </Button>
            {sourceDraft != null && (
              <Button variant="ghost" size="sm" onClick={() => setSourceDraft(null)}>
                Discard
              </Button>
            )}
            <p className="text-[11px] text-muted-foreground">
              Applied on the next &quot;Rebuild resume with AI&quot; run.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* AI rebuild */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wand2 className="size-4.5 text-primary" /> AI-rebuilt resume
            <Badge variant="outline" className="ml-1 text-[10px]">Private</Badge>
          </CardTitle>
          <CardDescription>
            The AI rewrites your resume into a polished, ATS-friendly version. Preview it here, download it
            in your favourite format (.docx, .pdf, .tex or .txt), and see the new score.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!workspace?.public_id ? (
            <p className="text-sm text-muted-foreground">Upload your resume first, then rebuild it with AI.</p>
          ) : workspace.rebuilt_ai_status === "PENDING" ? (
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin text-primary" />
              The AI is rebuilding your resume — this can take a minute or two. This page updates automatically.
            </div>
          ) : !workspace.rebuilt_sections && workspace.rebuilt_ai_status !== "FAILED" ? (
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <Sparkles className="size-4 text-primary" />
              Not built yet — click &quot;Rebuild resume with AI&quot; above.
            </div>
          ) : workspace.rebuilt_ai_status === "FAILED" ? (
            <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
              <TriangleAlert className="mt-0.5 size-4.5 shrink-0 text-destructive" />
              <div>
                <p className="text-sm font-medium">The rebuild could not be completed</p>
                <p className="mt-1 text-xs text-muted-foreground">{workspace.rebuilt_ai_error || "Try again in a moment."}</p>
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center gap-2">
                {workspace.rebuilt_pdf_url && (
                  <Button variant="default" size="default" onClick={() => window.open(workspace.rebuilt_pdf_url, "_blank")}>
                    <Eye className="size-4" /> Preview
                  </Button>
                )}
                {workspace.rebuilt_docx_url && (
                  <a
                    href={workspace.rebuilt_docx_url}
                    target="_blank"
                    rel="noreferrer"
                    className={buttonVariants({ size: "default", variant: "outline" })}
                  >
                    <Download className="size-4" /> .docx
                  </a>
                )}
                {workspace.rebuilt_pdf_url && (
                  <a
                    href={workspace.rebuilt_pdf_url}
                    target="_blank"
                    rel="noreferrer"
                    className={buttonVariants({ size: "default", variant: "outline" })}
                  >
                    <Download className="size-4" /> .pdf
                  </a>
                )}
                {workspace.rebuilt_tex && (
                  <Button
                    variant="outline"
                    onClick={() => setShowTex((v) => !v)}
                    aria-expanded={showTex}
                  >
                    <FileCode2 className="size-4" /> {showTex ? "Hide" : "View"} .tex
                  </Button>
                )}
                {workspace.rebuilt_tex && rebuiltBlobs.tex && (
                  <a
                    href={rebuiltBlobs.tex}
                    download={`${slugName(workspace)}-rebuilt.tex`}
                    className={buttonVariants({ size: "default", variant: "outline" })}
                  >
                    <FileCode2 className="size-4" /> .tex
                  </a>
                )}
                {rebuiltBlobs.txt && (
                  <a
                    href={rebuiltBlobs.txt}
                    download={`${slugName(workspace)}-rebuilt.txt`}
                    className={buttonVariants({ size: "default", variant: "outline" })}
                  >
                    <FileText className="size-4" /> .txt
                  </a>
                )}
                <Button
                  variant="outline"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(workspace.rebuilt_text || "");
                      toast.success("Rebuilt resume text copied.");
                    } catch {
                      toast.error("Could not copy the text.");
                    }
                  }}
                >
                  <Copy className="size-4" /> Copy text
                </Button>
              </div>

              {showTex && workspace.rebuilt_tex && (
                <div className="max-w-3xl">
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Rebuilt source (.tex) — your layout kept, content improved
                  </p>
                  <pre className="h-72 w-full overflow-auto rounded-xl border bg-muted/40 p-4 font-mono text-xs leading-relaxed">
                    {workspace.rebuilt_tex}
                  </pre>
                </div>
              )}

              {workspace.rebuilt_sections && (
                <div className="space-y-4 rounded-xl border bg-muted/30 p-4">
                  {workspace.rebuilt_sections.summary && (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Summary</p>
                      <p className="mt-1 text-sm">{workspace.rebuilt_sections.summary}</p>
                    </div>
                  )}
                  {workspace.rebuilt_sections.skills.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Skills</p>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {workspace.rebuilt_sections.skills.map((s) => (
                          <Badge key={s} variant="outline">{s}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  {(["experience", "projects", "education"] as const).map((key) =>
                    workspace.rebuilt_sections?.[key] ? (
                      <div key={key}>
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          {key === "experience" ? "Experience" : key === "projects" ? "Projects" : "Education"}
                        </p>
                        <p className="mt-1 text-sm whitespace-pre-line">{workspace.rebuilt_sections[key]}</p>
                      </div>
                    ) : null
                  )}
                </div>
              )}

              {workspace.rebuilt_ai_status === "COMPLETE" && workspace.rebuilt_ai_analysis && (
                <div className="rounded-xl border bg-card p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <ScoreChip score={workspace.rebuilt_ai_score} />
                    <div>
                      <p className="text-sm font-semibold">Review of the rebuilt version</p>
                      <StarRating score={workspace.rebuilt_ai_score} />
                    </div>
                  </div>
                  <div className="mt-4">
                    <AnalysisBlock analysis={workspace.rebuilt_ai_analysis} />
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <p className="pb-4 text-center text-[11px] text-muted-foreground">
        Your resume, the AI review and the rebuilt versions are private to you — nothing here is ever
        published or shared.
      </p>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Remove resume?"
        description="Your resume and all its AI reviews and rebuilt versions will be deleted."
        confirmLabel="Remove resume"
        onConfirm={deleteResume}
      />
    </div>
  );
}
