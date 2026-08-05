"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { GitFork, Loader2, Search, Share2 } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/empty-state";
import { http } from "@/lib/api";
import type { DocumentItem, MetaData, Section } from "@/lib/types";
import { formatDate, getErrorMessage } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Admin: share an existing document to additional sections            */
/* ------------------------------------------------------------------ */
interface ShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  document: DocumentItem | null;
  meta: MetaData;
  onShared: () => void;
}

export function ShareDocumentDialog({ open, onOpenChange, document, meta, onShared }: ShareDialogProps) {
  const [selected, setSelected] = useState<number[]>([]);
  const [sharing, setSharing] = useState(false);

  // Only sections of the same branch, excluding the document's own section.
  const candidates = useMemo(
    () =>
      document
        ? meta.sections.filter((s) => s.branch === document.branch && s.id !== document.section)
        : [],
    [meta.sections, document]
  );

  const toggle = (id: number, checked: boolean) => {
    setSelected((prev) => (checked ? [...prev, id] : prev.filter((x) => x !== id)));
  };

  const submit = async () => {
    if (!document || selected.length === 0) return;
    setSharing(true);
    try {
      const res = await http.post<{ count: number }>(`/documents/${document.id}/share/`, {
        sections: selected,
      });
      toast.success(
        res.count > 0
          ? `Shared with ${res.count} section${res.count === 1 ? "" : "s"}.`
          : "Already shared with the selected sections."
      );
      onShared();
      onOpenChange(false);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSharing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="size-5 text-primary" /> Share Document
          </DialogTitle>
          <DialogDescription>
            Share <span className="font-medium text-foreground">{document?.title}</span> with other
            sections — no re-upload needed, the same file becomes available to them.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label>Share with sections</Label>
          <div className="grid max-h-52 grid-cols-2 gap-1.5 overflow-y-auto rounded-xl border p-3">
            {candidates.map((s) => (
              <label
                key={s.id}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted/50"
              >
                <Checkbox checked={selected.includes(s.id)} onCheckedChange={(v) => toggle(s.id, v === true)} />
                <span className="truncate">
                  {s.branch_name} - Sec {s.name}
                </span>
              </label>
            ))}
            {candidates.length === 0 && (
              <p className="col-span-2 text-xs text-muted-foreground">
                No other sections in this branch to share with.
              </p>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sharing}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={sharing || selected.length === 0}>
            {sharing && <Loader2 className="size-4 animate-spin" />}
            Share with {selected.length > 0 ? `${selected.length} section${selected.length === 1 ? "" : "s"}` : "sections"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* CR: fork a document from another section (no re-upload)             */
/* ------------------------------------------------------------------ */
interface ForkDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onForked: () => void;
}

export function ForkDocumentDialog({ open, onOpenChange, onForked }: ForkDialogProps) {
  const [q, setQ] = useState("");
  const [forkingId, setForkingId] = useState<number | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["forkable-documents", open],
    queryFn: () => http.get<{ results: DocumentItem[] }>("/documents/forkable/", { q: q || undefined }),
    enabled: open,
  });

  const results = useMemo(() => {
    const query = q.trim().toLowerCase();
    const docs = data?.results ?? [];
    if (!query) return docs;
    return docs.filter(
      (d) =>
        d.title.toLowerCase().includes(query) ||
        d.subject_name.toLowerCase().includes(query) ||
        d.section_name.toLowerCase().includes(query) ||
        (d.uploaded_by_name ?? "").toLowerCase().includes(query)
    );
  }, [data, q]);

  const fork = async (doc: DocumentItem) => {
    setForkingId(doc.id);
    try {
      await http.post(`/documents/${doc.id}/fork/`);
      toast.success(`"${doc.title}" forked into your section.`);
      onForked();
      onOpenChange(false);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setForkingId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitFork className="size-5 text-primary" /> Fork Document
          </DialogTitle>
          <DialogDescription>
            Pick a document uploaded in another section to bring a copy into your section — no
            re-uploading needed.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search title, subject, section, uploader…"
            className="h-9 bg-muted/50 pl-9"
          />
        </div>

        <div className="space-y-2">
          {isLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="size-6 animate-spin text-primary" />
            </div>
          ) : results.length === 0 ? (
            <div className="py-6">
              <EmptyState
                icon={GitFork}
                title="Nothing to fork"
                description="No documents from other sections are available right now."
              />
            </div>
          ) : (
            results.map((doc) => (
              <div
                key={doc.id}
                className="flex items-center gap-3 rounded-xl border bg-card p-3 transition-colors hover:border-primary/30"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{doc.title}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {doc.subject_name} · {doc.branch_name} Sec {doc.section_name} ·{" "}
                    {doc.uploaded_by_name ?? "System"} · {formatDate(doc.created_at)}
                  </p>
                </div>
                <Button size="sm" onClick={() => fork(doc)} disabled={forkingId === doc.id}>
                  {forkingId === doc.id ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <GitFork className="size-3.5" />
                  )}
                  Fork
                </Button>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
