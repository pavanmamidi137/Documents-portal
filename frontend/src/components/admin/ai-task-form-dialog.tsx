"use client";

import { useState } from "react";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { http } from "@/lib/api";
import type { AiProvider, AiTaskConfig } from "@/lib/types";
import { getErrorMessage } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: AiTaskConfig | null;
  providers: AiProvider[];
  onSaved: () => void;
}

const SLOTS = [
  { key: "primary", label: "Primary provider", hint: "Tried first for this task" },
  { key: "fallback_1", label: "Fallback 1", hint: "Used if the primary fails" },
  { key: "fallback_2", label: "Fallback 2", hint: "Used if fallback 1 fails" },
  { key: "fallback_3", label: "Fallback 3", hint: "Used if fallback 2 fails" },
] as const;

export function AiTaskFormDialog({ open, onOpenChange, task, providers, onSaved }: Props) {
  const [saving, setSaving] = useState(false);
  const [chain, setChain] = useState<Record<string, string>>(() => ({
    primary: task?.primary ? String(task.primary) : "",
    fallback_1: task?.fallback_1 ? String(task.fallback_1) : "",
    fallback_2: task?.fallback_2 ? String(task.fallback_2) : "",
    fallback_3: task?.fallback_3 ? String(task.fallback_3) : "",
  }));

  const enabledProviders = providers.filter((p) => p.enabled);
  const optionList = enabledProviders.length > 0 ? enabledProviders : providers;

  const save = async () => {
    if (!task) return;
    setSaving(true);
    const payload: Record<string, number | null> = {};
    for (const slot of SLOTS) {
      const value = chain[slot.key];
      payload[slot.key] = value ? Number(value) : null;
    }
    try {
      await http.patch(`/admin/ai/tasks/${task.id}/`, payload);
      toast.success("Task routing updated");
      onOpenChange(false);
      onSaved();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{task?.task_label ?? "Task"} routing</DialogTitle>
          <DialogDescription>
            Choose the provider chain for this task. Leave a slot empty for any enabled
            provider by priority.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          {SLOTS.map((slot) => (
            <div key={slot.key} className="space-y-1.5">
              <Label htmlFor={`task-${slot.key}`}>{slot.label}</Label>
              <Select
                value={chain[slot.key]}
                onValueChange={(v) => setChain((c) => ({ ...c, [slot.key]: v ?? "" }))}
              >
                <SelectTrigger id={`task-${slot.key}`}>
                  <SelectValue placeholder={slot.hint} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Any provider (by priority)</SelectItem>
                  {optionList.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.name} · {p.model}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save routing
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
