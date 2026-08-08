"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { http } from "@/lib/api";
import type { Drive } from "@/lib/types";
import { getErrorMessage } from "@/lib/utils";

const schema = z.object({
  company_name: z.string().min(1, "Company name is required"),
  role: z.string(),
  location: z.string(),
  package: z.string(),
  drive_link: z.string().url("Enter a valid link (e.g. https://...").or(z.literal("")),
  last_date_to_apply: z.string().min(1, "Last date to apply is required"),
  description: z.string(),
  eligibility: z.string(),
  eligible_roll_numbers: z.string(),
});

type FormValues = z.infer<typeof schema>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing?: Drive | null;
}

const EMPTY: FormValues = {
  company_name: "",
  role: "",
  location: "",
  package: "",
  drive_link: "",
  last_date_to_apply: "",
  description: "",
  eligibility: "",
  eligible_roll_numbers: "",
};

export function DriveFormDialog({ open, onOpenChange, editing }: Props) {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: EMPTY });

  // Prefill when editing; clear when opening for a new drive.
  useEffect(() => {
    if (!open) return;
    reset(
      editing
        ? {
            company_name: editing.company_name,
            role: editing.role,
            location: editing.location,
            package: editing.package,
            drive_link: editing.drive_link,
            last_date_to_apply: editing.last_date_to_apply,
            description: editing.description,
            eligibility: editing.eligibility,
            eligible_roll_numbers: editing.eligible_roll_numbers,
          }
        : EMPTY
    );
  }, [open, editing, reset]);

  const onSubmit = async (values: FormValues) => {
    setSaving(true);
    try {
      const payload = {
        company_name: values.company_name.trim(),
        role: values.role.trim(),
        location: values.location.trim(),
        package: values.package.trim(),
        drive_link: values.drive_link.trim(),
        last_date_to_apply: values.last_date_to_apply,
        description: values.description.trim(),
        eligibility: values.eligibility.trim(),
        eligible_roll_numbers: values.eligible_roll_numbers.trim(),
      };
      if (editing) {
        await http.patch(`/drives/${editing.id}/`, payload);
        toast.success("Drive updated.");
      } else {
        await http.post("/drives/", payload);
        toast.success("Drive posted — students have been notified.");
      }
      queryClient.invalidateQueries({ queryKey: ["drives"] });
      onOpenChange(false);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit Drive" : "Post a Drive"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "Update the drive details."
              : "Add a placement/company drive. Students are notified instantly and it stays open until the last date to apply."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="company">Company Name *</Label>
            <Input id="company" placeholder="e.g. TCS, Infosys, Wipro" {...register("company_name")} />
            {errors.company_name && (
              <p className="text-xs text-destructive">{errors.company_name.message}</p>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="role">Role / Designation</Label>
              <Input id="role" placeholder="e.g. Software Engineer" {...register("role")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="location">Location</Label>
              <Input id="location" placeholder="e.g. Hyderabad" {...register("location")} />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="package">Package / CTC</Label>
              <Input id="package" placeholder="e.g. 6 LPA" {...register("package")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="last_date">Last Date to Apply *</Label>
              <Input id="last_date" type="date" {...register("last_date_to_apply")} />
              {errors.last_date_to_apply && (
                <p className="text-xs text-destructive">{errors.last_date_to_apply.message}</p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="link">Apply Link</Label>
            <Input
              id="link"
              type="url"
              placeholder="https://apply.company.com/job"
              {...register("drive_link")}
            />
            {errors.drive_link && (
              <p className="text-xs text-destructive">{errors.drive_link.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Drive Details</Label>
            <Textarea
              id="description"
              rows={2}
              placeholder="About the company, selection process, interview rounds…"
              {...register("description")}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="eligibility">Eligibility Criteria</Label>
            <Textarea
              id="eligibility"
              rows={2}
              placeholder="e.g. B.Tech CSE/IT, 60% aggregate, 2024-26 batch"
              {...register("eligibility")}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="rolls">Eligible Roll Numbers (optional)</Label>
            <Textarea
              id="rolls"
              rows={2}
              placeholder="Paste the roll numbers from the college's Excel sheet, separated by commas or new lines. Students in the list get an 'Eligible for you' tag."
              {...register("eligible_roll_numbers")}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="size-4 animate-spin" />}
              {editing ? "Save Changes" : "Post Drive"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
