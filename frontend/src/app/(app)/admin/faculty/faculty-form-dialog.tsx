"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { GraduationCap, Loader2 } from "lucide-react";
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
  full_name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  phone: z.string().optional(),
  branch: z.string().min(1, "Assign a branch"),
});

type FormValues = z.infer<typeof schema>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  faculty: User | null;
  meta: MetaData | undefined;
  onSaved: () => void;
}

export function FacultyFormDialog({ open, onOpenChange, faculty, meta, onSaved }: Props) {
  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { roll_number: "", full_name: "", email: "", phone: "", branch: "" },
  });

  useEffect(() => {
    if (open) {
      reset({
        roll_number: faculty?.roll_number ?? "",
        full_name: faculty?.full_name ?? "",
        email: faculty?.email ?? "",
        phone: faculty?.phone ?? "",
        branch: faculty?.branch ? String(faculty.branch) : "",
      });
    }
  }, [open, faculty, reset]);

  const onSubmit = async (values: FormValues) => {
    try {
      if (faculty) {
        await http.patch(`/faculty/${faculty.id}/`, {
          full_name: values.full_name.trim(),
          email: values.email?.trim() || null,
          phone: values.phone?.trim() ?? "",
          branch: Number(values.branch),
        });
        toast.success("Faculty member updated.");
      } else {
        await http.post("/faculty/", {
          roll_number: values.roll_number.trim().toUpperCase(),
          full_name: values.full_name.trim(),
          email: values.email?.trim() || null,
          phone: values.phone?.trim() ?? "",
          branch: Number(values.branch),
        });
        toast.success("Faculty member added. Default password is their roll number (in capitals).");
      }
      onSaved();
      onOpenChange(false);
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GraduationCap className="size-5 text-primary" />
            {faculty ? "Edit Faculty" : "Add Faculty"}
          </DialogTitle>
          <DialogDescription>
            {faculty
              ? "Update the faculty member's details."
              : "Create a faculty account. They can review student resumes in their branch. Default password is the roll number."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="fac-roll">Roll Number</Label>
            <Input
              id="fac-roll"
              placeholder="e.g. FAC001"
              disabled={!!faculty}
              {...register("roll_number")}
            />
            {errors.roll_number && (
              <p className="text-xs text-destructive">{errors.roll_number.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="fac-name">Full Name</Label>
            <Input id="fac-name" placeholder="e.g. Prof. Rama Rao" {...register("full_name")} />
            {errors.full_name && (
              <p className="text-xs text-destructive">{errors.full_name.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="fac-email">Email</Label>
            <Input id="fac-email" type="email" placeholder="rao@college.edu" {...register("email")} />
            {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="fac-phone">Phone</Label>
            <Input id="fac-phone" placeholder="10-digit mobile" {...register("phone")} />
          </div>

          <div className="space-y-2">
            <Label>Branch</Label>
            <Select
              value={watch("branch")}
              onValueChange={(v) => setValue("branch", v ?? "", { shouldValidate: true })}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select branch" />
              </SelectTrigger>
              <SelectContent>
                {(meta?.branches ?? []).map((b) => (
                  <SelectItem key={b.id} value={String(b.id)}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.branch && <p className="text-xs text-destructive">{errors.branch.message}</p>}
          </div>

          <DialogFooter className="gap-2 pt-2">
            <Button variant="outline" type="button" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="size-4 animate-spin" />}
              {faculty ? "Save Changes" : "Add Faculty"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
