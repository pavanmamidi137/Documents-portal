"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Reorder, useDragControls } from "framer-motion";
import {
  BrainCircuit,
  Check,
  Copy,
  Download,
  FileText,
  FileUp,
  Globe,
  GripVertical,
  IdCard,
  Lightbulb,
  ListChecks,
  Loader2,
  Plus,
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
import Link from "next/link";
import { useRouter } from "next/navigation";
import { EmptyState } from "@/components/empty-state";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { http } from "@/lib/api";
import type { Portfolio, PortfolioSection, ResumeAiAnalysis } from "@/lib/types";
import { cn, formatBytes, formatDate, getErrorMessage } from "@/lib/utils";

const ACCEPTED = ".pdf,.doc,.docx";

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

/** A custom section with a client-side id for stable reorder keys. */
type SectionDraft = PortfolioSection & { id: string };

function CustomSectionRow({
  section,
  onEdit,
  onRemove,
}: {
  section: SectionDraft;
  onEdit: (id: string, field: "title" | "content", value: string) => void;
  onRemove: (id: string) => void;
}) {
  const controls = useDragControls();
  return (
    <Reorder.Item
      value={section}
      dragListener={false}
      dragControls={controls}
      className="rounded-xl border bg-muted/30 p-4"
    >
      <div className="flex items-start gap-3">
        <button
          type="button"
          onPointerDown={(e) => controls.start(e)}
          className="mt-3 cursor-grab touch-none rounded-md p-1 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground active:cursor-grabbing"
          aria-label={`Drag to reorder ${section.title || "this section"}`}
          title="Drag to reorder"
        >
          <GripVertical className="size-4" />
        </button>
        <div className="min-w-0 flex-1 space-y-3">
          <Input
            value={section.title}
            onChange={(e) => onEdit(section.id, "title", e.target.value)}
            placeholder="Section title (e.g. Awards, Certifications)"
          />
          <Textarea
            rows={3}
            value={section.content}
            onChange={(e) => onEdit(section.id, "content", e.target.value)}
            placeholder="Content for this section…"
          />
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive"
          onClick={() => onRemove(section.id)}
          aria-label={`Remove ${section.title || "this section"}`}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
    </Reorder.Item>
  );
}

export default function PortfolioPage() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saved, setSaved] = useState(false);
  const [draft, setDraft] = useState<{
    headline: string;
    about: string;
    skillsText: string;
    education: string;
    experience: string;
    projects: string;
    customSections: SectionDraft[];
  } | null>(null);

  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const isAdmin = user?.is_super_admin ?? false;
  const canManage = Boolean(user && (user.is_super_admin || user.portfolio_enabled));

  // The builder is for the Super Admin or students the admin granted access.
  // The entry point is the profile page (never in the sidebar), so anyone
  // landing here directly without access is sent back to the dashboard.
  useEffect(() => {
    if (!authLoading && user && !canManage) router.replace("/dashboard");
  }, [authLoading, user, canManage, router]);

  const { data: portfolio, isLoading } = useQuery({
    queryKey: ["portfolio"],
    queryFn: () => http.get<Portfolio>("/portfolio/"),
    enabled: canManage,
  });

  // Stable client-side ids for the reorderable custom sections. Ids are
  // stripped when saving - the backend only stores {title, content}.
  const serverSections = useMemo(
    () => (portfolio?.custom_sections ?? []).map((s, i) => ({ ...s, id: `sec-${i}` })),
    [portfolio?.custom_sections]
  );

  // While a background analysis is running, keep polling until it settles.
  const pending = portfolio?.ai_status === "PENDING" && Boolean(portfolio.public_id);
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => queryClient.invalidateQueries({ queryKey: ["portfolio"] }), 2500);
    return () => clearInterval(timer);
  }, [pending, queryClient]);

  if (authLoading || !user) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="size-7 animate-spin text-primary" />
      </div>
    );
  }
  if (!canManage) return null;
  if (isLoading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="size-7 animate-spin text-primary" />
      </div>
    );
  }

  const current = draft ?? {
    headline: portfolio?.headline ?? "",
    about: portfolio?.about ?? "",
    skillsText: (portfolio?.skills ?? []).join(", "),
    education: portfolio?.education ?? "",
    experience: portfolio?.experience ?? "",
    projects: portfolio?.projects ?? "",
    customSections: serverSections,
  };

  const setField = (key: keyof typeof current, value: string) =>
    setDraft((d) => ({ ...(d ?? current), [key]: value }));

  const setCustomSection = (id: string, field: "title" | "content", value: string) =>
    setDraft((d) => {
      const base = d ?? current;
      return {
        ...base,
        customSections: base.customSections.map((s) =>
          s.id === id ? { ...s, [field]: value } : s
        ),
      };
    });

  const addCustomSection = () => {
    // Generated here (event handler) so the id is stable for the updater.
    const id = `new-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setDraft((d) => {
      const base = d ?? current;
      return { ...base, customSections: [...base.customSections, { id, title: "", content: "" }] };
    });
  };

  const removeCustomSection = (id: string) =>
    setDraft((d) => {
      const base = d ?? current;
      return { ...base, customSections: base.customSections.filter((s) => s.id !== id) };
    });

  const reorderCustomSections = (next: SectionDraft[]) =>
    setDraft((d) => ({ ...(d ?? current), customSections: next }));

  const saveContent = async () => {
    if (!draft) {
      toast.success("No changes to save.");
      return;
    }
    try {
      const updated = await http.patch<Portfolio>("/portfolio/", {
        headline: draft.headline,
        about: draft.about,
        skills: draft.skillsText.split(",").map((s) => s.trim()).filter(Boolean),
        education: draft.education,
        experience: draft.experience,
        projects: draft.projects,
        custom_sections: draft.customSections.map((s) => ({
          title: s.title.trim(),
          content: s.content.trim(),
        })),
      });
      queryClient.setQueryData(["portfolio"], updated);
      setDraft(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      toast.success("Portfolio content saved.");
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  const onPickFile = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const updated = await http.post<Portfolio>("/portfolio/upload-resume/", form);
      queryClient.setQueryData(["portfolio"], updated);
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
      const updated = await http.post<Portfolio>("/portfolio/analyze/", {});
      queryClient.setQueryData(["portfolio"], updated);
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
      const updated = await http.post<Portfolio>("/portfolio/rebuild/", {});
      queryClient.setQueryData(["portfolio"], updated);
      toast.success(
        updated.rebuilt_ai_status === "COMPLETE"
          ? "Rebuilt resume is ready — download it below."
          : "Rebuild finished."
      );
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setRebuilding(false);
    }
  };

  const togglePublish = async (value: boolean) => {
    if (!portfolio) return;
    try {
      const updated = await http.patch<Portfolio>("/portfolio/", { is_published: value });
      queryClient.setQueryData(["portfolio"], updated);
      toast.success(value ? "Portfolio is now live." : "Portfolio is hidden.");
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  const toggleShowContact = async (value: boolean) => {
    if (!portfolio) return;
    try {
      const updated = await http.patch<Portfolio>("/portfolio/", { show_contact: value });
      queryClient.setQueryData(["portfolio"], updated);
      toast.success(value ? "Email & phone now show on the public page." : "Contact info hidden from the public page.");
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  const regenerateSlug = async () => {
    if (!portfolio) return;
    try {
      const updated = await http.post<Portfolio>("/portfolio/regenerate-slug/", {});
      queryClient.setQueryData(["portfolio"], updated);
      toast.success("New public link generated.");
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  const copyLink = async () => {
    if (!portfolio?.slug) return;
    const url = `${window.location.origin}${portfolio.public_url}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Public link copied.");
    } catch {
      toast.error("Could not copy the link.");
    }
  };

  const deleteResume = async () => {
    if (!portfolio) return;
    try {
      const updated = await http.delete<Portfolio>("/portfolio/resume/");
      queryClient.setQueryData(["portfolio"], updated);
      setConfirmDelete(false);
      toast.success("Resume removed.");
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  return (
    <div>
      <PageHeader
        title="Portfolio Builder"
        description={
          isAdmin
            ? "Your AI-powered public portfolio — built from your resume. The review is private; the link is public."
            : "Your portfolio, generated from your faculty resume. The review is private; the link is public."
        }
      />

        {/* Publish / share bar */}
        <div className="mb-6 flex flex-col gap-4 rounded-2xl border bg-card p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Globe className="size-5" />
            </div>
            <div>
              <p className="text-sm font-semibold">Public portfolio link</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Anyone with the link can view it — no login needed. The resume and AI review stay private.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2.5">
            <label className="flex cursor-pointer items-center gap-2 text-sm" title="Email & phone from your profile">
              <Switch
                checked={portfolio?.show_contact ?? false}
                onCheckedChange={(v) => toggleShowContact(Boolean(v))}
                disabled={!portfolio?.slug}
              />
              <span className="font-medium">Show contact</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <Switch
                checked={portfolio?.is_published ?? false}
                onCheckedChange={(v) => togglePublish(Boolean(v))}
                disabled={!portfolio?.slug}
              />
              <span className="font-medium">{portfolio?.is_published ? "Published" : "Hidden"}</span>
            </label>
            <Button variant="outline" size="sm" onClick={copyLink} disabled={!portfolio?.slug}>
              <Copy className="size-4" /> Copy link
            </Button>
            <Button variant="ghost" size="sm" onClick={regenerateSlug} disabled={!portfolio}>
              <RefreshCw className="size-4" /> New link
            </Button>
          </div>
        </div>

        {/* Resume upload / management */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="size-4.5 text-primary" /> Your resume
            </CardTitle>
            <CardDescription>
              Upload your own resume (PDF, DOC or DOCX). Only you can see it — it never appears in faculty
              or student lists. The AI reviews it and builds the portfolio below.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!portfolio?.public_id ? (
              isAdmin ? (
                <EmptyState
                  icon={FileUp}
                  title="No resume uploaded yet"
                  description="Upload your resume and the AI will review it and build your portfolio automatically."
                  action={
                    <Button onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                      {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
                      Upload resume
                    </Button>
                  }
                />
              ) : (
                <EmptyState
                  icon={FileUp}
                  title="Upload a resume first"
                  description="Your portfolio is built from the resume you upload for faculty. Add one from your resume page, then come back and generate."
                  action={
                    <Link href="/resume">
                      <Button>
                        <FileUp className="size-4" /> Go to my resume
                      </Button>
                    </Link>
                  }
                />
              )
            ) : (
              <div className="space-y-4">
                <div className="flex flex-col gap-3 rounded-xl border bg-muted/30 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <FileText className="size-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{portfolio.file_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatBytes(portfolio.file_size)} · {isAdmin ? "uploaded file" : "from your faculty resume"}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant={
                        portfolio.ai_status === "COMPLETE"
                          ? "default"
                          : portfolio.ai_status === "FAILED"
                            ? "destructive"
                            : "outline"
                      }
                    >
                      {portfolio.ai_status === "COMPLETE"
                        ? "Analyzed"
                        : portfolio.ai_status === "FAILED"
                          ? "Analysis failed"
                          : "Analyzing…"}
                    </Badge>
                    <Button variant="outline" size="sm" onClick={() => window.open(portfolio.cloudinary_url, "_blank")}>
                      Preview
                    </Button>
                    {isAdmin && (
                      <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                        {uploading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                        Replace
                      </Button>
                    )}
                    {isAdmin && (
                      <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setConfirmDelete(true)}>
                        <Trash2 className="size-4" /> Remove
                      </Button>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button onClick={runAnalysis} disabled={analyzing || pending}>
                    {analyzing || pending ? <Loader2 className="size-4 animate-spin" /> : <BrainCircuit className="size-4" />}
                    {isAdmin
                      ? "Run AI review"
                      : portfolio.ai_status === "COMPLETE"
                        ? "Regenerate portfolio"
                        : "Generate my portfolio"}
                  </Button>
                  {isAdmin && (
                    <Button variant="outline" onClick={runRebuild} disabled={rebuilding || !portfolio.public_id}>
                      {rebuilding ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
                      Rebuild resume with AI
                    </Button>
                  )}
                </div>
              </div>
            )}
            {isAdmin && (
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
            )}
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
            {!portfolio?.public_id ? (
              <p className="text-sm text-muted-foreground">
                {isAdmin
                  ? "Upload your resume to get an AI review."
                  : "Generate your portfolio to get an AI review of your resume."}
              </p>
            ) : portfolio.ai_status === "PENDING" ? (
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin text-primary" />
                The AI is reviewing your resume — this can take a minute…
              </div>
            ) : portfolio.ai_status === "FAILED" ? (
              <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
                <TriangleAlert className="mt-0.5 size-4.5 shrink-0 text-destructive" />
                <div>
                  <p className="text-sm font-medium">The review could not be completed</p>
                  <p className="mt-1 text-xs text-muted-foreground">{portfolio.ai_error || "Try again in a moment."}</p>
                  <Button size="sm" variant="outline" className="mt-3" onClick={runAnalysis} disabled={analyzing}>
                    {analyzing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                    Try again
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                  <ScoreChip score={portfolio.ai_score} />
                  <div className="space-y-1">
                    <StarRating score={portfolio.ai_score} />
                    {portfolio.ai_analyzed_at && (
                      <p className="text-xs text-muted-foreground">
                        Reviewed {formatDate(portfolio.ai_analyzed_at)}
                        {portfolio.ai_analysis?.ocr ? " · analyzed from page images (OCR)" : ""}
                      </p>
                    )}
                  </div>
                </div>
                {portfolio.ai_analysis && <AnalysisBlock analysis={portfolio.ai_analysis} />}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Editable public content */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <IdCard className="size-4.5 text-primary" /> Portfolio content
              <Badge variant="outline" className="ml-1 text-[10px]">Auto-built, editable</Badge>
            </CardTitle>
            <CardDescription>
              Generated from your resume by the AI — tweak anything before publishing. This is what visitors
              see on the public link.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4">
              <div>
                <Label htmlFor="pf-headline">Headline</Label>
                <Input
                  id="pf-headline"
                  value={current.headline}
                  onChange={(e) => setField("headline", e.target.value)}
                  placeholder="e.g. Placement Head & Software Engineer"
                />
              </div>
              <div>
                <Label htmlFor="pf-about">About</Label>
                <Textarea
                  id="pf-about"
                  rows={3}
                  value={current.about}
                  onChange={(e) => setField("about", e.target.value)}
                  placeholder="Short professional bio…"
                />
              </div>
              <div>
                <Label htmlFor="pf-skills">Skills</Label>
                <Input
                  id="pf-skills"
                  value={current.skillsText}
                  onChange={(e) => setField("skillsText", e.target.value)}
                  placeholder="Python, SQL, Git…"
                />
                <p className="mt-1 text-[11px] text-muted-foreground">Comma-separated.</p>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <Label htmlFor="pf-edu">Education</Label>
                  <Textarea id="pf-edu" rows={2} value={current.education} onChange={(e) => setField("education", e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="pf-exp">Experience</Label>
                  <Textarea id="pf-exp" rows={2} value={current.experience} onChange={(e) => setField("experience", e.target.value)} />
                </div>
              </div>
              <div>
                <Label htmlFor="pf-projects">Projects</Label>
                <Textarea id="pf-projects" rows={2} value={current.projects} onChange={(e) => setField("projects", e.target.value)} />
              </div>
              <div className="flex items-center gap-2">
                <Button onClick={saveContent} disabled={!draft}>
                  {saved ? <Check className="size-4" /> : <Sparkles className="size-4" />}
                  {saved ? "Saved" : "Save content"}
                </Button>
                {draft && (
                  <Button variant="ghost" onClick={() => setDraft(null)}>
                    Discard
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Custom sections */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ListChecks className="size-4.5 text-primary" /> Custom sections
            </CardTitle>
            <CardDescription>
              Extra content beyond the auto-built fields — awards, certifications, achievements, anything
              you want visitors to see on the public page.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div>
              <Reorder.Group
                axis="y"
                values={current.customSections}
                onReorder={reorderCustomSections}
                className="space-y-4"
              >
                {current.customSections.map((section) => (
                  <CustomSectionRow
                    key={section.id}
                    section={section}
                    onEdit={setCustomSection}
                    onRemove={removeCustomSection}
                  />
                ))}
              </Reorder.Group>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Button variant="outline" size="sm" onClick={addCustomSection}>
                  <Plus className="size-4" /> Add section
                </Button>
                <Button size="sm" onClick={saveContent} disabled={!draft}>
                  {saved ? <Check className="size-4" /> : <Sparkles className="size-4" />}
                  {saved ? "Saved" : "Save sections"}
                </Button>
                {draft && (
                  <Button variant="ghost" size="sm" onClick={() => setDraft(null)}>
                    Discard
                  </Button>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground">
                Drag the ⠿ handle to reorder — sections appear in this order on the public
                page. Empty sections are skipped automatically; up to 10 allowed.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* AI rebuild - a Super Admin premium tool */}
        {isAdmin && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Wand2 className="size-4.5 text-primary" /> AI-rebuilt resume
              <Badge variant="outline" className="ml-1 text-[10px]">Private</Badge>
            </CardTitle>
            <CardDescription>
              The AI rewrites your resume into a polished, ATS-friendly version. Review it here, download the
              .docx, and see the new score.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!portfolio?.public_id ? (
              <p className="text-sm text-muted-foreground">Upload your resume first, then rebuild it with AI.</p>
            ) : !portfolio.rebuilt_sections && portfolio.rebuilt_ai_status !== "FAILED" ? (
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <Sparkles className="size-4 text-primary" />
                Not built yet — click &quot;Rebuild resume with AI&quot; above.
              </div>
            ) : portfolio.rebuilt_ai_status === "FAILED" ? (
              <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
                <TriangleAlert className="mt-0.5 size-4.5 shrink-0 text-destructive" />
                <div>
                  <p className="text-sm font-medium">The rebuild could not be completed</p>
                  <p className="mt-1 text-xs text-muted-foreground">{portfolio.rebuilt_ai_error || "Try again in a moment."}</p>
                </div>
              </div>
            ) : (
              <div className="space-y-5">
                <div className="flex flex-wrap items-center gap-2">
                  {portfolio.rebuilt_docx_url && (
                    <a
                      href={portfolio.rebuilt_docx_url}
                      target="_blank"
                      rel="noreferrer"
                      className={buttonVariants({ size: "default" })}
                    >
                      <Download className="size-4" /> Download .docx
                    </a>
                  )}
                  <Button
                    variant="outline"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(portfolio.rebuilt_text || "");
                        toast.success("Rebuilt resume text copied.");
                      } catch {
                        toast.error("Could not copy the text.");
                      }
                    }}
                  >
                    <Copy className="size-4" /> Copy text
                  </Button>
                </div>

                {portfolio.rebuilt_sections && (
                  <div className="space-y-4 rounded-xl border bg-muted/30 p-4">
                    {portfolio.rebuilt_sections.summary && (
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Summary</p>
                        <p className="mt-1 text-sm">{portfolio.rebuilt_sections.summary}</p>
                      </div>
                    )}
                    {portfolio.rebuilt_sections.skills.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Skills</p>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {portfolio.rebuilt_sections.skills.map((s) => (
                            <Badge key={s} variant="outline">{s}</Badge>
                          ))}
                        </div>
                      </div>
                    )}
                    {(["experience", "projects", "education"] as const).map((key) =>
                      portfolio.rebuilt_sections?.[key] ? (
                        <div key={key}>
                          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            {key === "experience" ? "Experience" : key === "projects" ? "Projects" : "Education"}
                          </p>
                          <p className="mt-1 text-sm whitespace-pre-line">{portfolio.rebuilt_sections[key]}</p>
                        </div>
                      ) : null
                    )}
                  </div>
                )}

                {portfolio.rebuilt_ai_status === "COMPLETE" && portfolio.rebuilt_ai_analysis && (
                  <div className="rounded-xl border bg-card p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                      <ScoreChip score={portfolio.rebuilt_ai_score} />
                      <div>
                        <p className="text-sm font-semibold">Review of the rebuilt version</p>
                        <StarRating score={portfolio.rebuilt_ai_score} />
                      </div>
                    </div>
                    <div className="mt-4">
                      <AnalysisBlock analysis={portfolio.rebuilt_ai_analysis} />
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
          </Card>
        )}

        <Separator className="my-6" />
        <p className="pb-4 text-center text-[11px] text-muted-foreground">
          {isAdmin
            ? "Your resume, the AI review and the rebuilt version are private to you — visitors on the public link only ever see the portfolio content above."
            : "Your resume and the AI review are private — visitors on the public link only ever see the portfolio content above."}
        </p>

        {isAdmin && (
          <ConfirmDialog
            open={confirmDelete}
            onOpenChange={setConfirmDelete}
            title="Remove resume?"
            description="Your resume and all its AI reviews will be deleted. The public portfolio link stays, but with empty content."
            confirmLabel="Remove resume"
            onConfirm={deleteResume}
          />
        )}
      </div>
  );
}
