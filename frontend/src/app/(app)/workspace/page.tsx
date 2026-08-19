"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  BrainCircuit,
  CheckCircle2,
  Code,
  Eye,
  FileText,
  Gauge,
  Lightbulb,
  ListChecks,
  Loader2,
  Lock,
  RefreshCw,
  Send,
  Sparkles,
  Target,
  ThumbsDown,
  ThumbsUp,
  TriangleAlert,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/empty-state";
import { http } from "@/lib/api";
import { cn, formatDate, getErrorMessage } from "@/lib/utils";

interface Workspace {
  id: number;
  student: number;
  student_roll: string;
  student_name: string;
  is_enabled: boolean;
  enabled_at: string | null;
  target_ats_score: number;
  requirements: string;
  template_latex: string;
  generated_status: "PENDING" | "RUNNING" | "COMPLETE" | "FAILED";
  generated_latex: string;
  generated_score: number | null;
  generated_analysis: {
    summary?: string;
    ats_compliance?: number;
    content_quality?: number;
    skills_match?: number;
    pros?: string[];
    cons?: string[];
    improvements?: string[];
    missing_keywords?: string[];
  } | null;
  generated_error: string;
  generated_at: string | null;
  compiled_pdf_url: string;
  compiled_at: string | null;
  submitted: boolean;
  submitted_at: string | null;
  submitted_url: string;
  resume_ai_score: number | null;
  resume_ai_analysis: {
    summary?: string;
    pros?: string[];
    cons?: string[];
    improvements?: string[];
    skills?: string[];
    ats_keywords?: string[];
  } | null;
  resume_ai_status: string | null;
  created_at: string;
  updated_at: string;
}

async function fetchWorkspace(): Promise<Workspace> {
  return http.get<Workspace>("/student-workspace/");
}

/** 0-100 AI score -> color ring */
function scoreRing(score: number) {
  if (score >= 70) return "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";
  if (score >= 45) return "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400";
  return "border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400";
}

function scoreBarColor(score: number) {
  if (score >= 70) return "bg-emerald-500";
  if (score >= 50) return "bg-amber-500";
  return "bg-rose-500";
}

function ScoreBar({ label, score }: { label: string; score: number }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-semibold tabular-nums">{score}/100</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full transition-[width] duration-500", scoreBarColor(score))}
          style={{ width: `${score}%` }}
        />
      </div>
    </div>
  );
}

export default function WorkspacePage() {
  const queryClient = useQueryClient();
  const latexRef = useRef<HTMLTextAreaElement>(null);
  const [targetScore, setTargetScore] = useState(80);
  const [requirements, setRequirements] = useState("");
  const [templateLatex, setTemplateLatex] = useState("");
  const [generating, setGenerating] = useState(false);
  const [compiling, setCompiling] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [compileAvailable, setCompileAvailable] = useState<boolean | null>(null);

  const { data: workspace, isLoading, error } = useQuery({
    queryKey: ["workspace", "mine"],
    queryFn: fetchWorkspace,
    retry: false,
  });

  // Sync workspace data to local state
  useEffect(() => {
    if (workspace) {
      setTargetScore(workspace.target_ats_score);
      setRequirements(workspace.requirements);
      setTemplateLatex(workspace.template_latex);
    }
  }, [workspace]);

  // Poll while generating
  useEffect(() => {
    if (!workspace || workspace.generated_status !== "RUNNING") return;
    const interval = setInterval(() => {
      queryClient.invalidateQueries({ queryKey: ["workspace", "mine"] });
    }, 5000);
    return () => clearInterval(interval);
  }, [workspace?.generated_status, queryClient]);

  // Check if LaTeX compilation is available on the server
  useEffect(() => {
    http.get<{ available: boolean }>('/student-workspace/compile/')
      .then((res) => setCompileAvailable(res.available))
      .catch(() => setCompileAvailable(false));
  }, []);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      await http.post<Workspace>("/student-workspace/generate/", {
        target_ats_score: targetScore,
        requirements,
        template_latex: templateLatex,
      });
      toast.success("Resume generation started — this takes 1-2 minutes.");
      queryClient.invalidateQueries({ queryKey: ["workspace", "mine"] });
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setGenerating(false);
    }
  };

  const handleCompile = async () => {
    setCompiling(true);
    try {
      await http.post<Workspace>("/student-workspace/compile/", {});
      toast.success("Resume compiled to PDF successfully!");
      queryClient.invalidateQueries({ queryKey: ["workspace", "mine"] });
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setCompiling(false);
    }
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      await http.post<Workspace>("/student-workspace/submit/", {});
      toast.success("Resume submitted to faculty for review!");
      queryClient.invalidateQueries({ queryKey: ["workspace", "mine"] });
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  // Not enabled
  if (!isLoading && (error || (workspace && !workspace.is_enabled))) {
    return (
      <div>
        <PageHeader
          title="AI Resume Workspace"
          description="Generate a polished, ATS-friendly resume with AI assistance."
        />
        <Card>
          <CardContent className="py-12">
            <EmptyState
              icon={Lock}
              title="Workspace not enabled"
              description="Ask your admin to enable the AI Resume Workspace for your account."
              illustration="grading-papers_7fpu"
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="AI Resume Workspace"
        description="Generate a polished, ATS-friendly resume with AI assistance. Set your target score, provide a template, and let the AI do the rest."
      />

      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="mx-auto max-w-5xl space-y-6"
      >
        {isLoading ? (
          <Card>
            <CardContent className="flex items-center justify-center py-16">
              <Loader2 className="size-6 animate-spin text-primary" />
            </CardContent>
          </Card>
        ) : workspace ? (
          <>
            {/* Current Resume Analysis */}
            {workspace.resume_ai_status === "COMPLETE" && workspace.resume_ai_analysis && (
              <Card className="border-violet-500/30 bg-gradient-to-br from-violet-500/5 to-transparent">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <BrainCircuit className="size-5 text-violet-500" /> Your Current Resume Analysis
                  </CardTitle>
                  <CardDescription>
                    Based on your uploaded resume — use this to set your target score and requirements.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center gap-4">
                    <div className={cn("flex size-16 shrink-0 flex-col items-center justify-center rounded-2xl border", scoreRing(workspace.resume_ai_score ?? 0))}>
                      <span className="text-xl font-bold tabular-nums">
                        {workspace.resume_ai_score ?? 0}
                        <span className="text-xs font-medium text-muted-foreground">%</span>
                      </span>
                      <span className="text-[10px] font-medium text-muted-foreground">Current</span>
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium">Target: {targetScore}% → Gap: {Math.max(0, targetScore - (workspace.resume_ai_score ?? 0))} points</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Set your target score below to close this gap.
                      </p>
                    </div>
                  </div>

                  {workspace.resume_ai_analysis.pros && workspace.resume_ai_analysis.pros.length > 0 && (
                    <div>
                      <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                        <ThumbsUp className="size-3" /> Strengths
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {workspace.resume_ai_analysis.pros.slice(0, 5).map((p, i) => (
                          <Badge key={i} variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 text-[11px] dark:text-emerald-400">
                            {p}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {workspace.resume_ai_analysis.cons && workspace.resume_ai_analysis.cons.length > 0 && (
                    <div>
                      <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-rose-600 dark:text-rose-400">
                        <ThumbsDown className="size-3" /> Weaknesses
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {workspace.resume_ai_analysis.cons.slice(0, 5).map((c, i) => (
                          <Badge key={i} variant="outline" className="border-rose-500/30 bg-rose-500/10 text-rose-700 text-[11px] dark:text-rose-400">
                            {c}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {workspace.resume_ai_analysis.improvements && workspace.resume_ai_analysis.improvements.length > 0 && (
                    <div>
                      <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-amber-600 dark:text-amber-400">
                        <Lightbulb className="size-3" /> Key Improvements
                      </p>
                      <ul className="space-y-1">
                        {workspace.resume_ai_analysis.improvements.slice(0, 5).map((imp, i) => (
                          <li key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                            <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                              {i + 1}
                            </span>
                            {imp}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Configuration */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Target className="size-5 text-primary" /> Configuration
                </CardTitle>
                <CardDescription>
                  Set your target ATS score, job requirements, and optional LaTeX template.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Target ATS Score</label>
                    <div className="flex items-center gap-3">
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        value={targetScore}
                        onChange={(e) => setTargetScore(Math.max(0, Math.min(100, Number(e.target.value))))}
                        className="w-24"
                      />
                      <div className="flex-1">
                        <ScoreBar label="Target" score={targetScore} />
                      </div>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Higher scores require stronger content, quantified metrics, and ATS-optimized formatting.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Resume Source (LaTeX) — Optional</label>
                    <p className="text-[11px] text-muted-foreground">
                      Have a LaTeX template you like? Paste it here — the AI keeps your exact layout and only improves the content.
                    </p>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Requirements / Job Description</label>
                  <Textarea
                    placeholder="e.g., AWS + Java developer, 2027 batch, 8+ LPA package. Include specific skills, technologies, and experience the resume should highlight..."
                    value={requirements}
                    onChange={(e) => setRequirements(e.target.value)}
                    rows={3}
                    className="resize-none"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium flex items-center gap-1.5">
                    <Code className="size-4" /> LaTeX Template (Optional)
                  </label>
                  <Textarea
                    ref={latexRef}
                    placeholder={`\\documentclass[a4paper,10pt]{article}\n\\usepackage[utf8]{inputenc}\n\\usepackage[T1]{fontenc}\n% ... paste your LaTeX template here`}
                    value={templateLatex}
                    onChange={(e) => setTemplateLatex(e.target.value)}
                    rows={8}
                    className="font-mono text-xs resize-y"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Paste your existing LaTeX resume template. The AI will keep the exact structure and only improve the content to reach your target score.
                  </p>
                </div>

                <Button
                  onClick={handleGenerate}
                  disabled={generating || workspace.generated_status === "RUNNING"}
                  className="w-full"
                >
                  {generating || workspace.generated_status === "RUNNING" ? (
                    <>
                      <Loader2 className="size-4 animate-spin" /> Generating Resume...
                    </>
                  ) : (
                    <>
                      <Sparkles className="size-4" /> Rebuild Resume with AI
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>

            {/* Generation Status */}
            {workspace.generated_status === "RUNNING" && (
              <Card className="border-violet-500/30 bg-gradient-to-br from-violet-500/5 to-transparent">
                <CardContent className="flex items-center justify-center gap-3 py-8">
                  <Loader2 className="size-6 animate-spin text-violet-500" />
                  <div>
                    <p className="text-sm font-medium">AI is generating your resume...</p>
                    <p className="text-xs text-muted-foreground">This takes 1-2 minutes. The page will update automatically.</p>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Generation Failed */}
            {workspace.generated_status === "FAILED" && (
              <Card className="border-destructive/30">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <TriangleAlert className="size-5 text-destructive" /> Generation Failed
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    {workspace.generated_error || "The AI service did not respond. Please try again."}
                  </p>
                  <Button onClick={handleGenerate} className="mt-4" disabled={generating}>
                    <RefreshCw className="size-4" /> Try Again
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* Generated Resume */}
            {workspace.generated_status === "COMPLETE" && workspace.generated_latex && (
              <Card className="border-emerald-500/30 bg-gradient-to-br from-emerald-500/5 to-transparent">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Wrench className="size-5 text-emerald-500" /> AI-Rebuilt Resume
                  </CardTitle>
                  <CardDescription>
                    The AI rewrote your resume into a polished, ATS-friendly version targeting {targetScore}%.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Score + Analysis */}
                  {workspace.generated_analysis && (
                    <div className="rounded-xl border bg-card/60 p-4 space-y-3">
                      <div className="flex items-center gap-4">
                        <div className={cn("flex size-14 shrink-0 flex-col items-center justify-center rounded-xl border", scoreRing(workspace.generated_score ?? 0))}>
                          <span className="text-lg font-bold tabular-nums">
                            {workspace.generated_score ?? 0}
                            <span className="text-xs font-medium text-muted-foreground">%</span>
                          </span>
                          <span className="text-[10px] font-medium text-muted-foreground">Score</span>
                        </div>
                        <div className="flex-1 space-y-1">
                          {workspace.generated_analysis.summary && (
                            <p className="text-xs text-muted-foreground">{workspace.generated_analysis.summary}</p>
                          )}
                          <div className="grid grid-cols-3 gap-2">
                            {workspace.generated_analysis.ats_compliance != null && (
                              <ScoreBar label="ATS" score={workspace.generated_analysis.ats_compliance} />
                            )}
                            {workspace.generated_analysis.content_quality != null && (
                              <ScoreBar label="Content" score={workspace.generated_analysis.content_quality} />
                            )}
                            {workspace.generated_analysis.skills_match != null && (
                              <ScoreBar label="Skills" score={workspace.generated_analysis.skills_match} />
                            )}
                          </div>
                        </div>
                      </div>

                      {workspace.generated_analysis.pros && workspace.generated_analysis.pros.length > 0 && (
                        <div>
                          <p className="mb-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                            <ThumbsUp className="size-3" /> What's Good
                          </p>
                          <div className="flex flex-wrap gap-1">
                            {workspace.generated_analysis.pros.map((p, i) => (
                              <Badge key={i} variant="outline" className="text-[10px]">{p}</Badge>
                            ))}
                          </div>
                        </div>
                      )}

                      {workspace.generated_analysis.cons && workspace.generated_analysis.cons.length > 0 && (
                        <div>
                          <p className="mb-1 text-[11px] font-semibold text-rose-600 dark:text-rose-400 flex items-center gap-1">
                            <ThumbsDown className="size-3" /> Gaps
                          </p>
                          <div className="flex flex-wrap gap-1">
                            {workspace.generated_analysis.cons.map((c, i) => (
                              <Badge key={i} variant="outline" className="border-rose-500/30 bg-rose-500/10 text-[10px]">{c}</Badge>
                            ))}
                          </div>
                        </div>
                      )}

                      {workspace.generated_analysis.missing_keywords && workspace.generated_analysis.missing_keywords.length > 0 && (
                        <div>
                          <p className="mb-1 text-[11px] font-semibold text-amber-600 dark:text-amber-400 flex items-center gap-1">
                            <Sparkles className="size-3" /> Missing Keywords
                          </p>
                          <div className="flex flex-wrap gap-1">
                            {workspace.generated_analysis.missing_keywords.map((k, i) => (
                              <Badge key={i} variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-700 text-[10px] dark:text-amber-400">+ {k}</Badge>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* LaTeX Code */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium flex items-center gap-1.5">
                      <Code className="size-4" /> Generated LaTeX Code
                    </label>
                    <div className="relative">
                      <pre className="max-h-96 overflow-auto rounded-xl border bg-muted/30 p-4 font-mono text-xs leading-relaxed">
                        {workspace.generated_latex}
                      </pre>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="absolute top-2 right-2"
                        onClick={() => {
                          navigator.clipboard.writeText(workspace.generated_latex);
                          toast.success("LaTeX copied to clipboard!");
                        }}
                      >
                        Copy
                      </Button>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex flex-wrap gap-3 border-t pt-4">
                    <Button onClick={handleCompile} disabled={compiling || compileAvailable === false}>
                      {compiling ? <Loader2 className="size-4 animate-spin" /> : <Eye className="size-4" />}
                      Compile to PDF
                    </Button>
                    {compileAvailable === false && (
                      <p className="text-xs text-muted-foreground self-center">
                        Server PDF compiler unavailable — copy the LaTeX code and compile on{' '}
                        <a href="https://www.overleaf.com" target="_blank" rel="noopener noreferrer" className="underline text-primary">Overleaf</a>
                      </p>
                    )}
                    {workspace.compiled_pdf_url && (
                    <a href={workspace.compiled_pdf_url} target="_blank" rel="noopener noreferrer">
                      <Button variant="outline">
                        <FileText className="size-4" /> View PDF
                      </Button>
                    </a>
                    )}
                    {!workspace.submitted && workspace.compiled_pdf_url && (
                      <Button onClick={handleSubmit} disabled={submitting}>
                        {submitting ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                        Submit to Faculty
                      </Button>
                    )}
                    {workspace.submitted && (
                      <Badge variant="outline" className="gap-1 border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                        <CheckCircle2 className="size-3.5" /> Submitted
                      </Badge>
                    )}
                  </div>

                  {workspace.generated_at && (
                    <p className="text-[11px] text-muted-foreground">
                      Generated {formatDate(workspace.generated_at)}
                      {workspace.compiled_at ? ` · Compiled ${formatDate(workspace.compiled_at)}` : ""}
                      {workspace.submitted_at ? ` · Submitted ${formatDate(workspace.submitted_at)}` : ""}
                    </p>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Quick tips */}
            <Card className="border-muted">
              <CardContent className="py-4">
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="flex items-start gap-2">
                    <Target className="mt-0.5 size-4 shrink-0 text-primary" />
                    <div>
                      <p className="text-xs font-medium">Target Score</p>
                      <p className="text-[11px] text-muted-foreground">
                        80+ = strong ATS compliance. Add quantified metrics and keywords.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <Code className="mt-0.5 size-4 shrink-0 text-primary" />
                    <div>
                      <p className="text-xs font-medium">LaTeX Template</p>
                      <p className="text-[11px] text-muted-foreground">
                        Provide your existing template to keep the layout. AI improves only the content.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <Send className="mt-0.5 size-4 shrink-0 text-primary" />
                    <div>
                      <p className="text-xs font-medium">Submit</p>
                      <p className="text-[11px] text-muted-foreground">
                        After compiling, submit to faculty for review. You can regenerate anytime.
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </>
        ) : null}
      </motion.div>
    </div>
  );
}


