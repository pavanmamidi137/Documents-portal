"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { http } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useMetaData } from "@/lib/use-meta";
import { downloadDocument } from "@/lib/download";
import { useCloudinaryCheck } from "@/lib/use-cloudinary-check";
import { getUnitLabel } from "@/lib/document-types";
import type { DocumentItem } from "@/lib/types";
import { DocumentCard } from "./document-card";
import { EmptyState } from "@/components/empty-state";
import { getErrorMessage } from "@/lib/utils";

interface UnitNode {
  label: string;
  documents: DocumentItem[];
}

interface CategoryNode {
  id: number;
  name: string;
  units: UnitNode[];
}

interface SubjectNode {
  id: number;
  name: string;
  semester: number;
  semester_name: string;
  categories: CategoryNode[];
}

// Steps store ids/labels (not node objects) so the current level always
// resolves against the freshest tree, even after a background refetch.
type Step =
  | { level: "subjects" }
  | { level: "categories"; subjectId: number }
  | { level: "units"; subjectId: number; categoryId: number }
  | { level: "documents"; subjectId: number; categoryId: number; unitLabel: string };

// One fetch powers every level: Subjects → Categories → Units → Documents.
// The response shape matches the Cloudinary check hook ({count, results}).
const LIST_KEY = ["student-documents", "tree"] as const;

function subjectCount(subject: SubjectNode): number {
  return subject.categories.reduce(
    (n, c) => n + c.units.reduce((m, u) => m + u.documents.length, 0),
    0
  );
}

/** Numeric units (Unit 1, 2, …) sort first; "General" and others go last. */
function unitSortKey(label: string): [number, number] {
  const match = /^Unit (\d+)$/.exec(label);
  return match ? [0, Number(match[1])] : [1, 0];
}

// Semester filter persists per user so their choice survives page reloads.
// The "All semesters" option (an empty filter) is stored as a sentinel so a
// deliberate choice of "All" is not confused with "never picked one".
const SEMESTER_FILTER_STORAGE_KEY = "placemate.semester-filter";
const ALL_SEMESTERS_STORED = "all";

function readSavedSemesterFilter(): { saved: boolean; value: string } {
  if (typeof window === "undefined") return { saved: false, value: "" };
  try {
    const raw = localStorage.getItem(SEMESTER_FILTER_STORAGE_KEY);
    if (raw === null) return { saved: false, value: "" };
    return { saved: true, value: raw === ALL_SEMESTERS_STORED ? "" : raw };
  } catch {
    return { saved: false, value: "" };
  }
}

function writeSemesterFilter(value: string) {
  try {
    localStorage.setItem(SEMESTER_FILTER_STORAGE_KEY, value ? value : ALL_SEMESTERS_STORED);
  } catch {
    // localStorage unavailable (private mode etc.) - the filter still works for this session.
  }
}

export function StudentBrowser() {
  const { user } = useAuth();
  const isAdmin = user?.is_super_admin ?? false;
  const { data: meta } = useMetaData();
  const [step, setStep] = useState<Step>({ level: "subjects" });
  const [subjectSearch, setSubjectSearch] = useState("");
  // Semester filter on the subjects level: defaults to the currently running
  // semester, and the student's own choice is remembered across visits via
  // localStorage. `savedChoice` is read once - `saved` tells us whether the
  // student ever picked a filter, so a deliberate "All semesters" choice is
  // not mistaken for a first-ever visit.
  const [savedChoice] = useState<{ saved: boolean; value: string }>(readSavedSemesterFilter);
  const [semesterFilter, setSemesterFilter] = useState<string>(savedChoice.value);
  // Tracks whether the student picked a filter this session, so the
  // date-derived default only applies until they make a choice.
  const [filterTouched, setFilterTouched] = useState(false);
  const [docSearch, setDocSearch] = useState("");

  // The filter actually applied: an explicit choice wins; otherwise a student
  // who never picked one gets the currently running semester (from the date).
  // A saved filter pointing at a deleted semester falls back to All.
  const resolvedFilter =
    semesterFilter !== ""
      ? meta?.semesters.some((s) => String(s.id) === semesterFilter)
        ? semesterFilter
        : ""
      : !filterTouched && !savedChoice.saved && meta?.current_semester
        ? String(meta.current_semester.id)
        : "";
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [downloading, setDownloading] = useState(false);

  // Leaving a view clears the selection mode.
  const goTo = (next: Step) => {
    setSelectedIds(new Set());
    setSelecting(false);
    setStep(next);
  };

  const changeSemesterFilter = (value: string | null) => {
    const next = value ?? "";
    setFilterTouched(true);
    setSemesterFilter(next);
    writeSemesterFilter(next);
  };

  const { data, isLoading } = useQuery({
    queryKey: LIST_KEY,
    queryFn: () =>
      http.get<{ count: number; total: number; results: DocumentItem[] }>("/documents/tree/"),
    // The whole tree is cached for a while - reopening Documents feels instant.
    staleTime: 30_000,
  });

  // Files deleted directly in Cloudinary are dropped from the tree instantly.
  useCloudinaryCheck<DocumentItem>({
    url: "/documents/check-files/",
    params: {},
    queryKey: LIST_KEY,
    kind: "document",
  });

  // Admins see every section, so a branch-wide upload would repeat the same
  // file once per section. Group by file (public_id): keep the newest copy
  // and attach the full list of sections it was shared to.
  const documents = useMemo(() => {
    const rows = data?.results ?? [];
    if (!isAdmin) return rows;
    const byFile = new Map<string, DocumentItem>();
    for (const doc of rows) {
      const existing = byFile.get(doc.public_id);
      if (!existing || doc.created_at > existing.created_at) {
        byFile.set(doc.public_id, {
          ...doc,
          sections: [doc.section_name],
          section_count: 1,
          total_downloads: doc.downloads,
        });
      } else {
        byFile.set(doc.public_id, {
          ...existing,
          sections: [...(existing.sections ?? []), doc.section_name],
          section_count: (existing.section_count ?? 1) + 1,
          total_downloads:
            (existing.total_downloads ?? existing.downloads) + doc.downloads,
        });
      }
    }
    return [...byFile.values()];
  }, [data, isAdmin]);

  // Build Subjects → Categories → Units from the flat list once.
  const subjects = useMemo(() => {
    const map = new Map<number, SubjectNode>();
    for (const doc of documents) {
      let subject = map.get(doc.subject);
      if (!subject) {
        subject = {
          id: doc.subject,
          name: doc.subject_name,
          semester: doc.semester,
          semester_name: doc.semester_name,
          categories: [],
        };
        map.set(doc.subject, subject);
      }
      let category = subject.categories.find((c) => c.id === doc.category);
      if (!category) {
        category = { id: doc.category, name: doc.category_name, units: [] };
        subject.categories.push(category);
      }
      const label = getUnitLabel(doc.title);
      let unit = category.units.find((u) => u.label === label);
      if (!unit) {
        unit = { label, documents: [] };
        category.units.push(unit);
      }
      unit.documents.push(doc);
    }
    for (const subject of map.values()) {
      subject.categories.sort((a, b) => a.name.localeCompare(b.name));
      for (const category of subject.categories) {
        category.units.sort((a, b) => {
          const [ka, kb] = [unitSortKey(a.label), unitSortKey(b.label)];
          return ka[0] - kb[0] || ka[1] - kb[1] || a.label.localeCompare(b.label);
        });
      }
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [documents]);

  const filteredSubjects = useMemo(() => {
    let list = subjects;
    if (resolvedFilter) {
      const semesterId = Number(resolvedFilter);
      list = list.filter((s) => s.semester === semesterId);
    }
    const q = subjectSearch.trim().toLowerCase();
    if (q) list = list.filter((s) => s.name.toLowerCase().includes(q));
    return list;
  }, [subjects, subjectSearch, resolvedFilter]);

  // Resolve the current level's nodes against the live tree every render.
  const currentNodes = useMemo(() => {
    if (step.level === "subjects") {
      return { subject: null as SubjectNode | null, category: null as CategoryNode | null, unit: null as UnitNode | null, unitDocs: [] as DocumentItem[] };
    }
    const subject = subjects.find((s) => s.id === step.subjectId) ?? null;
    if (step.level === "categories") {
      return { subject, category: null, unit: null, unitDocs: [] };
    }
    const category = subject?.categories.find((c) => c.id === step.categoryId) ?? null;
    if (step.level === "units") {
      return { subject, category, unit: null, unitDocs: [] };
    }
    const unit = category?.units.find((u) => u.label === step.unitLabel) ?? null;
    return { subject, category, unit, unitDocs: unit?.documents ?? [] };
  }, [subjects, step]);
  const { subject: currentSubject, category: currentCategory, unit: currentUnit, unitDocs } = currentNodes;

  // Documents within the current unit, filtered by the in-unit search box.
  const filteredDocs = useMemo(() => {
    const q = docSearch.trim().toLowerCase();
    if (!q) return unitDocs;
    return unitDocs.filter(
      (d) => d.title.toLowerCase().includes(q) || d.file_name.toLowerCase().includes(q)
    );
  }, [unitDocs, docSearch]);

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

  // Streams through the browser with a live % + MB progress toast.
  const downloadOne = async (doc: DocumentItem): Promise<boolean> => {
    return downloadDocument(doc);
  };

  const downloadSelected = async (docs: DocumentItem[]) => {
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

  if (isLoading) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="size-7 animate-spin text-primary" />
      </div>
    );
  }

  const resetToSubjects = () => goTo({ level: "subjects" });

  const breadcrumb = (
    <button
      onClick={resetToSubjects}
      className="mb-5 flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-4" /> All subjects
    </button>
  );

  // A background refetch can remove the node the student was viewing.
  const missingNode =
    (step.level === "categories" && !currentSubject) ||
    (step.level === "units" && (!currentSubject || !currentCategory)) ||
    (step.level === "documents" && (!currentSubject || !currentCategory || !currentUnit));

  if (missingNode) {
    return (
      <div className="space-y-4">
        <EmptyState
          icon={BookOpen}
          title="These documents were just removed"
          description="The folder you were viewing no longer has files here. Go back and pick another subject."
        />
        <div className="flex justify-center">
          <Button variant="outline" onClick={resetToSubjects}>
            <ArrowLeft className="size-4" /> Back to subjects
          </Button>
        </div>
      </div>
    );
  }

  /* ------------------------------------------------ Subjects */
  if (step.level === "subjects") {
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-0 max-w-md flex-1">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={subjectSearch}
              onChange={(e) => setSubjectSearch(e.target.value)}
              placeholder="Search subjects…"
              className="bg-muted/50 pl-9"
            />
          </div>
          <Select value={resolvedFilter} onValueChange={changeSemesterFilter}>
            <SelectTrigger className="w-full sm:w-44">
              <SelectValue placeholder="All semesters" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">All semesters</SelectItem>
              {(meta?.semesters ?? []).map((s) => (
                <SelectItem key={s.id} value={String(s.id)}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {resolvedFilter && (
          <p className="text-xs text-muted-foreground">
            Showing <span className="font-medium text-foreground">{filteredSubjects.length}</span> subject{filteredSubjects.length === 1 ? "" : "s"} for semester{" "}
            <span className="font-medium text-foreground">
              {meta?.semesters.find((s) => String(s.id) === resolvedFilter)?.name}
            </span>
            .
          </p>
        )}

        {data && data.total > data.results.length && (
          <p className="text-xs text-muted-foreground">
            Showing the latest {data.results.length} of {data.total} documents — older ones were
            trimmed for speed.
          </p>
        )}

        {subjects.length === 0 ? (
          <EmptyState
            icon={BookOpen}
            title="No documents yet"
            description="Documents uploaded for your branch & section will appear here."
          />
        ) : filteredSubjects.length === 0 ? (
          <EmptyState
            icon={Search}
            title="No subjects match"
            description={
              resolvedFilter
                ? "No subjects have documents in this semester yet — try another semester or All semesters."
                : "Try a different search term."
            }
          />
        ) : (
          <div className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {filteredSubjects.map((subject, i) => {
              const count = subjectCount(subject);
              return (
                <motion.button
                  key={subject.id}
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.35, delay: i * 0.04 }}
                  onClick={() => goTo({ level: "categories", subjectId: subject.id })}
                  className="group relative min-w-0 overflow-hidden rounded-2xl border bg-card p-5 text-left shadow-sm transition-all hover:-translate-y-1 hover:border-primary/40 hover:shadow-lg"
                >
                  <div className="absolute -top-10 -right-10 size-28 rounded-full bg-gradient-to-br from-primary/20 to-primary/5 blur-2xl" />
                  <div className="relative min-w-0">
                    <div className="flex size-11 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-md">
                      <BookOpen className="size-5" />
                    </div>
                    <p className="mt-4 text-lg leading-tight font-bold [overflow-wrap:anywhere] [word-break:break-word]">
                      {subject.name}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {count} document{count === 1 ? "" : "s"}
                    </p>
                    <Badge variant="secondary" className="mt-2 max-w-full">
                      <span className="block max-w-full truncate">{subject.semester_name}</span>
                    </Badge>
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

  /* ------------------------------------------------ Categories */
  if (step.level === "categories" && currentSubject) {
    return (
      <div>
        {breadcrumb}
        <h2 className="mb-5 flex flex-wrap items-center gap-2 text-xl font-bold">
          <span className="min-w-0 break-words">{currentSubject.name}</span>
          <Badge variant="secondary">{currentSubject.semester_name}</Badge>
        </h2>
        <div className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {currentSubject.categories.map((category, i) => {
            const count = category.units.reduce((n, u) => n + u.documents.length, 0);
            return (
              <motion.button
                key={category.id}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: i * 0.05 }}
                onClick={() => goTo({ level: "units", subjectId: currentSubject.id, categoryId: category.id })}
                className="group flex min-w-0 items-center gap-3 rounded-2xl border bg-card p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
              >
                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Tag className="size-5" />
                </div>
                <div className="min-w-0">
                  <p className="truncate font-semibold">{category.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {count} document{count === 1 ? "" : "s"} · {category.units.length} unit
                    {category.units.length === 1 ? "" : "s"}
                  </p>
                </div>
              </motion.button>
            );
          })}
        </div>
      </div>
    );
  }

  /* ------------------------------------------------ Units */
  if (step.level === "units" && currentSubject && currentCategory) {
    return (
      <div>
        {breadcrumb}
        <button
          onClick={() => goTo({ level: "categories", subjectId: currentSubject.id })}
          className="mb-2 flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> {currentCategory.name}
        </button>
        <h2 className="mb-5 flex flex-wrap items-center gap-2 text-xl font-bold">
          <span className="min-w-0 break-words">{currentSubject.name}</span>
          <Badge variant="secondary">{currentCategory.name}</Badge>
        </h2>
        <div className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {currentCategory.units.map((unit, i) => (
            <motion.button
              key={unit.label}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: i * 0.04 }}
              onClick={() =>
                goTo({
                  level: "documents",
                  subjectId: currentSubject.id,
                  categoryId: currentCategory.id,
                  unitLabel: unit.label,
                })
              }
              className="group flex min-w-0 items-center gap-3 rounded-2xl border bg-card p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
            >
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-violet-500/10 text-violet-500">
                <Layers className="size-5" />
              </div>
              <div className="min-w-0">
                <p className="truncate font-semibold">{unit.label}</p>
                <p className="text-xs text-muted-foreground">
                  {unit.documents.length} document{unit.documents.length === 1 ? "" : "s"}
                </p>
              </div>
            </motion.button>
          ))}
        </div>
      </div>
    );
  }

  /* ------------------------------------------------ Documents */
  if (step.level === "documents" && currentSubject && currentCategory && currentUnit) {
    return (
      <div>
        {breadcrumb}
        <button
          onClick={() =>
            goTo({
              level: "units",
              subjectId: currentSubject.id,
              categoryId: currentCategory.id,
            })
          }
          className="mb-2 flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> {currentCategory.name}
        </button>
        <h2 className="mb-1 flex flex-wrap items-center gap-2 text-xl font-bold">
          <span className="min-w-0 break-words">{currentSubject.name}</span>
          <span className="text-muted-foreground">· {currentUnit.label}</span>
          <Badge variant="secondary">{currentCategory.name}</Badge>
        </h2>
        <p className="mb-5 text-sm text-muted-foreground">{unitDocs.length} documents</p>

        <div className="relative mb-4 w-full min-w-0 max-w-md">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={docSearch}
            onChange={(e) => setDocSearch(e.target.value)}
            placeholder="Search in this unit…"
            className="bg-muted/50 pl-9"
          />
        </div>

        {selectionToolbar(filteredDocs)}
        <div className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filteredDocs.map((doc, i) => (
            <DocumentCard
              key={doc.id}
              document={doc}
              index={i}
              selecting={selecting}
              selected={selectedIds.has(doc.id)}
              onToggleSelect={toggleSelect}
            />
          ))}
          {filteredDocs.length === 0 && (
            <div className="sm:col-span-2 xl:col-span-3">
              <EmptyState
                icon={BookOpen}
                title="No documents here"
                description="Try another unit or category."
              />
            </div>
          )}
        </div>
      </div>
    );
  }

  // Should never happen (missingNode guard above) - keep TS happy.
  return null;
}
