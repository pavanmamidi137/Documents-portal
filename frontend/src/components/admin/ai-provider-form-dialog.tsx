"use client";

import { useState } from "react";
import { Loader2, PlugZap } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import { http } from "@/lib/api";
import type { AiProvider, AiProviderPayload, AiProviderType } from "@/lib/types";
import { getErrorMessage } from "@/lib/utils";

const PROVIDER_TYPES: { value: AiProviderType; label: string; defaultBase: string }[] = [
  { value: "OPENAI_COMPATIBLE", label: "OpenAI Compatible", defaultBase: "https://api.openai.com/v1" },
  { value: "GEMINI", label: "Google Gemini", defaultBase: "" },
  { value: "NVIDIA", label: "NVIDIA", defaultBase: "https://integrate.api.nvidia.com/v1" },
  { value: "GROQ", label: "Groq", defaultBase: "https://api.groq.com/openai/v1" },
  { value: "CEREBRAS", label: "Cerebras", defaultBase: "https://api.cerebras.ai/v1" },
];

const PURPOSES = [
  { value: "GENERAL", label: "General / All tasks" },
  { value: "DRIVE_EXTRACTION", label: "Drive Extraction" },
  { value: "CHAT", label: "Student Chat" },
  { value: "RESUME", label: "Resume Analysis" },
  { value: "WEB", label: "Web Research" },
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider?: AiProvider | null;
  onSaved: () => void;
}

export function AiProviderFormDialog({ open, onOpenChange, provider, onSaved }: Props) {
  const editing = Boolean(provider);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  // The parent remounts this dialog via a changing `key` when a provider is
  // selected, so the initial state is always fresh - no effect needed.
  const [form, setForm] = useState<AiProviderPayload & { enabled: boolean }>({
    name: provider?.name ?? "",
    provider_type: provider?.provider_type ?? "OPENAI_COMPATIBLE",
    model: provider?.model ?? "",
    base_url: provider?.base_url ?? "https://api.openai.com/v1",
    api_key: "",
    priority: provider?.priority ?? 100,
    enabled: provider?.enabled ?? true,
    timeout_seconds: provider?.timeout_seconds ?? 60,
    max_retries: provider?.max_retries ?? 2,
    purpose: provider?.purpose ?? "GENERAL",
  });

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const onTypeChange = (value: string | null) => {
    const type = PROVIDER_TYPES.find((p) => p.value === value);
    setForm((f) => ({
      ...f,
      provider_type: (value ?? "OPENAI_COMPATIBLE") as AiProviderType,
      // Auto-fill the base URL for the well-known providers.
      base_url: f.base_url?.includes("api.") || f.base_url === "https://api.openai.com/v1"
        ? (type?.defaultBase ?? f.base_url)
        : f.base_url,
    }));
  };

  const save = async () => {
    setSaving(true);
    try {
      if (editing && provider) {
        await http.patch(`/admin/ai/providers/${provider.id}/`, form);
        toast.success("Provider updated");
      } else {
        await http.post("/admin/ai/providers/", form);
        toast.success("Provider added");
      }
      onOpenChange(false);
      onSaved();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const testConnection = async () => {
    if (!provider) {
      toast.error("Save the provider first, then test it.");
      return;
    }
    setTesting(true);
    try {
      const data = await http.post<{ ok: boolean; detail: string }>(
        `/admin/ai/providers/${provider.id}/test/`
      );
      if (data.ok) {
        toast.success("Connection successful - provider is healthy.");
      } else {
        toast.error(data.detail);
      }
      onSaved();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setTesting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${provider?.name}` : "Add AI Provider"}</DialogTitle>
          <DialogDescription>
            API keys are encrypted at rest and shown masked - never in plain text.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="p-name">Provider name</Label>
              <Input
                id="p-name"
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="e.g. Gemini, NVIDIA, Groq"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-type">Provider type</Label>
              <Select value={form.provider_type} onValueChange={onTypeChange}>
                <SelectTrigger id="p-type">
                  <SelectValue placeholder="Type" />
                </SelectTrigger>
                <SelectContent>
                  {PROVIDER_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="p-model">Model name</Label>
              <Input
                id="p-model"
                value={form.model}
                onChange={(e) => set("model", e.target.value)}
                placeholder="e.g. gemini-2.0-flash"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-priority">Priority (lower = first)</Label>
              <Input
                id="p-priority"
                type="number"
                value={form.priority}
                onChange={(e) => set("priority", Number(e.target.value) || 100)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="p-base">API base URL</Label>
            <Input
              id="p-base"
              value={form.base_url}
              onChange={(e) => set("base_url", e.target.value)}
              placeholder="https://api.example.com/v1"
            />
            <p className="text-xs text-muted-foreground">
              Leave empty for Gemini (official API is used automatically).
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="p-key">
              API key {editing && "(leave empty to keep the saved key)"}
            </Label>
            <Input
              id="p-key"
              type="password"
              value={form.api_key}
              onChange={(e) => set("api_key", e.target.value)}
              placeholder={editing ? "••••••••••••" : "sk-..."}
            />
            {editing && provider?.api_key_masked && (
              <p className="text-xs text-muted-foreground">
                Current key: <code className="font-mono">{provider.api_key_masked}</code>
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              When a key hits its rate limit, the portal automatically tries the
              next one. Extra keys can be added here, or set in the server
              environment as comma-separated values (e.g.{" "}
              <code className="font-mono">{form.provider_type === "GEMINI" ? "GEMINI_API_KEY" : "NVIDIA_API_KEY"}=k1,k2,k3</code>{" "}
              or numbered <code className="font-mono">…_2</code>,{" "}
              <code className="font-mono">…_3</code>).
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="p-purpose">Purpose</Label>
            <Select value={form.purpose} onValueChange={(v) => set("purpose", v ?? "GENERAL")}>
              <SelectTrigger id="p-purpose">
                <SelectValue placeholder="Purpose" />
              </SelectTrigger>
              <SelectContent>
                {PURPOSES.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="p-timeout">Timeout (seconds)</Label>
              <Input
                id="p-timeout"
                type="number"
                value={form.timeout_seconds}
                onChange={(e) => set("timeout_seconds", Number(e.target.value) || 60)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-retries">Max retries</Label>
              <Input
                id="p-retries"
                type="number"
                value={form.max_retries}
                onChange={(e) => set("max_retries", Number(e.target.value) || 0)}
              />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border px-3 py-2">
            <div>
              <p className="text-sm font-medium">Enabled</p>
              <p className="text-xs text-muted-foreground">Disabled providers are skipped by the router.</p>
            </div>
            <Switch checked={form.enabled} onCheckedChange={(v) => set("enabled", v)} />
          </div>
        </div>

        <DialogFooter className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          {editing && (
            <Button
              type="button"
              variant="outline"
              onClick={testConnection}
              disabled={testing || saving}
            >
              {testing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlugZap className="mr-2 h-4 w-4" />}
              Test Connection
            </Button>
          )}
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={save} disabled={saving || !form.name || !form.model}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editing ? "Save changes" : "Add provider"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
