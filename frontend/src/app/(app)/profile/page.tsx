"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { motion } from "framer-motion";
import { KeyRound, Loader2, Mail, Phone, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/layout/page-header";
import { useAuth } from "@/lib/auth";
import { http } from "@/lib/api";
import { formatDate, getErrorMessage, initials, roleColor } from "@/lib/utils";

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

export default function ProfilePage() {
  const { user } = useAuth();
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

  return (
    <div>
      <PageHeader title="My Profile" description="Your account details and security settings." />

      <div className="grid gap-6 lg:grid-cols-2">
        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
          <Card>
            <CardHeader>
              <CardTitle>Account Information</CardTitle>
              <CardDescription>Details associated with your account.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="flex items-center gap-4">
                <div className="flex size-16 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-xl font-bold text-white shadow-lg">
                  {initials(user.full_name)}
                </div>
                <div>
                  <p className="text-lg font-bold">{user.full_name}</p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    <Badge variant="outline" className={roleColor(user.role)}>
                      {user.role_label}
                    </Badge>
                    <Badge variant={user.is_active ? "default" : "outline"}>
                      {user.is_active ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border bg-muted/30 p-3">
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <ShieldCheck className="size-3.5" /> Roll Number
                  </p>
                  <p className="mt-1 font-mono text-sm font-medium">{user.roll_number}</p>
                </div>
                <div className="rounded-xl border bg-muted/30 p-3">
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Mail className="size-3.5" /> Email
                  </p>
                  <p className="mt-1 text-sm font-medium">{user.email ?? "—"}</p>
                </div>
                <div className="rounded-xl border bg-muted/30 p-3">
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Phone className="size-3.5" /> Phone
                  </p>
                  <p className="mt-1 text-sm font-medium">{user.phone || "—"}</p>
                </div>
                <div className="rounded-xl border bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground">Branch / Section</p>
                  <p className="mt-1 text-sm font-medium">
                    {user.branch_name ?? "—"} {user.section_name ? `/ Sec ${user.section_name}` : ""}
                  </p>
                </div>
              </div>

              <p className="text-xs text-muted-foreground">Joined {formatDate(user.date_joined)}</p>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.1 }}
          id="password"
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
        </motion.div>
      </div>
    </div>
  );
}
