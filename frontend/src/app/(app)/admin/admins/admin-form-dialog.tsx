"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowLeftRight, Loader2, ShieldCheck, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { http } from "@/lib/api";
import type { User } from "@/lib/types";
import { getErrorMessage } from "@/lib/utils";

const schema = z.object({
  roll_number: z.string().min(2, "Roll number is required"),
  full_name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  phone: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "add" | "transfer";
  onTransferred?: () => void;
}

export function AdminFormDialog({ open, onOpenChange, mode, onTransferred }: Props) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { roll_number: "", full_name: "", email: "", phone: "" },
  });

  useEffect(() => {
    if (open) reset({ roll_number: "", full_name: "", email: "", phone: "" });
  }, [open, reset]);

  const onSubmit = async (values: FormValues) => {
    const payload = {
      roll_number: values.roll_number.trim().toUpperCase(),
      full_name: values.full_name.trim(),
      email: values.email?.trim() || null,
      phone: values.phone?.trim() ?? "",
    };
    try {
      if (mode === "transfer") {
        const res = await http.post<{ admin: User; transferred_from: string }>(
          "/admins/transfer/",
          payload
        );
        const roll = res.admin.roll_number;
        toast.success(
          `Admin access transferred to ${res.admin.full_name}. Hand them these credentials: roll ${roll}, password ${roll}.`,
          { duration: 8000 }
        );
        onOpenChange(false);
        onTransferred?.();
      } else {
        await http.post("/admins/", payload);
        toast.success(
          `Admin account created for ${values.full_name.trim()}. Default password is their roll number (in capitals).`
        );
        onOpenChange(false);
      }
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {mode === "transfer" ? (
              <ArrowLeftRight className="size-5 text-amber-500" />
            ) : (
              <ShieldCheck className="size-5 text-primary" />
            )}
            {mode === "transfer" ? "Transfer Admin Access" : "Add Admin"}
          </DialogTitle>
          <DialogDescription>
            {mode === "transfer"
              ? "Create the new admin's account. Once transferred, your own admin access ends immediately and you will be signed out."
              : "Create another admin account with full portal access. Default password is the roll number."}
          </DialogDescription>
        </DialogHeader>

        {mode === "transfer" && (
          <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <p>
              This is a handover. After confirming, <span className="font-semibold">you will no longer
              be an admin</span> and the new admin will have full control of the portal. Your own
              account is demoted to a regular student (you can still log in, just without admin
              powers).
            </p>
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="adm-roll">Roll Number</Label>
            <Input
              id="adm-roll"
              placeholder="e.g. ADMIN002"
              autoCapitalize="characters"
              {...register("roll_number")}
            />
            {errors.roll_number && (
              <p className="text-xs text-destructive">{errors.roll_number.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="adm-name">Full Name</Label>
            <Input id="adm-name" placeholder="e.g. Ravi Kumar" {...register("full_name")} />
            {errors.full_name && (
              <p className="text-xs text-destructive">{errors.full_name.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="adm-email">Email</Label>
            <Input id="adm-email" type="email" placeholder="ravi@college.edu" {...register("email")} />
            {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="adm-phone">Phone</Label>
            <Input id="adm-phone" placeholder="10-digit mobile" {...register("phone")} />
          </div>

          <DialogFooter className="gap-2 pt-2">
            <Button variant="outline" type="button" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting} variant={mode === "transfer" ? "destructive" : "default"}>
              {isSubmitting && <Loader2 className="size-4 animate-spin" />}
              {mode === "transfer" ? "Transfer & Sign Out" : "Add Admin"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
