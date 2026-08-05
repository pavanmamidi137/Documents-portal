"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, Megaphone } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { http } from "@/lib/api";
import type { Announcement, MetaData } from "@/lib/types";
import { getErrorMessage } from "@/lib/utils";

const VISIBILITIES = [
  { value: "COLLEGE", label: "Entire College" },
  { value: "BRANCH", label: "Branch Only" },
  { value: "SECTION", label: "Section Only" },
  { value: "CR_ONLY", label: "CR Only" },
  { value: "STUDENT_ONLY", label: "Student Only" },
];

const schema = z.object({
  title: z.string().min(3, "Title must be at least 3 characters"),
  body: z.string().min(5, "Message is too short"),
  visibility: z.string().min(1),
  branch: z.string().optional(),
  section: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  announcement?: Announcement | null;
  meta: MetaData;
  onSaved: () => void;
}

export function AnnouncementFormDialog({ open, onOpenChange, announcement, meta, onSaved }: Props) {
  const editing = Boolean(announcement);
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const visibility = watch("visibility");

  useEffect(() => {
    if (open) {
      reset({
        title: announcement?.title ?? "",
        body: announcement?.body ?? "",
        visibility: announcement?.visibility ?? "COLLEGE",
        branch: announcement?.branch ? String(announcement.branch) : "",
        section: announcement?.section ? String(announcement.section) : "",
      });
    }
  }, [open, announcement, reset]);

  const onSubmit = async (values: FormValues) => {
    const payload = {
      title: values.title,
      body: values.body,
      visibility: values.visibility,
      branch: values.branch ? Number(values.branch) : null,
      section: values.section ? Number(values.section) : null,
    };
    try {
      if (editing) {
        await http.patch(`/announcements/${announcement!.id}/`, payload);
        toast.success("Announcement updated.");
      } else {
        await http.post("/announcements/", payload);
        toast.success("Announcement published.");
      }
      onSaved();
      onOpenChange(false);
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Megaphone className="size-5 text-primary" />
            {editing ? "Edit Announcement" : "New Announcement"}
          </DialogTitle>
          <DialogDescription>
            Choose who should see this announcement.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label>Title</Label>
            <Input placeholder="e.g. Mid-1 Exams start next week" {...register("title")} />
            {errors.title && <p className="text-xs text-destructive">{errors.title.message}</p>}
          </div>

          <div className="space-y-2">
            <Label>Message</Label>
            <Textarea rows={4} placeholder="Write the announcement…" {...register("body")} />
            {errors.body && <p className="text-xs text-destructive">{errors.body.message}</p>}
          </div>

          <div className="space-y-2">
            <Label>Visibility</Label>
            <Select value={visibility} onValueChange={(v) => setValue("visibility", v ?? "")}>
              <SelectTrigger>
                <SelectValue placeholder="Select audience" />
              </SelectTrigger>
              <SelectContent>
                {VISIBILITIES.map((v) => (
                  <SelectItem key={v.value} value={v.value}>
                    {v.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {visibility === "BRANCH" && (
            <div className="space-y-2">
              <Label>Branch</Label>
              <Select value={watch("branch")} onValueChange={(v) => setValue("branch", v ?? "")}>
                <SelectTrigger>
                  <SelectValue placeholder="Select branch" />
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
          )}

          {visibility === "SECTION" && (
            <div className="space-y-2">
              <Label>Section</Label>
              <Select value={watch("section")} onValueChange={(v) => setValue("section", v ?? "")}>
                <SelectTrigger>
                  <SelectValue placeholder="Select section" />
                </SelectTrigger>
                <SelectContent>
                  {meta.sections.map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      {s.branch_name} - {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="size-4 animate-spin" />}
              {editing ? "Save Changes" : "Publish"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
