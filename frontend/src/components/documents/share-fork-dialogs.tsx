"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftRight, Check, Inbox, Loader2, Send, Share2, X } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/empty-state";
import { http } from "@/lib/api";
import type { DocumentItem, DocumentShareRequest, MetaData, Paginated } from "@/lib/types";
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
      <DialogContent className="sm:max-w-lg">
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
          <div className="grid max-h-52 grid-cols-1 gap-1.5 overflow-y-auto rounded-xl border p-3 sm:grid-cols-2">
            {candidates.map((s) => (
              <label
                key={s.id}
                className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted/50"
              >
                <Checkbox checked={selected.includes(s.id)} onCheckedChange={(v) => toggle(s.id, v === true)} />
                <span className="min-w-0 truncate">
                  <span className="font-medium">
                    {s.branch_code || s.branch_name} · Sec {s.name}
                  </span>
                  <span className="block text-[11px] text-muted-foreground">
                    {s.students_count} student{s.students_count === 1 ? "" : "s"}
                  </span>
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
/* CR: request sharing a document with other sections (no re-upload)   */
/* ------------------------------------------------------------------ */
interface ShareRequestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  document: DocumentItem | null;
  meta: MetaData;
  onRequested: () => void;
}

export function ShareRequestDialog({ open, onOpenChange, document, meta, onRequested }: ShareRequestDialogProps) {
  const [selected, setSelected] = useState<number[]>([]);
  const [requesting, setRequesting] = useState(false);

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
    setRequesting(true);
    try {
      const res = await http.post<{ count: number }>(`/documents/${document.id}/share_request/`, {
        sections: selected,
      });
      toast.success(
        res.count > 0
          ? `Request sent to ${res.count} section${res.count === 1 ? "" : "s"} — they'll be notified.`
          : "Already requested or shared with the selected sections."
      );
      onRequested();
      onOpenChange(false);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setRequesting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="size-5 text-primary" /> Request Share
          </DialogTitle>
          <DialogDescription>
            Ask the CRs of other sections to accept{" "}
            <span className="font-medium text-foreground">{document?.title}</span>. Once they
            accept, it appears in their section — the file is shared, not re-uploaded.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label>Request with sections</Label>
          <div className="grid max-h-52 grid-cols-1 gap-1.5 overflow-y-auto rounded-xl border p-3 sm:grid-cols-2">
            {candidates.map((s) => (
              <label
                key={s.id}
                className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted/50"
              >
                <Checkbox checked={selected.includes(s.id)} onCheckedChange={(v) => toggle(s.id, v === true)} />
                <span className="min-w-0 truncate">
                  <span className="font-medium">
                    {s.branch_code || s.branch_name} · Sec {s.name}
                  </span>
                  <span className="block text-[11px] text-muted-foreground">
                    {s.students_count} student{s.students_count === 1 ? "" : "s"}
                  </span>
                </span>
              </label>
            ))}
            {candidates.length === 0 && (
              <p className="col-span-2 text-xs text-muted-foreground">
                No other sections in this branch to request with.
              </p>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={requesting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={requesting || selected.length === 0}>
            {requesting && <Loader2 className="size-4 animate-spin" />}
            Send Request{selected.length > 0 ? ` (${selected.length})` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Share requests: incoming (accept/decline) + outgoing (status)       */
/* ------------------------------------------------------------------ */
const STATUS_CLASSES: Record<string, string> = {
  PENDING: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  ACCEPTED: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  DECLINED: "bg-destructive/15 text-destructive",
};

interface ShareRequestsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onResponded: () => void;
}

export function ShareRequestsDialog({ open, onOpenChange, onResponded }: ShareRequestsDialogProps) {
  const queryClient = useQueryClient();
  const [respondingId, setRespondingId] = useState<number | null>(null);
  const [cancellingId, setCancellingId] = useState<number | null>(null);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["share-requests", "incoming"] });
    queryClient.invalidateQueries({ queryKey: ["share-requests", "outgoing"] });
    onResponded();
  };

  const { data: incomingData, isLoading: incomingLoading } = useQuery({
    queryKey: ["share-requests", "incoming"],
    queryFn: () =>
      http.get<Paginated<DocumentShareRequest>>("/document-share-requests/", {
        scope: "incoming",
        status: "PENDING",
      }),
    enabled: open,
  });

  const { data: outgoingData, isLoading: outgoingLoading } = useQuery({
    queryKey: ["share-requests", "outgoing"],
    queryFn: () =>
      http.get<Paginated<DocumentShareRequest>>("/document-share-requests/", {
        scope: "outgoing",
      }),
    enabled: open,
  });

  // Server-side status filter keeps `count` accurate even beyond the first page.
  const pending = incomingData?.results ?? [];
  const pendingCount = incomingData?.count ?? pending.length;
  const outgoing = outgoingData?.results ?? [];

  const respond = async (req: DocumentShareRequest, accept: boolean) => {
    setRespondingId(req.id);
    try {
      await http.post(`/document-share-requests/${req.id}/respond/`, { accept });
      toast.success(
        accept
          ? `"${req.document_title}" is now available in your section.`
          : `Share request for "${req.document_title}" declined.`
      );
      invalidate();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setRespondingId(null);
    }
  };

  const cancelRequest = async (req: DocumentShareRequest) => {
    setCancellingId(req.id);
    try {
      await http.delete(`/document-share-requests/${req.id}/`);
      toast.success(`Share request for "${req.document_title}" cancelled.`);
      invalidate();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setCancellingId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowLeftRight className="size-5 text-primary" /> Share Requests
          </DialogTitle>
          <DialogDescription>
            Accept documents other CRs sent you, or track the status of the requests you sent.
            Accepting adds the document to your section — no re-upload needed.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="incoming">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="incoming">
              Incoming
              {pendingCount > 0 && (
                <span className="ml-1 flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                  {pendingCount > 9 ? "9+" : pendingCount}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="outgoing">Outgoing</TabsTrigger>
          </TabsList>

          <TabsContent value="incoming" className="mt-3">
            <div className="space-y-2">
              {incomingLoading ? (
                <div className="flex justify-center py-10">
                  <Loader2 className="size-6 animate-spin text-primary" />
                </div>
              ) : pending.length === 0 ? (
                <div className="py-6">
                  <EmptyState
                    icon={Inbox}
                    title="No pending requests"
                    description="You're all caught up — new requests will show up here."
                  />
                </div>
              ) : (
                pending.map((req) => (
                  <div
                    key={req.id}
                    className="flex items-start gap-3 rounded-xl border bg-card p-3 transition-colors hover:border-primary/30"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{req.document_title}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {req.subject_name} · {req.from_branch_name} Sec {req.from_section_name}
                      </p>
                      <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Badge variant="outline" className="text-[10px]">
                          {req.category_name}
                        </Badge>
                        <span>
                          by {req.requested_by_name ?? "System"} · {formatDate(req.created_at)}
                        </span>
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => respond(req, false)}
                        disabled={respondingId === req.id}
                      >
                        <X className="size-3.5" /> Decline
                      </Button>
                      <Button size="sm" onClick={() => respond(req, true)} disabled={respondingId === req.id}>
                        {respondingId === req.id ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Check className="size-3.5" />
                        )}
                        Accept
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </TabsContent>

          <TabsContent value="outgoing" className="mt-3">
            <div className="space-y-2">
              {outgoingLoading ? (
                <div className="flex justify-center py-10">
                  <Loader2 className="size-6 animate-spin text-primary" />
                </div>
              ) : outgoing.length === 0 ? (
                <div className="py-6">
                  <EmptyState
                    icon={Send}
                    title="No outgoing requests"
                    description="Requests you send to other sections will show up here with their status."
                  />
                </div>
              ) : (
                outgoing.map((req) => (
                  <div
                    key={req.id}
                    className="flex items-start gap-3 rounded-xl border bg-card p-3 transition-colors hover:border-primary/30"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{req.document_title}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {req.subject_name} · Sent to {req.from_branch_name} Sec {req.to_section_name}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {formatDate(req.created_at)}
                        {req.responded_at && ` · responded ${formatDate(req.responded_at)}`}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <Badge variant="outline" className={STATUS_CLASSES[req.status]}>
                        {req.status_label}
                      </Badge>
                      {req.status === "PENDING" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          onClick={() => cancelRequest(req)}
                          disabled={cancellingId === req.id}
                        >
                          {cancellingId === req.id ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <X className="size-3.5" />
                          )}
                          Cancel
                        </Button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

/** Hook shared by the topbar bell and the documents page badge. */
export function usePendingShareRequests(enabled = true) {
  return useQuery({
    queryKey: ["share-requests", "incoming"],
    queryFn: () =>
      http.get<Paginated<DocumentShareRequest>>("/document-share-requests/", {
        scope: "incoming",
        status: "PENDING",
      }),
    enabled,
    refetchInterval: 60_000,
  });
}
