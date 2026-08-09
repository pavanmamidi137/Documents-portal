"use client";

import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { FileSpreadsheet, Loader2, Sparkles } from "lucide-react";
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
import { cn, getErrorMessage } from "@/lib/utils";

const schema = z.object({
  company_name: z.string().min(1, "Company name is required"),
  role: z.string(),
  location: z.string(),
  package: z.string(),
  drive_link: z.string().url("Enter a valid link (e.g. https://...").or(z.literal("")),
  // Optional: a drive without a date stays open until the placement cell closes it.
  last_date_to_apply: z.string().optional(),
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
  const [pasteText, setPasteText] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const {
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: EMPTY });

  // Prefill when editing; clear when opening for a new drive.
  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: clear the paste box each time the dialog opens
    setPasteText("");
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

  /** Paste the WhatsApp forward and let the AI fill the form. */
  const extractWithAi = async () => {
    if (pasteText.trim().length < 10) {
      toast.error("Paste the drive message first (at least a few lines).");
      return;
    }
    setExtracting(true);
    try {
      const data = await http.post<Partial<FormValues>>("/drives/ai_extract/", {
        text: pasteText,
      });
      // Fill only the fields the AI returned with content - never wipe what
      // the user already typed.
      let filled = 0;
      (Object.keys(data) as (keyof FormValues)[]).forEach((key) => {
        const value = data[key];
        if (typeof value === "string" && value.trim()) {
          setValue(key, value, { shouldDirty: true });
          filled += 1;
        }
      });
      toast.success(
        filled > 0
          ? "AI filled the form — review the details and save."
          : "The AI didn't find any details to fill — try a longer paste."
      );
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setExtracting(false);
    }
  };

  /** Upload the college's Excel/CSV and auto-fill roll numbers + eligibility. */
  const uploadFile = async (file: File) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const data = await http.upload<{
        roll_numbers: string;
        count: number;
        eligibility: string;
        detail?: string;
      }>("/drives/parse_eligibility/", form);
      if (!data.roll_numbers) {
        toast.warning(data.detail ?? "No roll numbers found in that file.");
        return;
      }
      if (data.roll_numbers) setValue("eligible_roll_numbers", data.roll_numbers, { shouldDirty: true });
      if (data.eligibility) setValue("eligibility", data.eligibility, { shouldDirty: true });
      toast.success(`Imported ${data.count} roll number${data.count === 1 ? "" : "s"}.`);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const onSubmit = async (values: FormValues) => {
    setSaving(true);
    try {
      const payload = {
        company_name: values.company_name.trim(),
        role: values.role.trim(),
        location: values.location.trim(),
        package: values.package.trim(),
        drive_link: values.drive_link.trim(),
        last_date_to_apply: values.last_date_to_apply || null,
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
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit Drive" : "Post a Drive"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "Update the drive details."
              : "Paste the WhatsApp message and let AI fill it, or type it manually."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* ------------------------------------------------ AI extract */}
          <div className="rounded-xl border border-primary/25 bg-primary/5 p-3">
            <Label className="flex items-center gap-1.5 text-sm font-semibold">
              <Sparkles className="size-4 text-primary" /> Paste &amp; Auto-fill
            </Label>
            <p className="mt-1 text-xs text-muted-foreground">
              Paste the whole WhatsApp/college forward below — AI will fill the form for you to review.
            </p>
            <Textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              rows={3}
              placeholder={'e.g. "TCS is hiring! Software Engineer, Hyderabad, 6-8 LPA. Last date: 15 Aug. Eligibility: B.Tech CSE, 60% aggregate. Apply: https://…"'}
              className="mt-2 bg-background"
            />
            <Button
              type="button"
              size="sm"
              className="mt-2"
              onClick={extractWithAi}
              disabled={extracting}
            >
              {extracting ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              {extracting ? "Extracting…" : "Extract with AI"}
            </Button>
          </div>

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
              <Label htmlFor="last_date">Last Date to Apply (optional)</Label>
              <Input id="last_date" type="date" {...register("last_date_to_apply")} />
              <p className="text-xs text-muted-foreground">
                Leave blank if no deadline was shared — the drive stays open until you close it.
              </p>
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

          {/* ------------------------------------------------ Roll numbers */}
          <div className="space-y-2">
            <Label htmlFor="rolls">Eligible Roll Numbers (optional)</Label>
            <Textarea
              id="rolls"
              rows={2}
              placeholder="Or upload the college's Excel/CSV sheet →"
              {...register("eligible_roll_numbers")}
            />
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) uploadFile(file);
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className={cn("gap-2", uploading && "opacity-70")}
            >
              {uploading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <FileSpreadsheet className="size-4 text-primary" />
              )}
              {uploading ? "Reading sheet…" : "Upload Excel / CSV"}
            </Button>
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
