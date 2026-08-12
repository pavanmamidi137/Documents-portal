"use client";

import { useEffect, useMemo, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2 } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { http } from "@/lib/api";
import { getErrorMessage } from "@/lib/utils";

export interface FieldConfig {
  name: string;
  label: string;
  type: "text" | "number" | "select";
  placeholder?: string;
  optionsSource?: "branches" | "semesters";
  required?: boolean;
}

interface Props<T extends { id: number }> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  apiPath: string;
  singular: string;
  fields: FieldConfig[];
  editing: T | null;
  meta?: { branches?: { id: number; name: string }[]; semesters?: { id: number; name: string }[] };
  /** Defaults applied only when CREATING (editing values always win) - e.g.
   * the currently running semester so it doesn't have to be re-picked. */
  defaults?: Record<string, string>;
  onSaved: () => void;
}

export function ReferenceFormDialog<T extends { id: number }>({ open, onOpenChange, apiPath, singular, fields, editing, meta, defaults: createDefaults, onSaved }: Props<T>) {
  const isEditing = Boolean(editing);

  const schema = useMemo(() => {
    const shape: Record<string, z.ZodTypeAny> = {};
    for (const field of fields) {
      const base =
        field.type === "number"
          ? z.coerce.number().int()
          : z.string();
      shape[field.name] = field.required ? base.min(1, `${field.label} is required`) : base.optional().or(z.literal(""));
    }
    return z.object(shape);
  }, [fields]);

  type FormValues = z.infer<typeof schema>;

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  // Tracks the previous open state so the form is only reset on the open
  // transition - parent re-renders (e.g. a meta refetch) while the dialog is
  // open must never wipe a form the user is mid-way through filling.
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      const initial: Record<string, string> = {};
      const editingRecord = editing as Record<string, unknown> | null;
      for (const field of fields) {
        const value = editingRecord?.[field.name];
        initial[field.name] =
          value !== undefined && value !== null
            ? String(value)
            : (createDefaults?.[field.name] ?? "");
      }
      reset(initial as FormValues);
    }
    wasOpenRef.current = open;
  }, [open, editing, fields, reset, createDefaults]);

  const semesters = meta?.semesters ?? [];

  const onSubmit = async (values: FormValues) => {
    const payload: Record<string, unknown> = {};
    for (const field of fields) {
      const raw = values[field.name];
      if (raw === "" || raw === undefined) continue;
      payload[field.name] = field.type === "number" ? Number(raw) : raw;
    }
    try {
      if (isEditing) {
        await http.patch(`/${apiPath}/${editing!.id}/`, payload);
        toast.success(`${singular} updated.`);
      } else {
        await http.post(`/${apiPath}/`, payload);
        toast.success(`${singular} created.`);
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
          <DialogTitle>{isEditing ? `Edit ${singular}` : `Add ${singular}`}</DialogTitle>
          <DialogDescription>
            {isEditing ? "Update the details below." : "Create a new entry."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {fields.map((field) => (
            <div key={field.name} className="space-y-2">
              <Label>{field.label}</Label>
              {field.type === "select" ? (
                <Select
                  value={watch(field.name) ?? ""}
                  onValueChange={(v) => setValue(field.name, v ?? "")}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={`Select ${field.label.toLowerCase()}`} />
                  </SelectTrigger>
                  <SelectContent>
                    {(field.optionsSource === "semesters" ? semesters : meta?.branches ?? []).map(
                      (option) => (
                        <SelectItem key={option.id} value={String(option.id)}>
                          {option.name}
                        </SelectItem>
                      )
                    )}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  type={field.type === "number" ? "number" : "text"}
                  placeholder={field.placeholder}
                  {...register(field.name)}
                />
              )}
              {errors[field.name] && (
                <p className="text-xs text-destructive">
                  {String(errors[field.name]?.message ?? "")}
                </p>
              )}
            </div>
          ))}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="size-4 animate-spin" />}
              {isEditing ? "Save Changes" : "Create"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
