"use client";

import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { motion } from "framer-motion";
import {
  CalendarDays,
  GraduationCap,
  KeyRound,
  Loader2,
  LogOut,
  Mail,
  MessageSquareText,
  Pencil,
  Phone,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Palette } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { useAuth } from "@/lib/auth";
import { http } from "@/lib/api";
import { useSiteTheme } from "@/lib/site-theme";
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
  full_name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  phone: z.string().optional(),
});

type EditFormValues = z.infer<typeof editSchema>;

function EditDetailsCard() {
  const { user, refreshUser } = useAuth();
  const [saving, setSaving] = useState(false);
  const wasPrefilled = useRef(false);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<EditFormValues>({
    resolver: zodResolver(editSchema),
    defaultValues: { full_name: "", email: "", phone: "" },
  });

  // Prefill once the profile loads (or after refreshUser() post-save).
  useEffect(() => {
    if (user && !wasPrefilled.current) {
      wasPrefilled.current = true;
      reset({
        full_name: user.full_name,
        email: user.email ?? "",
        phone: user.phone ?? "",
      });
    }
  }, [user, reset]);

  const onSubmit = async (values: EditFormValues) => {
    setSaving(true);
    try {
      await http.patch("/auth/me/", {
        full_name: values.full_name.trim(),
        email: values.email?.trim() || null,
        phone: values.phone?.trim() ?? "",
      });
      toast.success("Profile updated.");
      await refreshUser();
      reset({
        full_name: values.full_name.trim(),
        email: values.email?.trim() ?? "",
        phone: values.phone?.trim() ?? "",
      });
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  if (!user) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Pencil className="size-5 text-primary" /> Edit Details
        </CardTitle>
        <CardDescription>
          Update your name and contact details. Your roll number, branch and section stay fixed.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-name">Full Name</Label>
            <Input id="edit-name" {...register("full_name")} />
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
          <Button type="submit" disabled={saving || !isDirty} className="w-full">
            {saving && <Loader2 className="size-4 animate-spin" />}
            Save Changes
          </Button>
        </form>
      </CardContent>
    </Card>
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

export default function ProfilePage() {
  const { user, logout } = useAuth();
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
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  if (!user) return null;

  const canContactAdmin = user.is_faculty || user.is_cr;

  return (
    <div>
      <PageHeader title="My Profile" description="Your account details and security settings." />

      {/* ------------------------------------------------ Hero card */}
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="relative mb-6 overflow-hidden rounded-2xl border bg-card shadow-sm"
      >
        <div className="pointer-events-none absolute -top-20 -right-20 size-64 rounded-full bg-gradient-to-br from-indigo-500/20 to-violet-500/20 blur-3xl" />
        <div className="relative flex flex-col gap-6 p-6 sm:flex-row sm:items-center sm:p-8">
          <div className="flex shrink-0 flex-col items-center gap-3 sm:items-start">
            <div className="flex size-24 items-center justify-center rounded-3xl bg-gradient-to-br from-indigo-500 to-violet-600 text-3xl font-bold text-white shadow-lg shadow-indigo-500/30">
              {initials(user.full_name)}
            </div>
          </div>
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
                    {user.branch_name ?? "—"} {user.section_name ? `/ Sec ${user.section_name}` : ""}
                  </p>
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

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <EditDetailsCard />

          {canContactAdmin && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MessageSquareText className="size-5 text-primary" /> Contact Admin
                </CardTitle>
                <CardDescription>
                  Need a subject added, an account fixed or something escalated? Send the admin a
                  message and track the reply here.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Link href="/contact-admin" className="block">
                  <Button variant="outline" className="w-full">
                    <MessageSquareText className="size-4" /> Open Contact Admin
                  </Button>
                </Link>
              </CardContent>
            </Card>
          )}
        </div>

        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.1 }}
          id="password"
          className="space-y-6"
        >
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <KeyRound className="size-5 text-primary" /> Change Password
              </CardTitle>
              <CardDescription>Keep your account secure with a strong password.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="old">Current Password</Label>
                  <Input id="old" type="password" {...register("old_password")} />
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
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <LogOut className="size-5 text-destructive" /> Sign out
              </CardTitle>
              <CardDescription>
                End this session and return to the sign-in page.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                variant="outline"
                className="w-full text-destructive hover:text-destructive"
                onClick={logout}
              >
                <LogOut className="size-4" /> Log out
              </Button>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}
