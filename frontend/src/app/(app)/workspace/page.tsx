"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  BrainCircuit,
  CheckCircle2,
  Code,
  Eye,
  FileText,
  Lightbulb,
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
  X,
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

/** Simple LaTeX syntax highlighting */
function highlightLatex(code: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  // Split by lines, then highlight each line
  const lines = code.split("\n");
  lines.forEach((line, lineIdx) => {
    if (lineIdx > 0) parts.push("\n");

    // Comment lines
    if (line.trimStart().startsWith("%")) {
      parts.push(<span key={`c${lineIdx}`} className="text-zinc-500 italic">{line}</span>);
      return;
    }

    // Process line character by character for inline highlighting
    let i = 0;
    const chars = line;
    while (i < chars.length) {
      // LaTeX commands: \command
      if (chars[i] === "\\" && i + 1 < chars.length && /[a-zA-Z]/.test(chars[i + 1])) {
        let cmd = "\\";
        i++;
        while (i < chars.length && /[a-zA-Z]/.test(chars[i])) {
          cmd += chars[i];
          i++;
        }
        // Section/subsection commands get special color
        if (cmd === "\\section" || cmd === "\\subsection") {
          parts.push(<span key={`cmd${lineIdx}-${i}`} className="text-purple-400 font-bold">{cmd}</span>);
        } else if (cmd === "\\begin" || cmd === "\\end") {
          parts.push(<span key={`cmd${lineIdx}-${i}`} className="text-amber-400 font-semibold">{cmd}</span>);
        } else if (cmd === "\\documentclass" || cmd === "\\usepackage") {
          parts.push(<span key={`cmd${lineIdx}-${i}`} className="text-blue-400 font-bold">{cmd}</span>);
        } else if (cmd === "\\item") {
          parts.push(<span key={`cmd${lineIdx}-${i}`} className="text-orange-400">{cmd}</span>);
        } else {
          parts.push(<span key={`cmd${lineIdx}-${i}`} className="text-cyan-400">{cmd}</span>);
        }
        continue;
      }
      // Braces
      if (chars[i] === "{" || chars[i] === "}") {
        parts.push(<span key={`b${lineIdx}-${i}`} className="text-yellow-300 font-bold">{chars[i]}</span>);
        i++;
        continue;
      }
      // Brackets
      if (chars[i] === "[" || chars[i] === "]") {
        parts.push(<span key={`br${lineIdx}-${i}`} className="text-yellow-400/70">{chars[i]}</span>);
        i++;
        continue;
      }
      // Everything else (plain text)
      parts.push(<span key={`t${lineIdx}-${i}`} className="text-emerald-300">{chars[i]}</span>);
      i++;
    }
  });
  return parts;
}

/** Typewriter effect with syntax highlighting */
function TypewriterCode({ text, speed = 8 }: { text: string; speed?: number }) {
  const [displayedLen, setDisplayedLen] = useState(0);
  const [done, setDone] = useState(false);
  const containerRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (!text) return;
    setDisplayedLen(0);
    setDone(false);
    let i = 0;
    const interval = setInterval(() => {
      i++;
      setDisplayedLen(i);
      if (containerRef.current) {
        containerRef.current.scrollTop = containerRef.current.scrollHeight;
      }
      if (i >= text.length) {
        clearInterval(interval);
        setDone(true);
      }
    }, speed);
    return () => clearInterval(interval);
  }, [text, speed]);

  const visibleCode = text.slice(0, displayedLen);

  return (
    <div className="relative">
      <pre
        ref={containerRef}
        className="max-h-[500px] overflow-auto rounded-xl border bg-zinc-950 p-4 font-mono text-[11px] leading-relaxed"
      >
        {highlightLatex(visibleCode)}
        {!done && <span className="inline-block h-4 w-1.5 animate-pulse bg-emerald-400 ml-0.5" />}
      </pre>
      <div className="absolute top-2 right-2 flex gap-1">
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-zinc-400 hover:text-white hover:bg-zinc-800"
          onClick={() => {
            navigator.clipboard.writeText(text);
            toast.success("LaTeX copied!");
          }}
        >
          Copy
        </Button>
        {done && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-zinc-400 hover:text-white hover:bg-zinc-800"
            onClick={() => {
              const blob = new Blob([text], { type: "text/plain" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = "resume.tex";
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            Download .tex
          </Button>
        )}
      </div>
    </div>
  );
}

/** PDF Preview Dialog */
function PdfPreviewDialog({ url, open, onClose }: { url: string; open: boolean; onClose: () => void }) {
  if (!open || !url) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="relative w-full max-w-3xl rounded-2xl border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b px-4 py-3">
          <p className="text-sm font-medium flex items-center gap-2">
            <FileText className="size-4 text-primary" /> Resume Preview
          </p>
          <Button size="sm" variant="ghost" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </div>
        <div className="h-[80vh]">
          <iframe src={url} className="h-full w-full rounded-b-2xl" title="PDF Preview" />
        </div>
      </motion.div>
    </div>
  );
}

export default function WorkspacePage() {
  const queryClient = useQueryClient();
  const [targetScore, setTargetScore] = useState(80);
  const [requirements, setRequirements] = useState("");
  const [templateLatex, setTemplateLatex] = useState("");
  const [generating, setGenerating] = useState(false);
  const [compiling, setCompiling] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [compileAvailable, setCompileAvailable] = useState<boolean | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  const { data: workspace, isLoading, error } = useQuery({
    queryKey: ["workspace", "mine"],
    queryFn: fetchWorkspace,
    retry: false,
  });

  useEffect(() => {
    if (workspace) {
      setTargetScore(workspace.target_ats_score);
      setRequirements(workspace.requirements);
      setTemplateLatex(workspace.template_latex);
    }
  }, [workspace]);

  useEffect(() => {
    if (!workspace || workspace.generated_status !== "RUNNING") return;
    const interval = setInterval(() => {
      queryClient.invalidateQueries({ queryKey: ["workspace", "mine"] });
    }, 5000);
    return () => clearInterval(interval);
  }, [workspace?.generated_status, queryClient]);

  useEffect(() => {
    http.get<{ available: boolean }>("/student-workspace/compile/")
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
      toast.success("Resume compiled to PDF!");
      await queryClient.invalidateQueries({ queryKey: ["workspace", "mine"] });
      // Auto-open preview
      setPreviewOpen(true);
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
      toast.success("Resume submitted to faculty!");
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
        <PageHeader title="AI Resume Workspace" description="Generate a polished, ATS-friendly resume with AI." />
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

  const hasCode = workspace?.generated_status === "COMPLETE" && workspace.generated_latex;
  const isRunning = workspace?.generated_status === "RUNNING" || generating;
  const isFailed = workspace?.generated_status === "FAILED";

  return (
    <div>
      <PageHeader
        title="AI Resume Workspace"
        description="Generate a polished, ATS-friendly resume with AI. Set your target score, provide requirements, and let the AI build it."
      />

      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="mx-auto max-w-7xl"
      >
        {isLoading ? (
          <Card>
            <CardContent className="flex items-center justify-center py-16">
              <Loader2 className="size-6 animate-spin text-primary" />
            </CardContent>
          </Card>
        ) : workspace ? (
          <div className="grid gap-6 lg:grid-cols-5">
            {/* LEFT: Code / Config */}
            <div className="space-y-4 lg:col-span-3">
              {/* Running animation */}
              {isRunning && (
                <Card className="border-violet-500/30 bg-gradient-to-br from-violet-500/5 to-transparent">
                  <CardContent className="flex items-center gap-4 py-6">
                    <Loader2 className="size-8 animate-spin text-violet-500" />
                    <div>
                      <p className="text-sm font-medium">AI is writing your resume...</p>
                      <p className="text-xs text-muted-foreground">Generating LaTeX code character by character. This takes 1-2 minutes.</p>
                      <div className="mt-2 h-1.5 w-48 overflow-hidden rounded-full bg-muted">
                        <div className="h-full w-1/3 animate-pulse rounded-full bg-violet-500" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Failed */}
              {isFailed && (
                <Card className="border-destructive/30">
                  <CardContent className="space-y-3 py-4">
                    <div className="flex items-center gap-2">
                      <TriangleAlert className="size-4 text-destructive" />
                      <p className="text-sm font-medium text-destructive">Generation Failed</p>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {workspace.generated_error || "The AI service did not respond."}
                    </p>
                    <Button onClick={handleGenerate} size="sm" disabled={generating}>
                      <RefreshCw className="size-3.5" /> Try Again
                    </Button>
                  </CardContent>
                </Card>
              )}

              {/* Generated code with typewriter */}
              {hasCode && (
                <Card className="border-emerald-500/30 overflow-hidden">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="flex items-center gap-2 text-base">
                        <Wrench className="size-4 text-emerald-500" /> Generated LaTeX Code
                      </CardTitle>
                      <div className="flex gap-2">
                        <Button onClick={handleCompile} size="sm" disabled={compiling || compileAvailable === false}>
                          {compiling ? <Loader2 className="size-3.5 animate-spin" /> : <Eye className="size-3.5" />}
                          Compile & Preview
                        </Button>
                        {workspace.compiled_pdf_url && (
                          <Button variant="outline" size="sm" onClick={() => setPreviewOpen(true)}>
                            <FileText className="size-3.5" /> View PDF
                          </Button>
                        )}
                        {!workspace.submitted && workspace.compiled_pdf_url && (
                          <Button size="sm" onClick={handleSubmit} disabled={submitting}>
                            {submitting ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
                            Submit
                          </Button>
                        )}
                        {workspace.submitted && (
                          <Badge variant="outline" className="gap-1 border-emerald-500/30 bg-emerald-500/10 text-emerald-600 text-xs dark:text-emerald-400">
                            <CheckCircle2 className="size-3" /> Submitted
                          </Badge>
                        )}
                      </div>
                    </div>
                    <CardDescription>
                      Target: {targetScore}% · {workspace.generated_latex.length} characters
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <TypewriterCode text={workspace.generated_latex} speed={5} />
                    {compileAvailable === false && (
                      <p className="mt-2 text-[11px] text-muted-foreground">
                        Server compiler unavailable — copy the code and compile on{" "}
                        <a href="https://www.overleaf.com" target="_blank" rel="noopener noreferrer" className="underline text-primary">Overleaf</a>
                      </p>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Config (only show when no code yet) */}
              {!hasCode && !isRunning && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Target className="size-4 text-primary" /> Configure Your Resume
                    </CardTitle>
                    <CardDescription>Set your target, requirements, and optional template.</CardDescription>
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
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm font-medium">Requirements / Job Description</label>
                      <Textarea
                        placeholder="e.g., AWS + Java developer, 2027 batch, 8+ LPA. Include skills, technologies, and experience the resume should highlight..."
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
                        placeholder={"\\documentclass[a4paper,10pt]{article}\n\\usepackage[utf8]{inputenc}\n% ... paste your LaTeX template here"}
                        value={templateLatex}
                        onChange={(e) => setTemplateLatex(e.target.value)}
                        rows={6}
                        className="font-mono text-xs resize-y"
                      />
                      <p className="text-[11px] text-muted-foreground">
                        Paste your existing template. The AI keeps the layout and only improves content.
                      </p>
                    </div>

                    <Button onClick={handleGenerate} disabled={generating} className="w-full">
                      {generating ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                      {generating ? "Generating..." : "Rebuild Resume with AI"}
                    </Button>
                  </CardContent>
                </Card>
              )}
            </div>

            {/* RIGHT: Analysis / Errors / Tips */}
            <div className="space-y-4 lg:col-span-2">
              {/* Current resume analysis */}
              {workspace.resume_ai_status === "COMPLETE" && workspace.resume_ai_analysis && (
                <Card className="border-violet-500/20">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <BrainCircuit className="size-4 text-violet-500" /> Current Resume
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-center gap-3">
                      <div className={cn("flex size-12 shrink-0 flex-col items-center justify-center rounded-xl border text-sm font-bold", scoreRing(workspace.resume_ai_score ?? 0))}>
                        {workspace.resume_ai_score ?? 0}%
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Target: {targetScore}% · Gap: {Math.max(0, targetScore - (workspace.resume_ai_score ?? 0))} points
                      </div>
                    </div>
                    {workspace.resume_ai_analysis.pros && workspace.resume_ai_analysis.pros.length > 0 && (
                      <div>
                        <p className="mb-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                          <ThumbsUp className="size-3" /> Strengths
                        </p>
                        <div className="flex flex-wrap gap-1">
                          {workspace.resume_ai_analysis.pros.slice(0, 4).map((p, i) => (
                            <Badge key={i} variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 text-[10px] dark:text-emerald-400">{p}</Badge>
                          ))}
                        </div>
                      </div>
                    )}
                    {workspace.resume_ai_analysis.cons && workspace.resume_ai_analysis.cons.length > 0 && (
                      <div>
                        <p className="mb-1 text-[11px] font-semibold text-rose-600 dark:text-rose-400 flex items-center gap-1">
                          <ThumbsDown className="size-3" /> Weaknesses
                        </p>
                        <div className="flex flex-wrap gap-1">
                          {workspace.resume_ai_analysis.cons.slice(0, 4).map((c, i) => (
                            <Badge key={i} variant="outline" className="border-rose-500/30 bg-rose-500/10 text-rose-700 text-[10px] dark:text-rose-400">{c}</Badge>
                          ))}
                        </div>
                      </div>
                    )}
                    {workspace.resume_ai_analysis.improvements && workspace.resume_ai_analysis.improvements.length > 0 && (
                      <div>
                        <p className="mb-1 text-[11px] font-semibold text-amber-600 dark:text-amber-400 flex items-center gap-1">
                          <Lightbulb className="size-3" /> Improvements
                        </p>
                        <ul className="space-y-1">
                          {workspace.resume_ai_analysis.improvements.slice(0, 4).map((imp, i) => (
                            <li key={i} className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                              <span className="mt-0.5 flex size-3.5 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-[9px] font-semibold text-amber-600 dark:text-amber-400">{i + 1}</span>
                              {imp}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Generated score analysis */}
              {hasCode && workspace.generated_analysis && (
                <Card className="border-emerald-500/20">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <Sparkles className="size-4 text-emerald-500" /> AI Review
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-center gap-3">
                      <div className={cn("flex size-12 shrink-0 flex-col items-center justify-center rounded-xl border text-sm font-bold", scoreRing(workspace.generated_score ?? 0))}>
                        {workspace.generated_score ?? 0}%
                      </div>
                      <div className="flex-1 space-y-1">
                        {workspace.generated_analysis.summary && (
                          <p className="text-[11px] text-muted-foreground">{workspace.generated_analysis.summary}</p>
                        )}
                      </div>
                    </div>
                    <div className="space-y-2">
                      {workspace.generated_analysis.ats_compliance != null && <ScoreBar label="ATS Compliance" score={workspace.generated_analysis.ats_compliance} />}
                      {workspace.generated_analysis.content_quality != null && <ScoreBar label="Content Quality" score={workspace.generated_analysis.content_quality} />}
                      {workspace.generated_analysis.skills_match != null && <ScoreBar label="Skills Match" score={workspace.generated_analysis.skills_match} />}
                    </div>
                    {workspace.generated_analysis.pros && workspace.generated_analysis.pros.length > 0 && (
                      <div>
                        <p className="mb-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1"><ThumbsUp className="size-3" /> What's Good</p>
                        <div className="flex flex-wrap gap-1">
                          {workspace.generated_analysis.pros.map((p, i) => (
                            <Badge key={i} variant="outline" className="text-[10px]">{p}</Badge>
                          ))}
                        </div>
                      </div>
                    )}
                    {workspace.generated_analysis.cons && workspace.generated_analysis.cons.length > 0 && (
                      <div>
                        <p className="mb-1 text-[11px] font-semibold text-rose-600 dark:text-rose-400 flex items-center gap-1"><ThumbsDown className="size-3" /> Gaps</p>
                        <div className="flex flex-wrap gap-1">
                          {workspace.generated_analysis.cons.map((c, i) => (
                            <Badge key={i} variant="outline" className="border-rose-500/30 bg-rose-500/10 text-[10px]">{c}</Badge>
                          ))}
                        </div>
                      </div>
                    )}
                    {workspace.generated_analysis.missing_keywords && workspace.generated_analysis.missing_keywords.length > 0 && (
                      <div>
                        <p className="mb-1 text-[11px] font-semibold text-amber-600 dark:text-amber-400 flex items-center gap-1"><Sparkles className="size-3" /> Missing Keywords</p>
                        <div className="flex flex-wrap gap-1">
                          {workspace.generated_analysis.missing_keywords.map((k, i) => (
                            <Badge key={i} variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-700 text-[10px] dark:text-amber-400">+ {k}</Badge>
                          ))}
                        </div>
                      </div>
                    )}
                    {workspace.generated_analysis.improvements && workspace.generated_analysis.improvements.length > 0 && (
                      <div>
                        <p className="mb-1 text-[11px] font-semibold text-amber-600 dark:text-amber-400 flex items-center gap-1"><Lightbulb className="size-3" /> Improvements</p>
                        <ul className="space-y-1">
                          {workspace.generated_analysis.improvements.map((imp, i) => (
                            <li key={i} className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                              <span className="mt-0.5 flex size-3.5 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-[9px] font-semibold text-amber-600 dark:text-amber-400">{i + 1}</span>
                              {imp}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Tips */}
              {!hasCode && !isRunning && (
                <Card className="border-muted">
                  <CardContent className="py-4 space-y-3">
                    <p className="text-xs font-medium flex items-center gap-1.5"><Target className="size-3.5 text-primary" /> Quick Tips</p>
                    <div className="space-y-2">
                      <div className="flex items-start gap-2">
                        <span className="mt-0.5 size-1.5 shrink-0 rounded-full bg-primary" />
                        <p className="text-[11px] text-muted-foreground">80+ target = strong ATS compliance. Add quantified metrics.</p>
                      </div>
                      <div className="flex items-start gap-2">
                        <span className="mt-0.5 size-1.5 shrink-0 rounded-full bg-primary" />
                        <p className="text-[11px] text-muted-foreground">Paste a LaTeX template to keep your layout. AI improves only content.</p>
                      </div>
                      <div className="flex items-start gap-2">
                        <span className="mt-0.5 size-1.5 shrink-0 rounded-full bg-primary" />
                        <p className="text-[11px] text-muted-foreground">After compile, preview the PDF and submit to faculty.</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Timestamps */}
              {workspace.generated_at && (
                <p className="text-[11px] text-muted-foreground text-center">
                  Generated {formatDate(workspace.generated_at)}
                  {workspace.compiled_at ? ` · Compiled ${formatDate(workspace.compiled_at)}` : ""}
                  {workspace.submitted_at ? ` · Submitted ${formatDate(workspace.submitted_at)}` : ""}
                </p>
              )}
            </div>
          </div>
        ) : null}
      </motion.div>

      {/* PDF Preview Dialog */}
      <PdfPreviewDialog
        url={workspace?.compiled_pdf_url || ""}
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
      />
    </div>
  );
}
