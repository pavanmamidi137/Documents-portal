"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  BookOpen,
  Layers,
  Loader2,
  Search,
  Tag,
} from "lucide-react";

import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { http } from "@/lib/api";
import type { Category, DocumentItem, MetaData, Semester, Subject } from "@/lib/types";
import { DocumentCard } from "./document-card";
import { EmptyState } from "@/components/empty-state";

type Step =
  | { level: "semester" }
  | { level: "category"; semester: Semester }
  | { level: "subjects"; semester: Semester; category: Category }
  | { level: "subject"; semester: Semester; category: Category; subject: Subject };

export function StudentBrowser({ meta }: { meta: MetaData }) {
  const [step, setStep] = useState<Step>({ level: "semester" });
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: [
      "student-documents",
      "semester" in step ? step.semester.id : undefined,
      "category" in step ? step.category.id : undefined,
      "subject" in step ? step.subject.id : undefined,
    ],
    queryFn: async () => {
      const params: Record<string, unknown> = {};
      if ("semester" in step) params.semester = step.semester.id;
      if ("category" in step) params.category = step.category.id;
      if ("subject" in step) params.subject = step.subject.id;
      return http.get<{ results: DocumentItem[] }>("/documents/", { ...params, page_size: 100 });
    },
  });

  const documents = data?.results ?? [];

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

  const reset = () => setStep({ level: "semester" });

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
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {filtered.map((doc, i) => (
              <DocumentCard key={doc.id} document={doc} index={i} />
            ))}
            {filtered.length === 0 && (
              <div className="sm:col-span-2 xl:col-span-3">
                <EmptyState title="No matches" description="Try a different search term." />
              </div>
            )}
          </div>
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
              onClick={() => setStep({ level: "category", semester })}
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
              onClick={() => setStep({ level: "subjects", semester: step.semester, category })}
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
          onClick={() => setStep({ level: "category", semester: step.semester })}
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
                onClick={() => setStep({ level: "subject", semester: step.semester, category: step.category, subject })}
                className="group flex items-center gap-3 rounded-2xl border bg-card p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
              >
                <div className="flex size-10 items-center justify-center rounded-lg bg-violet-500/10 text-violet-500">
                  <BookOpen className="size-5" />
                </div>
                <div>
                  <p className="font-semibold">{subject.name}</p>
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
        onClick={() => setStep({ level: "subjects", semester: step.semester, category: step.category })}
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
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {subjectDocs.map((doc, i) => (
            <DocumentCard key={doc.id} document={doc} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}
