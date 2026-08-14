"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Reorder, useDragControls } from "framer-motion";
import {
  BrainCircuit,
  Check,
  Copy,
  Download,
  FileCode2,
  FileText,
  FileUp,
  Globe,
  GripVertical,
  IdCard,
  Image as ImageIcon,
  Lightbulb,
  ListChecks,
  Loader2,
  Monitor,
  Moon,
  Palette,
  Plus,
  RefreshCw,
  Sparkles,
  Star,
  Sun,
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
import { SITE_THEMES } from "@/lib/site-theme";
import { http } from "@/lib/api";
import type {
  Portfolio,
  PortfolioBackgroundImage,
  PortfolioPlacedImage,
  PortfolioSection,
  PortfolioTheme,
  ResumeAiAnalysis,
} from "@/lib/types";
import { cn, formatBytes, formatDate, getErrorMessage } from "@/lib/utils";

const ACCEPTED = ".pdf,.doc,.docx";

/** A safe file-name prefix for the rebuilt resume downloads. */
function slugName(p: Portfolio): string {
  const base = (p.owner_name || p.slug || "resume").toLowerCase();
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

function PlacedImageEditor({
  image,
  onChange,
  onRemove,
}: {
  image: PortfolioPlacedImage;
  onChange: (patch: Partial<PortfolioPlacedImage>) => void;
  onRemove: () => void;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const moveTo = (clientX: number, clientY: number) => {
    const frame = frameRef.current;
    if (!frame) return;
    const rect = frame.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const x = Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100));
    const y = Math.min(100, Math.max(0, ((clientY - rect.top) / rect.height) * 100));
    onChange({ x: Math.round(x), y: Math.round(y) });
  };

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex flex-col gap-4 lg:flex-row">
        {/* Live canvas preview with drag-to-move */}
        <div className="flex-1">
          <div
            ref={frameRef}
            className="relative h-48 w-full cursor-move touch-none overflow-hidden rounded-xl border bg-muted/40"
            onPointerDown={(e) => {
              dragging.current = true;
              e.currentTarget.setPointerCapture(e.pointerId);
              moveTo(e.clientX, e.clientY);
            }}
            onPointerMove={(e) => {
              if (dragging.current) moveTo(e.clientX, e.clientY);
            }}
            onPointerUp={() => {
              dragging.current = false;
            }}
            onPointerCancel={() => {
              dragging.current = false;
            }}
          >
            <img
              src={image.url}
              alt={image.alt || "Portfolio image"}
              className="pointer-events-none absolute select-none rounded-lg object-contain shadow-lg"
              style={{
                left: `${image.x}%`,
                top: `${image.y}%`,
                width: image.width,
                height: image.height,
                opacity: image.opacity,
                transform: "translate(-50%, -50%)",
              }}
              draggable={false}
            />
            <span className="pointer-events-none absolute bottom-2 left-2 rounded-md bg-background/80 px-2 py-0.5 text-[10px] text-muted-foreground">
              Drag the image to move · x {image.x}% y {image.y}%
            </span>
          </div>
        </div>

        {/* Controls */}
        <div className="w-full space-y-3.5 lg:w-72">
          <div>
            <Label htmlFor={`img-alt-${image.public_id}`}>Caption (optional)</Label>
            <Input
              id={`img-alt-${image.public_id}`}
              value={image.alt}
              onChange={(e) => onChange({ alt: e.target.value })}
              placeholder="e.g. My photo"
              className="mt-1"
            />
          </div>
          <div>
            <Label>Width · {image.width}px</Label>
            <input
              type="range"
              min={40}
              max={900}
              value={image.width}
              onChange={(e) => onChange({ width: Number(e.target.value) })}
              className="mt-1.5 w-full accent-primary"
            />
          </div>
          <div>
            <Label>Height · {image.height}px</Label>
            <input
              type="range"
              min={40}
              max={900}
              value={image.height}
              onChange={(e) => onChange({ height: Number(e.target.value) })}
              className="mt-1.5 w-full accent-primary"
            />
          </div>
          <div>
            <Label>Transparency · {Math.round(image.opacity * 100)}%</Label>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(image.opacity * 100)}
              onChange={(e) => onChange({ opacity: Number(e.target.value) / 100 })}
              className="mt-1.5 w-full accent-primary"
            />
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" className="text-destructive" onClick={onRemove}>
              <Trash2 className="size-4" /> Remove
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

type BuilderTab = "resume" | "portfolio" | "design";

/** Pending unsaved changes for the image designer. */
interface DesignDraft {
  images: PortfolioPlacedImage[];
  background: PortfolioBackgroundImage | null;
}

export default function PortfolioPage() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const bgInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saved, setSaved] = useState(false);
  const [tab, setTab] = useState<BuilderTab>("resume");
  const [themeDraft, setThemeDraft] = useState<PortfolioTheme | null>(null);
  const [designDraft, setDesignDraft] = useState<DesignDraft | null>(null);
  const [sourceDraft, setSourceDraft] = useState<string | null>(null);
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

  // Download URLs for the rebuilt formats (plain text downloads only).
  const rebuiltBlobs = useMemo(() => {
    const make = (content: string, type: string) =>
      content ? URL.createObjectURL(new Blob([content], { type })) : null;
    return {
      tex: make(portfolio?.rebuilt_tex ?? "", "text/plain"),
      txt: make(portfolio?.rebuilt_text ?? "", "text/plain"),
    };
  }, [portfolio?.rebuilt_tex, portfolio?.rebuilt_text]);

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

  const theme = themeDraft ?? portfolio?.theme ?? { mode: "auto", accent: "#f56d14" };

  const saveTheme = async () => {
    if (!themeDraft) {
      toast.success("No changes to save.");
      return;
    }
    try {
      const updated = await http.patch<Portfolio>("/portfolio/", { theme: themeDraft });
      queryClient.setQueryData(["portfolio"], updated);
      setThemeDraft(null);
      toast.success("Portfolio theme saved.");
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

  // ----- Resume source (LaTeX) -----
  const saveSource = async () => {
    if (sourceDraft == null) {
      toast.success("No changes to save.");
      return;
    }
    try {
      const updated = await http.patch<Portfolio>("/portfolio/", { resume_source: sourceDraft });
      queryClient.setQueryData(["portfolio"], updated);
      setSourceDraft(null);
      toast.success("Resume source saved — it will be filled by the AI on the next rebuild.");
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  // ----- Image designer -----
  const design = designDraft ?? {
    images: portfolio?.images ?? [],
    background: portfolio?.background_image ?? null,
  };

  const setPlacedImage = (index: number, patch: Partial<PortfolioPlacedImage>) =>
    setDesignDraft((d) => {
      const base = d ?? design;
      return {
        ...base,
        images: base.images.map((img, i) => (i === index ? { ...img, ...patch } : img)),
      };
    });

  const removePlacedImage = (index: number) =>
    setDesignDraft((d) => {
      const base = d ?? design;
      return { ...base, images: base.images.filter((_, i) => i !== index) };
    });

  const onPickImage = async (file: File | undefined, kind: "image" | "background") => {
    if (!file) return;
    setUploadingImage(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const uploaded = await http.post<{
        url: string;
        public_id: string;
        file_name: string;
      }>("/portfolio/upload-image/", form);
      if (kind === "background") {
        setDesignDraft((d) => ({
          ...(d ?? design),
          background: { url: uploaded.url, public_id: uploaded.public_id, opacity: 0.35, darken: 0.55 },
        }));
      } else {
        setDesignDraft((d) => {
          const base = d ?? design;
          return {
            ...base,
            images: [
              ...base.images,
              {
                url: uploaded.url,
                public_id: uploaded.public_id,
                alt: "",
                x: 50,
                y: 50,
                width: 200,
                height: 200,
                opacity: 1,
              },
            ],
          };
        });
      }
      toast.success("Image uploaded — drag it into place, then save the design.");
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setUploadingImage(false);
    }
  };

  const saveDesign = async () => {
    if (!designDraft) {
      toast.success("No changes to save.");
      return;
    }
    try {
      const updated = await http.patch<Portfolio>("/portfolio/", {
        images: designDraft.images.map((img) => ({
          url: img.url,
          public_id: img.public_id,
          alt: img.alt,
          x: img.x,
          y: img.y,
          width: img.width,
          height: img.height,
          opacity: img.opacity,
        })),
        background_image: designDraft.background,
      });
      queryClient.setQueryData(["portfolio"], updated);
      setDesignDraft(null);
      toast.success("Design saved.");
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
        actions={
          portfolio?.slug && portfolio.is_published ? (
            <Button variant="outline" onClick={() => window.open(`${window.location.origin}${portfolio.public_url}`, "_blank")}>
              <Globe className="size-4" /> View portfolio
            </Button>
          ) : undefined
        }
      />

      {/* Builder sections: Resume (private) / Portfolio (public) / Design */}
      <div className="mb-6 flex flex-wrap gap-1 rounded-2xl border bg-muted/40 p-1.5">
        {(
          [
            { key: "resume", label: "Resume", icon: FileText, hint: "private AI review & rebuild" },
            { key: "portfolio", label: "Portfolio", icon: IdCard, hint: "public content & theme" },
            { key: "design", label: "Design", icon: ImageIcon, hint: "images & background" },
          ] as const
        ).map(({ key, label, icon: Icon, hint }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              "flex flex-1 cursor-pointer flex-col items-center gap-0.5 rounded-xl px-4 py-2.5 text-sm font-medium transition-all sm:flex-row sm:justify-center sm:gap-2",
              tab === key ? "bg-card text-foreground shadow-sm ring-1 ring-border" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon className="size-4" />
            <span>{label}</span>
            <span className="hidden text-[10px] font-normal text-muted-foreground/70 sm:inline">{hint}</span>
          </button>
        ))}
      </div>

      {/* ================= Portfolio (public) tab ================= */}
      {tab === "portfolio" && (
        <>
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

        {/* Theme - how the public page looks to visitors */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Palette className="size-4.5 text-primary" /> Theme
            </CardTitle>
            <CardDescription>
              How your public portfolio page looks to visitors — pick a light/dark appearance and an accent color.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div>
              <Label>Appearance</Label>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {(
                  [
                    { mode: "auto", label: "Auto", icon: Monitor },
                    { mode: "light", label: "Light", icon: Sun },
                    { mode: "dark", label: "Dark", icon: Moon },
                  ] as const
                ).map(({ mode, label, icon: Icon }) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setThemeDraft({ ...theme, mode })}
                    className={cn(
                      "flex cursor-pointer items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium transition-all",
                      theme.mode === mode
                        ? "border-primary/50 bg-primary/10 text-primary shadow-sm"
                        : "border-border text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                    )}
                  >
                    <Icon className="size-4" /> {label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <Label>Accent color</Label>
              <div className="mt-2 flex flex-wrap items-center gap-2.5">
                {SITE_THEMES.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    title={t.label}
                    aria-label={t.label}
                    onClick={() => setThemeDraft({ ...theme, accent: t.colors[0].toLowerCase() })}
                    className={cn(
                      "size-8 cursor-pointer rounded-full ring-offset-2 ring-offset-background transition-all hover:scale-110",
                      theme.accent.toLowerCase() === t.colors[0]
                        ? "ring-2 ring-primary"
                        : "ring-1 ring-border"
                    )}
                    style={{ backgroundColor: t.colors[0] }}
                  />
                ))}
                <label className="flex cursor-pointer items-center gap-2 rounded-full border border-dashed px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground">
                  <input
                    type="color"
                    value={theme.accent}
                    onChange={(e) => setThemeDraft({ ...theme, accent: e.target.value.toLowerCase() })}
                    className="size-5 cursor-pointer appearance-none border-0 bg-transparent p-0"
                    aria-label="Custom accent color"
                  />
                  Custom
                </label>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button onClick={saveTheme} disabled={!themeDraft}>
                <Check className="size-4" /> Save theme
              </Button>
              {themeDraft && (
                <Button variant="ghost" onClick={() => setThemeDraft(null)}>
                  Discard
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        </>
      )}

      {/* ================= Resume (private) tab ================= */}
      {tab === "resume" && (
        <>
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

        </>
      )}

      {/* ================= Resume tab (continued) ================= */}
      {tab === "resume" && isAdmin && (
        <>
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
            <Textarea
              rows={8}
              value={sourceDraft ?? portfolio?.resume_source ?? ""}
              onChange={(e) => setSourceDraft(e.target.value)}
              placeholder={"%\\documentclass{article}\n\\begin{document}\n% your original LaTeX resume…\n\\end{document}"}
              className="font-mono text-xs"
            />
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

        {/* AI rebuild - a Super Admin premium tool */}
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
                      <Download className="size-4" /> .docx
                    </a>
                  )}
                  {portfolio.rebuilt_pdf_url && (
                    <a
                      href={portfolio.rebuilt_pdf_url}
                      target="_blank"
                      rel="noreferrer"
                      className={buttonVariants({ size: "default", variant: "outline" })}
                    >
                      <Download className="size-4" /> .pdf
                    </a>
                  )}
                  {portfolio.rebuilt_tex && rebuiltBlobs.tex && (
                    <a
                      href={rebuiltBlobs.tex}
                      download={`${slugName(portfolio)}-rebuilt.tex`}
                      className={buttonVariants({ size: "default", variant: "outline" })}
                    >
                      <FileCode2 className="size-4" /> .tex
                    </a>
                  )}
                  {rebuiltBlobs.txt && (
                    <a
                      href={rebuiltBlobs.txt}
                      download={`${slugName(portfolio)}-rebuilt.txt`}
                      className={buttonVariants({ size: "default", variant: "outline" })}
                    >
                      <FileText className="size-4" /> .txt
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

        </>
      )}

      {/* ================= Design tab ================= */}
      {tab === "design" && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ImageIcon className="size-4.5 text-primary" /> Design studio
            </CardTitle>
            <CardDescription>
              Add images and a background to your public portfolio page. Drag to position, then resize and set
              transparency — everything is adjustable until it looks right.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Background image */}
            <div className="rounded-xl border bg-muted/30 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold">Background image</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Fills the whole page behind the content. JPG, PNG, GIF or WebP.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    ref={bgInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      onPickImage(file, "background");
                      e.target.value = "";
                    }}
                  />
                  <Button variant="outline" size="sm" onClick={() => bgInputRef.current?.click()} disabled={uploadingImage}>
                    {uploadingImage ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
                    {design.background ? "Replace" : "Upload"}
                  </Button>
                  {design.background && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive"
                      onClick={() => setDesignDraft((d) => ({ ...(d ?? design), background: null }))}
                    >
                      <Trash2 className="size-4" /> Remove
                    </Button>
                  )}
                </div>
              </div>
              {design.background && (
                <div className="mt-4 space-y-4">
                  <div
                    className="h-28 w-full overflow-hidden rounded-xl border bg-cover bg-center"
                    style={{ backgroundImage: `url(${design.background.url})` }}
                  />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <Label>Transparency ({Math.round(design.background.opacity * 100)}%)</Label>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={Math.round(design.background.opacity * 100)}
                        onChange={(e) => {
                          const base = designDraft ?? design;
                          setDesignDraft({ ...base, background: { ...base.background!, opacity: Number(e.target.value) / 100 } });
                        }}
                        className="mt-1.5 w-full accent-primary"
                      />
                    </div>
                    <div>
                      <Label>Darken overlay ({Math.round(design.background.darken * 100)}%)</Label>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={Math.round(design.background.darken * 100)}
                        onChange={(e) => {
                          const base = designDraft ?? design;
                          setDesignDraft({ ...base, background: { ...base.background!, darken: Number(e.target.value) / 100 } });
                        }}
                        className="mt-1.5 w-full accent-primary"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Floating images */}
            <div className="rounded-xl border bg-muted/30 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold">Floating images</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Add photos or logos anywhere on the page — drag the image to move it.
                  </p>
                </div>
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    onPickImage(file, "image");
                    e.target.value = "";
                  }}
                />
                <Button variant="outline" size="sm" onClick={() => imageInputRef.current?.click()} disabled={uploadingImage}>
                  {uploadingImage ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                  Add image
                </Button>
              </div>

              {design.images.length === 0 ? (
                <p className="mt-4 text-sm text-muted-foreground">No images yet — add one to start designing.</p>
              ) : (
                <div className="mt-4 space-y-4">
                  {design.images.map((img, i) => (
                    <PlacedImageEditor
                      key={img.public_id || img.url}
                      image={img}
                      onChange={(patch) => setPlacedImage(i, patch)}
                      onRemove={() => removePlacedImage(i)}
                    />
                  ))}
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={saveDesign} disabled={!designDraft}>
                {designDraft ? <Check className="size-4" /> : <Sparkles className="size-4" />}
                Save design
              </Button>
              {designDraft && (
                <Button variant="ghost" onClick={() => setDesignDraft(null)}>
                  Discard
                </Button>
              )}
              <p className="text-[11px] text-muted-foreground">
                Position, size and transparency are saved per image and shown exactly like this on the public page.
              </p>
            </div>
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
