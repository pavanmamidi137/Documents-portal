"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { KeyRound, Loader2, Plus, Trash2 } from "lucide-react";
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
import type { AiProvider } from "@/lib/types";
import { getErrorMessage } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider: AiProvider | null;
  onSaved: () => void;
}

export function AiKeysDialog({ open, onOpenChange, provider, onSaved }: Props) {
  const [apiKey, setApiKey] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<number | null>(null);

  // Refetch the provider row on every open/mutation so the key list is always
  // current (the parent's `keysFor` holds a snapshot from the table query).
  const providerQuery = useQuery({
    queryKey: ["ai-provider", provider?.id],
    queryFn: () =>
      http.get<{ id: number; extra_keys: AiProvider["extra_keys"] }>(
        `/admin/ai/providers/${provider?.id}/`
      ),
    enabled: Boolean(provider),
  });

  const keys = providerQuery.data?.extra_keys ?? provider?.extra_keys ?? [];

  const addKey = async () => {
    if (!provider) return;
    const key = apiKey.trim();
    if (!key) {
      toast.error("Paste an API key first.");
      return;
    }
    setBusy(true);
    try {
      await http.post(`/admin/ai/providers/${provider.id}/add_key/`, {
        api_key: key,
        note: note.trim(),
      });
      toast.success("Key added");
      setApiKey("");
      setNote("");
      providerQuery.refetch();
      onSaved();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const removeKey = async (keyId: number) => {
    if (!provider) return;
    setRemoving(keyId);
    try {
      await http.post(`/admin/ai/providers/${provider.id}/remove_key/`, { key_id: keyId });
      toast.success("Key removed");
      providerQuery.refetch();
      onSaved();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setRemoving(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            <span className="inline-flex items-center gap-2">
              <KeyRound className="h-4 w-4" /> {provider?.name} API keys
            </span>
          </DialogTitle>
          <DialogDescription>
            Multiple keys are used for redundancy and backup - never to bypass provider
            quotas. Keys are encrypted and always shown masked.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {keys.length === 0 ? (
            <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
              No extra keys yet. Add one below for redundancy.
            </p>
          ) : (
            <ul className="space-y-2">
              {keys.map((k) => (
                <li
                  key={k.id}
                  className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2"
                >
                  <div className="min-w-0">
                    <code className="font-mono text-sm">{k.masked}</code>
                    {k.note && (
                      <p className="truncate text-xs text-muted-foreground">{k.note}</p>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Remove key"
                    className="shrink-0 text-destructive"
                    disabled={removing === k.id}
                    onClick={() => removeKey(k.id)}
                  >
                    {removing === k.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <div className="space-y-2 rounded-lg border p-3">
            <Label htmlFor="new-key">Add an extra API key</Label>
            <Input
              id="new-key"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-..."
            />
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional note (e.g. project B, backup account)"
              className="text-xs"
            />
            <Button size="sm" onClick={addKey} disabled={busy}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
              Add key
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
