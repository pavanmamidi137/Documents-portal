"use client";

import { useMemo, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  BookOpen,
  Download,
  Layers,
  ListChecks,
  Loader2,
  Search,
  Tag,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { http } from "@/lib/api";
import { useCloudinaryCheck } from "@/lib/use-cloudinary-check";
import type { Category, DocumentItem, MetaData, Semester, Subject } from "@/lib/types";
import { DocumentCard } from "./document-card";
import { EmptyState } from "@/components/empty-state";
import { getErrorMessage } from "@/lib/utils";

type Step =
  | { level: "semester" }
  | { level: "category"; semester: Semester }
  | { level: "subjects"; semester: Semester; category: Category }
  | { level: "subject"; semester: Semester; category: Category; subject: Subject };

export function StudentBrowser({ meta }: { meta: MetaData }) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>({ level: "semester" });
  const [search, setSearch] = useState("");
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [downloading, setDownloading] = useState(false);

  // Leaving a view clears the selection mode.
  const goTo = (next: Step) => {
    setSelectedIds(new Set());
    setSelecting(false);
    setStep(next);
  };

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
    setSelecting(false);
  };

  // Tries a blob download first (no popup), falls back to opening the tab.
  const downloadOne = async (doc: DocumentItem): Promise<boolean> => {
    try {
      const res = await http.post<{ download_url: string }>(`/documents/${doc.id}/download/`);
      try {
        const blobRes = await fetch(res.download_url);
        if (!blobRes.ok) throw new Error("Download failed");
        const blob = await blobRes.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = doc.file_name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } catch {
        window.open(res.download_url, "_blank", "noopener");
      }
      return true;
    } catch {
      return false;
    }
  };

  const downloadSelected = async (docs: DocumentItem[]) => {
    // Only the checked documents are downloaded, not the whole visible list.
    const targets = docs.filter((d) => selectedIds.has(d.id));
    if (targets.length === 0) return;
    setDownloading(true);
    let ok = 0;
    const failed: string[] = [];
    try {
      for (const doc of targets) {
        if (await downloadOne(doc)) ok += 1;
        else failed.push(doc.title);
      }
      if (ok > 0) toast.success(`${ok} document${ok === 1 ? "" : "s"} downloaded.`);
      if (failed.length > 0)
        toast.error(
          `Couldn't download ${failed.length}: ${failed.slice(0, 3).join(", ")}${failed.length > 3 ? "…" : ""}`
        );
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setDownloading(false);
      clearSelection();
    }
  };

  const selectionToolbar = (docs: DocumentItem[]) => {
    if (docs.length === 0) return null;
    return selecting ? (
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 p-2.5">
        <p className="px-1 text-sm font-medium">
          <span className="text-foreground">{selectedIds.size}</span> selected
        </p>
        <div className="ml-auto flex items-center gap-1.5">
          <Button size="sm" variant="ghost" onClick={clearSelection} disabled={downloading}>
            <X className="size-3.5" /> Clear
          </Button>
          <Button
            size="sm"
            onClick={() => downloadSelected(docs)}
            disabled={downloading || selectedIds.size === 0}
          >
            {downloading ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
            {downloading ? "Downloading…" : "Download Selected"}
          </Button>
        </div>
      </div>
    ) : (
      <div className="flex justify-end">
        <Button size="sm" variant="outline" onClick={() => setSelecting(true)}>
          <ListChecks className="size-3.5" /> Select
        </Button>
      </div>
    );
  };

  const listQueryKey = [
    "student-documents",
    "semester" in step ? step.semester.id : undefined,
    "category" in step ? step.category.id : undefined,
    "subject" in step ? step.subject.id : undefined,
  ] as const;

  // Files deleted directly in Cloudinary are removed from this view instantly.
  useCloudinaryCheck<DocumentItem>({
    url: "/documents/check-files/",
    params: {
      ...("semester" in step ? { semester: step.semester.id } : {}),
      ...("category" in step ? { category: step.category.id } : {}),
      ...("subject" in step ? { subject: step.subject.id } : {}),
    },
    queryKey: listQueryKey,
    kind: "document",
  });

  const { data, isLoading } = useQuery({
    queryKey: listQueryKey,
    queryFn: async () => {
      const params: Record<string, unknown> = {};
      if ("semester" in step) params.semester = step.semester.id;
      if ("category" in step) params.category = step.category.id;
      if ("subject" in step) params.subject = step.subject.id;
      return http.get<{ results: DocumentItem[] }>("/documents/", { ...params, page_size: 100 });
    },
    // Browsing semester → category → subject keeps the previous grid visible
    // while the next level loads, so navigation feels instant.
    placeholderData: keepPreviousData,
  });

  // Warm the cache for a deeper level before the user clicks through to it.
  // Uses the exact same query key + params as the useQuery above, so hovering
  // a card makes the next screen render instantly.
  const prefetchLevel = (semester?: number, category?: number, subject?: number) => {
    const params: Record<string, unknown> = {};
    if (semester) params.semester = semester;
    if (category) params.category = category;
    if (subject) params.subject = subject;
    void queryClient.prefetchQuery({
      queryKey: ["student-documents", semester, category, subject],
      queryFn: () =>
        http.get<{ results: DocumentItem[] }>("/documents/", { ...params, page_size: 100 }),
      staleTime: 30_000,
    });
  };

  const documents = useMemo(() => data?.results ?? [], [data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return documents;
    return documents.filter(
      (d) =>
        d.title.toLowerCase().includes(q) ||
        d.subject_name.toLowerCase().includes(q) ||
        d.category_name.toLowerCase().includes(q)
    );
  }, [documents, search]);

  // Which semesters actually have documents
  const semestersWithDocs = useMemo(() => {
    const ids = new Set(documents.map((d) => d.semester));
    return meta.semesters.filter((s) => ids.has(s.id));
  }, [documents, meta.semesters]);

  const reset = () => goTo({ level: "semester" });

  if (step.level === "semester") {
    return (
      <div className="space-y-6">
        <div className="relative max-w-md">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search your documents…"
            className="bg-muted/50 pl-9"
          />
        </div>

        {semestersWithDocs.length === 0 && !search && (
          <EmptyState
            icon={BookOpen}
            title="No documents yet"
            description="Documents uploaded for your branch & section will appear here."
          />
        )}

        {search ? (
          <>
            {selectionToolbar(filtered)}
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {filtered.map((doc, i) => (
                <DocumentCard
                  key={doc.id}
                  document={doc}
                  index={i}
                  selecting={selecting}
                  selected={selectedIds.has(doc.id)}
                  onToggleSelect={toggleSelect}
                />
              ))}
              {filtered.length === 0 && (
                <div className="sm:col-span-2 xl:col-span-3">
                  <EmptyState title="No matches" description="Try a different search term." />
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {semestersWithDocs.map((semester, i) => {
          const count = documents.filter((d) => d.semester === semester.id).length;
          return (
            <motion.button
              key={semester.id}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: i * 0.06 }}
              onMouseEnter={() => prefetchLevel(semester.id)}
              onFocus={() => prefetchLevel(semester.id)}
              onClick={() => goTo({ level: "category", semester })}
              className="group relative overflow-hidden rounded-2xl border bg-card p-5 text-left shadow-sm transition-all hover:-translate-y-1 hover:border-primary/40 hover:shadow-lg"
            >
              <div className="absolute -top-10 -right-10 size-28 rounded-full bg-gradient-to-br from-indigo-500/20 to-violet-500/20 blur-2xl" />
              <div className="relative">
                <div className="flex size-11 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-md">
                  <Layers className="size-5" />
                </div>
                <p className="mt-4 text-xl font-bold">Semester {semester.name}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {count} document{count === 1 ? "" : "s"} available
                </p>
                <p className="mt-3 text-xs font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
                  Browse categories →
                </p>
              </div>
            </motion.button>
          );
        })}
          </div>
        )}
      </div>
    );
  }

  const breadcrumb = (
    <button onClick={reset} className="mb-5 flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft className="size-4" /> All semesters
    </button>
  );

  if (step.level === "category") {
    const categories = meta.categories.filter((c) =>
      documents.some((d) => d.category === c.id)
    );
    return (
      <div>
        {breadcrumb}
        <h2 className="mb-5 text-xl font-bold">Semester {step.semester.name}</h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {categories.map((category, i) => (
            <motion.button
              key={category.id}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: i * 0.05 }}
              onMouseEnter={() => prefetchLevel(step.semester.id, category.id)}
              onFocus={() => prefetchLevel(step.semester.id, category.id)}
              onClick={() => goTo({ level: "subjects", semester: step.semester, category })}
              className="group flex items-center gap-3 rounded-2xl border bg-card p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
            >
              <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Tag className="size-5" />
              </div>
              <div>
                <p className="font-semibold">{category.name}</p>
                <p className="text-xs text-muted-foreground">
                  {documents.filter((d) => d.category === category.id).length} documents
                </p>
              </div>
            </motion.button>
          ))}
        </div>
      </div>
    );
  }

  if (step.level === "subjects") {
    const subjectIds = new Set(documents.map((d) => d.subject));
    const subjects = meta.subjects.filter(
      (s) => s.semester === step.semester.id && subjectIds.has(s.id)
    );
    return (
      <div>
        {breadcrumb}
        <button
          onClick={() => goTo({ level: "category", semester: step.semester })}
          className="mb-2 flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> {step.category.name}
        </button>
        <h2 className="mb-5 text-xl font-bold">
          {step.category.name}
          <Badge variant="secondary" className="ml-2">
            {step.semester.name}
          </Badge>
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {subjects.map((subject, i) => {
            const count = documents.filter((d) => d.subject === subject.id).length;
            return (
              <motion.button
                key={subject.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: i * 0.04 }}
                onMouseEnter={() =>
                  prefetchLevel(step.semester.id, step.category.id, subject.id)
                }
                onFocus={() =>
                  prefetchLevel(step.semester.id, step.category.id, subject.id)
                }
                onClick={() => goTo({ level: "subject", semester: step.semester, category: step.category, subject })}
                className="group flex items-center gap-3 rounded-2xl border bg-card p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
              >
                <div className="flex size-10 items-center justify-center rounded-lg bg-violet-500/10 text-violet-500">
                  <BookOpen className="size-5" />
                </div>
                <div>
                  <p className="font-semibold">
                    {subject.name}
                    {subject.code && (
                      <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                        ({subject.code})
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">{count} documents</p>
                </div>
              </motion.button>
            );
          })}
        </div>
      </div>
    );
  }

  const subjectDocs = documents.filter((d) => d.subject === step.subject.id);
  return (
    <div>
      {breadcrumb}
      <button
        onClick={() => goTo({ level: "subjects", semester: step.semester, category: step.category })}
        className="mb-2 flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> {step.category.name}
      </button>
      <h2 className="mb-1 text-xl font-bold">
        {step.subject.name}
        <Badge variant="secondary" className="ml-2">
          {step.semester.name}
        </Badge>
      </h2>
      <p className="mb-5 text-sm text-muted-foreground">{subjectDocs.length} documents</p>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="size-7 animate-spin text-primary" />
        </div>
      ) : (
        <>
          {selectionToolbar(subjectDocs)}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {subjectDocs.map((doc, i) => (
              <DocumentCard
                key={doc.id}
                document={doc}
                index={i}
                selecting={selecting}
                selected={selectedIds.has(doc.id)}
                onToggleSelect={toggleSelect}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
