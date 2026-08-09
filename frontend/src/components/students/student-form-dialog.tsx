"use client";

import { useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { http } from "@/lib/api";
import type { MetaData, User } from "@/lib/types";
import { getErrorMessage } from "@/lib/utils";

const schema = z.object({
  roll_number: z.string().min(2, "Roll number is required"),
  full_name: z.string().min(2, "Student name is required"),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  phone: z.string().optional(),
  gender: z.string().optional(),
  passout_year: z.string().optional(),
  branch: z.string().optional(),
  section: z.string().optional(),
  is_active: z.boolean(),
});

type FormValues = z.infer<typeof schema>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  student?: User | null;
  meta: MetaData;
  isCr?: boolean;
  onSaved: () => void;
}

export function StudentFormDialog({ open, onOpenChange, student, meta, isCr = false, onSaved }: Props) {
  const editing = Boolean(student);

  const {
    register,
    handleSubmit,
    watch,
    getValues,
    setValue,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { is_active: true },
  });

  const selectedBranch = watch("branch");
  const roll = watch("roll_number");

  // watch() inside useMemo keeps the derived list in sync without unstable deps.
  const sections = useMemo(
    () => {
      const branch = watch("branch");
      return meta.sections.filter((s) => !branch || s.branch === Number(branch));
    },
    [meta.sections, watch]
  );

  useEffect(() => {
    if (open) {
      reset({
        roll_number: student?.roll_number ?? "",
        full_name: student?.full_name ?? "",
        email: student?.email ?? "",
        phone: student?.phone ?? "",
        gender: student?.gender ?? "",
        passout_year: student?.passout_year ? String(student.passout_year) : "",
        branch: student?.branch ? String(student.branch) : "",
        section: student?.section ? String(student.section) : "",
        is_active: student?.is_active ?? true,
      });
    }
  }, [open, student, reset]);

  // When creating a student, guess the pass-out year from the roll number's
  // leading two digits (21CSE01 -> 2025) and prefill it - the admin can still
  // override it. Guard for the first render: `watch` is still undefined until
  // the reset effect populates the form, so trimming it would crash the dialog.
  useEffect(() => {
    if (editing || !open) return;
    const m = (roll ?? "").trim().match(/^(\d{2})/);
    if (m) {
      const year = 2000 + Number(m[1]) + 4;
      if (year >= 1990 && year <= 2100 && !getValues("passout_year")) {
        setValue("passout_year", String(year));
      }
    }
  }, [roll, editing, open, setValue, getValues]);



  const onSubmit = async (values: FormValues) => {
    try {
      const passoutYear = values.passout_year ? Number(values.passout_year) : null;
      if (editing) {
        await http.patch(`/students/${student!.id}/`, {
          full_name: values.full_name,
          email: values.email || null,
          phone: values.phone ?? "",
          gender: values.gender || "",
          passout_year: passoutYear,
          branch: values.branch ? Number(values.branch) : null,
          section: values.section ? Number(values.section) : null,
          is_active: values.is_active,
        });
        toast.success("Student updated.");
      } else {
        await http.post("/students/", {
          roll_number: values.roll_number.trim(),
          full_name: values.full_name.trim(),
          email: values.email || null,
          phone: values.phone ?? "",
          gender: values.gender || "",
          passout_year: passoutYear,
          branch: values.branch ? Number(values.branch) : null,
          section: values.section ? Number(values.section) : null,
        });
        toast.success("Student added.");
      }
      onSaved();
      onOpenChange(false);
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="size-5 text-primary" />
            {editing ? "Edit Student" : "Add Student"}
          </DialogTitle>
          <DialogDescription>
            {isCr && !editing && "Students will be added to your assigned section."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Roll Number</Label>
              <Input
                placeholder="e.g. 21CSE07"
                disabled={editing}
                {...register("roll_number")}
              />
              {errors.roll_number && (
                <p className="text-xs text-destructive">{errors.roll_number.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label>Full Name</Label>
              <Input placeholder="Student name" {...register("full_name")} />
              {errors.full_name && (
                <p className="text-xs text-destructive">{errors.full_name.message}</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Email</Label>
              <Input type="email" placeholder="student@college.edu" {...register("email")} />
              {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
            </div>
            <div className="space-y-2">
              <Label>Phone</Label>
              <Input placeholder="10-digit mobile" {...register("phone")} />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Gender (optional)</Label>
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

          <div className="space-y-2">
            <Label>Passout Year (Batch)</Label>
            <Input
              type="number"
              min={1990}
              max={2100}
              placeholder={editing ? "e.g. 2025" : "Auto-filled from roll number"}
              {...register("passout_year")}
            />
            <p className="text-xs text-muted-foreground">
              Which batch this student passes out in. Leave blank to auto-guess from the roll number.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Branch</Label>
              <Select
                value={selectedBranch}
                onValueChange={(v) => {
                  setValue("branch", v ?? "");
                  setValue("section", "");
                }}
                disabled={isCr}
              >
                <SelectTrigger>
                  <SelectValue placeholder={isCr ? "Your branch" : "Select branch"} />
                </SelectTrigger>
                <SelectContent>
                  {meta.branches.map((b) => (
                    <SelectItem key={b.id} value={String(b.id)}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Section</Label>
              <Select
                value={watch("section")}
                onValueChange={(v) => setValue("section", v ?? "")}
                disabled={isCr || sections.length === 0}
              >
                <SelectTrigger>
                  <SelectValue placeholder={isCr ? "Your section" : "Select section"} />
                </SelectTrigger>
                <SelectContent>
                  {sections.map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {!editing && (
            <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">No password needed</p>
              <p className="mt-0.5">
                The student&apos;s default password is their <span className="font-semibold">Roll Number</span>{" "}
                (in capitals). They can change it after their first login.
              </p>
            </div>
          )}

          {editing && (
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">Active account</p>
                <p className="text-xs text-muted-foreground">
                  Deactivated students cannot sign in.
                </p>
              </div>
              <Switch
                checked={watch("is_active")}
                onCheckedChange={(v) => setValue("is_active", v)}
              />
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="size-4 animate-spin" />}
              {editing ? "Save Changes" : "Add Student"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
