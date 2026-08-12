"use client";

import { useMemo, useState } from "react";
import { CheckSquare2, Copy, Loader2, ListPlus, Square } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import type { MetaData } from "@/lib/types";
import { getErrorMessage } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  meta: MetaData;
  onImported: () => void;
}

export function BulkSubjectImportDialog({ open, onOpenChange, meta, onImported }: Props) {
  // Pre-select the currently running semester (guessed from the date) - the
  // dialog is remounted per open, so this runs fresh every time.
  const [semester, setSemester] = useState(
    meta.current_semester ? String(meta.current_semester.id) : ""
  );
  const [branch, setBranch] = useState("");
  const [names, setNames] = useState("");
  const [copyIds, setCopyIds] = useState<Set<number>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  // All subjects that could be copied, grouped by semester, excluding ones
  // that already exist in the target semester (avoid pointless duplicates).
  const copyable = useMemo(() => {
    if (!semester) return [];
    const targetSemester = Number(semester);
    const existingNames = new Set(
      meta.subjects
        .filter((s) => s.semester === targetSemester)
        .map((s) => s.name.toLowerCase())
    );
    return meta.subjects
      .filter((s) => s.semester !== targetSemester && !existingNames.has(s.name.toLowerCase()))
      .sort((a, b) => a.semester_name.localeCompare(b.semester_name) || a.name.localeCompare(b.name));
  }, [meta.subjects, semester]);

  const grouped = useMemo(() => {
    const map = new Map<string, typeof copyable>();
    for (const s of copyable) {
      const list = map.get(s.semester_name) ?? [];
      list.push(s);
      map.set(s.semester_name, list);
    }
    return [...map.entries()];
  }, [copyable]);

  const toggleAll = (checked: boolean) => {
    setCopyIds(new Set(checked ? copyable.map((s) => s.id) : []));
  };

  const toggle = (id: number, checked: boolean) => {
    setCopyIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const parsedLines = useMemo(() => {
    return names
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  }, [names]);

  const onSubmit = async () => {
    if (!semester) {
      toast.error("Select the semester to import into.");
      return;
    }
    if (parsedLines.length === 0 && copyIds.size === 0) {
      toast.error("Type at least one subject or select existing ones to copy.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await http.post<{ created: number; skipped: { name: string; reason: string }[] }>(
        "/subjects/bulk_import/",
        {
          semester: Number(semester),
          branch: branch ? Number(branch) : undefined,
          names: parsedLines,
          copy_ids: [...copyIds],
        }
      );
      const skippedNote =
        res.skipped.length > 0 ? ` (${res.skipped.length} skipped — already exist)` : "";
      toast.success(
        `${res.created} subject${res.created === 1 ? "" : "s"} added to the semester.${skippedNote}`
      );
      onImported();
      onOpenChange(false);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ListPlus className="size-5 text-primary" /> Bulk Import Subjects
          </DialogTitle>
          <DialogDescription>
            Add all of a semester&apos;s subjects at once — type them or copy them from another
            semester. No more typing one subject at a time.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Import into Semester</Label>
              <Select value={semester} onValueChange={(v) => setSemester(v ?? "")}>
                <SelectTrigger>
                  <SelectValue placeholder="Select semester" />
                </SelectTrigger>
                <SelectContent>
                  {meta.semesters.map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Branch (optional)</Label>
              <Select value={branch} onValueChange={(v) => setBranch(v ?? "")}>
                <SelectTrigger>
                  <SelectValue placeholder="All branches (college-wide)" />
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
          </div>

          <div className="space-y-2">
            <Label>Type subjects — one per line</Label>
            <Textarea
              rows={5}
              placeholder={"Operating Systems\nComputer Networks, CS402\nDBMS"}
              value={names}
              onChange={(e) => setNames(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Optionally add a code after a comma, e.g. <span className="font-mono">DBMS, CS303</span>.
              {parsedLines.length > 0 && (
                <span className="ml-1 font-medium text-foreground">
                  {parsedLines.length} line{parsedLines.length === 1 ? "" : "s"} ready.
                </span>
              )}
            </p>
          </div>

          {semester && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-1.5 text-sm">
                  <Copy className="size-3.5 text-muted-foreground" /> Copy from other semesters
                </Label>
                <div className="flex gap-3 text-xs">
                  <button
                    type="button"
                    className="font-medium text-primary hover:underline"
                    onClick={() => toggleAll(true)}
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    className="font-medium text-muted-foreground hover:underline"
                    onClick={() => toggleAll(false)}
                  >
                    Clear
                  </button>
                </div>
              </div>
              {copyable.length === 0 ? (
                <p className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
                  {meta.subjects.some((s) => s.semester === Number(semester))
                    ? "This semester already has every subject from the list."
                    : "No subjects exist yet — type them above."}
                </p>
              ) : (
                <div className="max-h-48 space-y-2 overflow-y-auto rounded-xl border p-3">
                  {grouped.map(([semesterName, subjects]) => (
                    <div key={semesterName}>
                      <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                        <Square className="size-3" /> {semesterName}
                      </p>
                      <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                        {subjects.map((s) => (
                          <label
                            key={s.id}
                            className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm transition-colors hover:bg-muted/50"
                          >
                            <Checkbox
                              checked={copyIds.has(s.id)}
                              onCheckedChange={(v) => toggle(s.id, v === true)}
                            />
                            <span className="truncate">{s.name}</span>
                            {s.code && (
                              <Badge variant="outline" className="ml-auto shrink-0 text-[10px]">
                                {s.code}
                              </Badge>
                            )}
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {copyIds.size > 0 && (
                <p className="flex items-center gap-1.5 text-xs font-medium text-primary">
                  <CheckSquare2 className="size-3.5" /> {copyIds.size} subject
                  {copyIds.size === 1 ? "" : "s"} will be copied
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={onSubmit} disabled={submitting}>
            {submitting && <Loader2 className="size-4 animate-spin" />}
            {submitting ? "Importing…" : "Import Subjects"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
