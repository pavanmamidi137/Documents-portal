"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { motion } from "framer-motion";
import {
  BrainCircuit,
  CalendarDays,
  Camera,
  GraduationCap,
  Keyboard,
  KeyRound,
  Loader2,
  Mail,
  MessageSquareText,
  Pencil,
  Phone,
  ShieldCheck,
  Trash2,
  VenusAndMars,
  X,
} from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Palette } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAuth } from "@/lib/auth";
import { http } from "@/lib/api";
import { useSiteTheme } from "@/lib/site-theme";
import type { MyAiUsage } from "@/lib/types";
import { cn, formatDate, getErrorMessage, initials, roleColor } from "@/lib/utils";

const schema = z
  .object({
    old_password: z.string().min(1, "Current password is required"),
    new_password: z.string().min(6, "Minimum 6 characters"),
    confirm: z.string().min(6, "Confirm your new password"),
  })
  .refine((data) => data.new_password === data.confirm, {
    message: "Passwords do not match",
    path: ["confirm"],
  });

type FormValues = z.infer<typeof schema>;

const editSchema = z.object({
  roll_number: z.string().optional(),
  full_name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  phone: z.string().optional(),
  gender: z.string().optional(),
  passout_year: z.string().optional(),
});

type EditFormValues = z.infer<typeof editSchema>;

function MyAiUsageCard() {
  const { data, isLoading } = useQuery({
    queryKey: ["ai-usage", "mine"],
    queryFn: () => http.get<MyAiUsage>("/drives/my_ai_usage/"),
    staleTime: 30_000,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BrainCircuit className="size-5 text-primary" /> My AI Credits
        </CardTitle>
        <CardDescription>
          Credits your account has used on the placement AI tools (1 credit ≈ 1,000 tokens).
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading your usage…
          </div>
        ) : !data || data.calls === 0 ? (
          <p className="text-sm text-muted-foreground">
            You haven&apos;t used any AI credits yet. Try the <span className="font-medium text-foreground">Drive Assistant</span> or{" "}
            <span className="font-medium text-foreground">Ask AI</span> on the Placements page.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-xl border bg-muted/30 p-3 text-center">
                <p className="text-xl font-bold tabular-nums">{data.credits}</p>
                <p className="text-[10px] text-muted-foreground uppercase">Credits</p>
              </div>
              <div className="rounded-xl border bg-muted/30 p-3 text-center">
                <p className="text-xl font-bold tabular-nums">{data.calls}</p>
                <p className="text-[10px] text-muted-foreground uppercase">Calls</p>
              </div>
              <div className="rounded-xl border bg-muted/30 p-3 text-center">
                <p className="text-xl font-bold tabular-nums">{data.used_tokens.toLocaleString()}</p>
                <p className="text-[10px] text-muted-foreground uppercase">Tokens</p>
              </div>
            </div>
            {data.recent.length > 0 && (
              <div className="mt-4 space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase">Recent activity</p>
                {data.recent.slice(0, 5).map((entry, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <Badge variant="outline" className="shrink-0">
                        {entry.action_label}
                      </Badge>
                      <span className="truncate text-xs text-muted-foreground">
                        {formatDate(entry.created_at)}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                      {entry.total_tokens.toLocaleString()} tokens
                    </span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * "Edit Details" widget - opened from the pencil icon in the profile hero.
 * The form lives in a dialog so the profile page itself stays compact.
 */
function EditDetailsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { user, refreshUser } = useAuth();
  const [saving, setSaving] = useState(false);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<EditFormValues>({
    resolver: zodResolver(editSchema),
    defaultValues: { full_name: "", email: "", phone: "" },
  });

  // Prefill the form every time the dialog opens (fresh values after saves).
  useEffect(() => {
    if (open && user) {
      reset({
        roll_number: user.roll_number,
        full_name: user.full_name,
        email: user.email ?? "",
        phone: user.phone ?? "",
        gender: user.gender ?? "",
        passout_year: user.passout_year ? String(user.passout_year) : "",
      });
    }
  }, [open, user, reset]);

  const onSubmit = async (values: EditFormValues) => {
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        full_name: values.full_name.trim(),
        email: values.email?.trim() || null,
        phone: values.phone?.trim() ?? "",
        gender: values.gender || "",
        passout_year: values.passout_year ? Number(values.passout_year) : null,
      };
      // Super Admins may also change their own username (roll number).
      if (user?.is_super_admin && values.roll_number?.trim()) {
        payload.roll_number = values.roll_number.trim().toUpperCase();
      }
      await http.patch("/auth/me/", payload);
      toast.success("Profile updated.");
      await refreshUser();
      onOpenChange(false);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  if (!user) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="size-5 text-primary" /> Edit Details
          </DialogTitle>
          <DialogDescription>
            Update your name and contact details. Your branch and section stay fixed.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {user.is_super_admin && (
            <div className="space-y-2">
              <Label htmlFor="edit-username">Username (Roll Number)</Label>
              <Input
                id="edit-username"
                placeholder="e.g. ADMIN001"
                className="font-mono uppercase"
                {...register("roll_number")}
              />
              {errors.roll_number && (
                <p className="text-xs text-destructive">{errors.roll_number.message}</p>
              )}
              <p className="text-[11px] text-muted-foreground">
                This is your login username. Change it and you sign in with the new one next time.
              </p>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="edit-name">Full Name</Label>
            <Input id="edit-name" autoFocus {...register("full_name")} />
            {errors.full_name && (
              <p className="text-xs text-destructive">{errors.full_name.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-email">Email</Label>
            <Input id="edit-email" type="email" placeholder="you@college.edu" {...register("email")} />
            {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-phone">Phone</Label>
            <Input id="edit-phone" placeholder="10-digit mobile" {...register("phone")} />
          </div>
          <div className="space-y-2">
            <Label>Gender</Label>
            <select
              {...register("gender")}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm outline-none transition-colors focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/20"
            >
              <option value="">Prefer not to say</option>
              <option value="MALE">Male</option>
              <option value="FEMALE">Female</option>
              <option value="OTHER">Other</option>
            </select>
          </div>
          {(user.is_student || user.is_cr) && (
            <div className="space-y-2">
              <Label htmlFor="edit-passout">Pass-Out Year</Label>
              <Input
                id="edit-passout"
                type="number"
                min={1980}
                max={2100}
                placeholder="e.g. 2027"
                {...register("passout_year")}
              />
            </div>
          )}
          <Button type="submit" disabled={saving || !isDirty} className="w-full">
            {saving && <Loader2 className="size-4 animate-spin" />}
            Save Changes
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * "Change Password" widget - opened from the key icon in the profile hero.
 */
function ChangePasswordDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [submitting, setSubmitting] = useState(false);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const onSubmit = async (values: FormValues) => {
    setSubmitting(true);
    try {
      await http.post("/auth/change-password/", {
        old_password: values.old_password,
        new_password: values.new_password,
      });
      toast.success("Password changed successfully.");
      reset();
      onOpenChange(false);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        // Never let ESC/backdrop close the dialog mid-submit.
        if (submitting && !v) return;
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="size-5 text-primary" /> Change Password
          </DialogTitle>
          <DialogDescription>Keep your account secure with a strong password.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="old">Current Password</Label>
            <Input id="old" type="password" autoFocus {...register("old_password")} />
            {errors.old_password && (
              <p className="text-xs text-destructive">{errors.old_password.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="new">New Password</Label>
            <Input id="new" type="password" {...register("new_password")} />
            {errors.new_password && (
              <p className="text-xs text-destructive">{errors.new_password.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm">Confirm New Password</Label>
            <Input id="confirm" type="password" {...register("confirm")} />
            {errors.confirm && (
              <p className="text-xs text-destructive">{errors.confirm.message}</p>
            )}
          </div>
          <Button type="submit" disabled={submitting} className="w-full">
            {submitting && <Loader2 className="size-4 animate-spin" />}
            Update Password
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ThemePickerCard() {
  const { theme, themes, setTheme } = useSiteTheme();
  const [saving, setSaving] = useState<string | null>(null);

  const apply = async (key: string) => {
    if (key === theme || saving) return;
    setSaving(key);
    try {
      await setTheme(key);
      toast.success(`Theme changed to ${themes.find((t) => t.key === key)?.label}.`);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSaving(null);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
    >
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Palette className="size-5 text-primary" /> Portal Theme
          </CardTitle>
          <CardDescription>
            Choose the color theme for the whole college. It is applied instantly for everyone —
            students, CRs and admins.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {themes.map((t) => {
              const active = t.key === theme;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => apply(t.key)}
                  disabled={!!saving}
                  className={cn(
                    "group flex items-center gap-3 rounded-xl border p-3 text-left transition-all",
                    active
                      ? "border-primary bg-primary/5 ring-2 ring-primary/30"
                      : "hover:-translate-y-0.5 hover:border-primary/40 hover:bg-muted/40"
                  )}
                >
                  <span
                    className="flex size-9 shrink-0 items-center justify-center rounded-full ring-1 ring-foreground/10"
                    style={{
                      background: `linear-gradient(135deg, ${t.colors[0]}, ${t.colors[1]})`,
                    }}
                  >
                    {active && <span className="size-3 rounded-full bg-white/90 shadow" />}
                    {saving === t.key && <span className="size-3 animate-ping rounded-full bg-white/70" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{t.label}</span>
                    <span className="block truncate text-xs text-muted-foreground">{t.description}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            Tip: pair the theme with the light/dark toggle in the top bar.
          </p>
        </CardContent>
      </Card>
    </motion.div>
  );
}

const MAX_AVATAR_SIZE = 2 * 1024 * 1024; // 2MB

/**
 * Downscale + re-encode an oversized image so it fits under the 2MB limit.
 * Two scale-down passes (1024px then 512px) with progressively lower JPEG
 * quality. PNG transparency is flattened onto a white background. When the
 * image is already small enough it is returned untouched.
 */
async function compressImage(file: File): Promise<{ blob: Blob; compressed: boolean }> {
  if (file.size <= MAX_AVATAR_SIZE) return { blob: file, compressed: false };
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Could not read image"));
      image.src = objectUrl;
    });
    if (!img.naturalWidth || !img.naturalHeight) return { blob: file, compressed: false };
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return { blob: file, compressed: false };
    let smallest: Blob | null = null;
    for (const maxEdge of [1024, 512]) {
      const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
      const width = Math.max(1, Math.round(img.naturalWidth * scale));
      const height = Math.max(1, Math.round(img.naturalHeight * scale));
      canvas.width = width;
      canvas.height = height;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      for (const quality of [0.85, 0.7, 0.5, 0.35]) {
        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, "image/jpeg", quality)
        );
        if (!blob) continue;
        if (!smallest || blob.size < smallest.size) smallest = blob;
        if (blob.size <= MAX_AVATAR_SIZE) return { blob, compressed: true };
      }
    }
    return { blob: smallest ?? file, compressed: true };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function AvatarCard() {
  const { user, refreshUser } = useAuth();
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  if (!user) return null;

  const pick = () => inputRef.current?.click();

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const { blob, compressed } = await compressImage(file);
      const form = new FormData();
      form.append(
        "file",
        compressed ? new File([blob], "avatar.jpg", { type: "image/jpeg" }) : file
      );
      await http.upload("/auth/me/avatar/", form);
      toast.success(
        compressed
          ? "Photo was over 2MB — compressed and uploaded."
          : "Profile picture updated."
      );
      await refreshUser();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const remove = async () => {
    setRemoving(true);
    try {
      await http.delete("/auth/me/avatar/");
      toast.success("Profile picture removed.");
      await refreshUser();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div className="flex flex-col items-center gap-3 sm:items-start">
      <input
        ref={inputRef}
        type="file"
        accept=".jpg,.jpeg,.png,.webp,.gif"
        className="hidden"
        title="Max 2MB"
        onChange={(e) => upload(e.target.files?.[0])}
      />
      <div className="group relative">
        {user.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={user.avatar_url}
            alt={user.full_name}
            className="size-24 rounded-3xl object-cover shadow-lg shadow-primary/20 ring-4 ring-primary/10"
          />
        ) : (
          <div className="flex size-24 items-center justify-center rounded-3xl bg-gradient-to-br from-primary to-primary/60 text-3xl font-bold text-primary-foreground shadow-lg shadow-primary/30">
            {initials(user.full_name)}
          </div>
        )}
        <button
          type="button"
          onClick={pick}
          disabled={uploading}
          title="Upload profile picture"
          aria-label="Upload profile picture"
          className="absolute right-0 -bottom-1 flex size-8 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-md transition-all hover:scale-105 hover:text-foreground disabled:opacity-50"
        >
          {uploading ? <Loader2 className="size-4 animate-spin" /> : <Camera className="size-4" />}
        </button>
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={pick} disabled={uploading} className="h-8 gap-1.5 text-xs">
          <Camera className="size-3.5" /> {uploading ? "Uploading…" : "Change photo"}
        </Button>
        {user.avatar_url && (
          <Button
            size="sm"
            variant="ghost"
            onClick={remove}
            disabled={removing}
            className="h-8 gap-1.5 text-xs text-destructive hover:text-destructive"
          >
            <Trash2 className="size-3.5" /> {removing ? "Removing…" : "Remove"}
          </Button>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">
        Photos over 2MB are compressed automatically before uploading.
      </p>
    </div>
  );
}

export default function ProfilePage() {
  const { user } = useAuth();
  // The Edit Details and Change Password widgets open from the hero icons.
  const [editOpen, setEditOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  // First-visit hint for the E / P shortcuts (dismissed once, remembered).
  // Lazy initializer keeps it out of an effect (lint) and is safe because the
  // page renders null until auth loads, so there's no hydration mismatch.
  const [showShortcutHint, setShowShortcutHint] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return localStorage.getItem("profile_shortcut_hint_dismissed") !== "1";
    } catch {
      /* private mode - show the hint */
      return true;
    }
  });

  // Keyboard shortcuts: E opens Edit Details, P opens Change Password.
  // Ignored while typing in a field or with modifier keys held, so normal
  // form entry (e.g. an email address) is never hijacked. The widgets
  // themselves already close on Escape (base-ui Dialog default).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName ?? "";
      const typing =
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        Boolean(target?.isContentEditable);
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === "e") {
        e.preventDefault();
        setEditOpen(true);
      } else if (key === "p") {
        e.preventDefault();
        setPasswordOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const dismissShortcutHint = () => {
    setShowShortcutHint(false);
    try {
      localStorage.setItem("profile_shortcut_hint_dismissed", "1");
    } catch {
      /* private mode */
    }
  };

  if (!user) return null;

  const canContactAdmin = user.is_faculty || user.is_cr;

  return (
    <div>
      <PageHeader title="My Profile" description="Your account details and security settings." />

      {/* First-visit keyboard shortcut hint (dismissed once, then hidden) */}
      {showShortcutHint && (
        <div className="mb-6 flex items-start justify-between gap-3 rounded-xl border bg-primary/5 px-4 py-3">
          <div className="flex min-w-0 items-start gap-2.5">
            <Keyboard className="mt-0.5 size-4 shrink-0 text-primary" />
            <div className="min-w-0">
              <p className="text-sm font-medium">Quick edit shortcuts</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Press{" "}
                <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] font-semibold">
                  E
                </kbd>{" "}
                to edit your details or{" "}
                <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] font-semibold">
                  P
                </kbd>{" "}
                to change your password. <span className="text-muted-foreground/70">Esc closes them.</span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={dismissShortcutHint}
            aria-label="Dismiss shortcut hint"
            className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
      )}

      {/* ------------------------------------------------ Hero card */}
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="relative mb-6 overflow-hidden rounded-2xl border bg-card shadow-sm"
      >
        <div className="pointer-events-none absolute -top-20 -right-20 size-64 rounded-full bg-gradient-to-br from-primary/20 to-primary/5 blur-3xl" />
        {/* Quick actions — icons open the edit/password widgets */}
        <div className="absolute top-4 right-4 z-10 flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  onClick={() => setEditOpen(true)}
                  className="flex size-9 cursor-pointer items-center justify-center rounded-full border bg-background/80 text-muted-foreground shadow-sm backdrop-blur transition-all hover:scale-105 hover:border-primary/40 hover:text-primary"
                  aria-label="Edit details"
                >
                  <Pencil className="size-4" />
                </button>
              }
            />
            <TooltipContent>Edit Details (E)</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  onClick={() => setPasswordOpen(true)}
                  className="flex size-9 cursor-pointer items-center justify-center rounded-full border bg-background/80 text-muted-foreground shadow-sm backdrop-blur transition-all hover:scale-105 hover:border-primary/40 hover:text-primary"
                  aria-label="Change password"
                >
                  <KeyRound className="size-4" />
                </button>
              }
            />
            <TooltipContent>Change Password (P)</TooltipContent>
          </Tooltip>
        </div>
        <div className="relative flex flex-col gap-6 p-6 sm:flex-row sm:items-center sm:p-8">
          <AvatarCard />
          <div className="min-w-0 flex-1 text-center sm:text-left">
            <h2 className="text-2xl font-bold tracking-tight">{user.full_name}</h2>
            <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5 sm:justify-start">
              <Badge variant="outline" className={roleColor(user.role)}>
                {user.role_label}
              </Badge>
              <Badge variant={user.is_active ? "default" : "outline"}>
                {user.is_active ? "Active" : "Inactive"}
              </Badge>
            </div>
            <div className="mt-4 grid max-w-xl gap-3 text-left sm:grid-cols-2">
              <div className="flex items-center gap-2.5 rounded-xl border bg-muted/30 px-3 py-2">
                <ShieldCheck className="size-4 shrink-0 text-primary" />
                <div className="min-w-0">
                  <p className="text-[10px] text-muted-foreground uppercase">Roll Number</p>
                  <p className="truncate font-mono text-sm font-medium">{user.roll_number}</p>
                </div>
              </div>
              <div className="flex items-center gap-2.5 rounded-xl border bg-muted/30 px-3 py-2">
                <GraduationCap className="size-4 shrink-0 text-primary" />
                <div className="min-w-0">
                  <p className="text-[10px] text-muted-foreground uppercase">Branch / Section</p>
                  <p className="truncate text-sm font-medium">
                    {user.branch_code || user.branch_name || "—"}{" "}
                    {user.section_name ? `/ Sec ${user.section_name}` : ""}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2.5 rounded-xl border bg-muted/30 px-3 py-2">
                <VenusAndMars className="size-4 shrink-0 text-primary" />
                <div className="min-w-0">
                  <p className="text-[10px] text-muted-foreground uppercase">Gender</p>
                  <p className="truncate text-sm font-medium">{user.gender_label || "—"}</p>
                </div>
              </div>
              <div className="flex items-center gap-2.5 rounded-xl border bg-muted/30 px-3 py-2">
                <CalendarDays className="size-4 shrink-0 text-primary" />
                <div className="min-w-0">
                  <p className="text-[10px] text-muted-foreground uppercase">Pass-Out Year</p>
                  <p className="truncate text-sm font-medium">{user.passout_year ?? "—"}</p>
                </div>
              </div>
              <div className="flex items-center gap-2.5 rounded-xl border bg-muted/30 px-3 py-2">
                <Mail className="size-4 shrink-0 text-primary" />
                <div className="min-w-0">
                  <p className="text-[10px] text-muted-foreground uppercase">Email</p>
                  <p className="truncate text-sm font-medium">{user.email ?? "—"}</p>
                </div>
              </div>
              <div className="flex items-center gap-2.5 rounded-xl border bg-muted/30 px-3 py-2">
                <Phone className="size-4 shrink-0 text-primary" />
                <div className="min-w-0">
                  <p className="text-[10px] text-muted-foreground uppercase">Phone</p>
                  <p className="truncate text-sm font-medium">{user.phone || "—"}</p>
                </div>
              </div>
            </div>
            <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-muted-foreground sm:justify-start">
              <CalendarDays className="size-3.5" /> Member since {formatDate(user.date_joined)}
            </p>
          </div>
        </div>
      </motion.div>

      {user.is_super_admin && (
        <div className="mb-6">
          <ThemePickerCard />
        </div>
      )}

      {(user.is_student || user.is_cr) && (
        <div className="mb-6 rounded-2xl border bg-card p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">Profile completion</p>
              <p className="text-xs text-muted-foreground">
                Fill in your details to help faculty and the placement cell match you better.
              </p>
            </div>
            <p className="text-lg font-bold tabular-nums text-primary">{user.profile_completion}%</p>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${user.profile_completion}%` }}
              transition={{ duration: 0.6, ease: "easeOut" }}
              className="h-full rounded-full bg-gradient-to-r from-primary to-primary/60"
            />
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Name, email, phone, gender, pass-out year, profile picture and a delivered resume all
            count toward your completion.
          </p>
        </div>
      )}

      <MyAiUsageCard />

      {/* Edit Details / Change Password widgets - opened from the hero icons */}
      <EditDetailsDialog open={editOpen} onOpenChange={setEditOpen} />
      <ChangePasswordDialog open={passwordOpen} onOpenChange={setPasswordOpen} />

      {/* Footer — Support is only shown to CRs and faculty (admins manage support
          from their own pages). */}
      {canContactAdmin && (
        <div className="mt-8 border-t pt-6">
          <div className="flex flex-col items-start justify-between gap-4 rounded-2xl border bg-card p-5 shadow-sm sm:flex-row sm:items-center">
            <div className="flex items-start gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <MessageSquareText className="size-5" />
              </div>
              <div>
                <p className="text-sm font-semibold">Support</p>
                <p className="mt-0.5 max-w-md text-xs text-muted-foreground">
                  Need a subject added, an account fixed or something escalated? Message the admin
                  and track the reply right here.
                </p>
              </div>
            </div>
            <Link href="/contact-admin">
              <Button variant="outline">
                <MessageSquareText className="size-4" /> Open Support
              </Button>
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
