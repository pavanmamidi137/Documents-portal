"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { FileText, Loader2, Megaphone, Search, Users } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/empty-state";
import { http } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { SearchResults } from "@/lib/types";
import { formatBytes, formatDate, roleColor } from "@/lib/utils";

function SearchContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user } = useAuth();
  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  const q = searchParams.get("q") ?? "";

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["search", q],
    queryFn: () => http.get<SearchResults>("/search/", { q }),
    enabled: q.trim().length >= 2,
  });



  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim().length >= 2) {
      router.replace(`/search?q=${encodeURIComponent(query.trim())}`);
    }
  };

  const showStudents = user?.is_super_admin || user?.is_cr;
  const hasResults =
    (data?.students?.length ?? 0) +
      (data?.documents?.length ?? 0) +
      (data?.announcements?.length ?? 0) >
    0;

  return (
    <div>
      <PageHeader title="Search" description="Find students, documents and announcements." />

      <form onSubmit={submit} className="relative mb-6 max-w-xl">
        <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by roll number, name, subject, title…"
          className="h-11 pl-9"
          autoFocus
        />
      </form>

      {isLoading || isFetching ? (
        <div className="space-y-6">
          {[0, 1].map((s) => (
            <div key={s} className="space-y-2">
              <Skeleton className="h-5 w-40" />
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ))}
        </div>
      ) : q.trim().length < 2 ? (
        <EmptyState title="Type at least 2 characters" description="Search across the whole portal." />
      ) : !hasResults ? (
        <EmptyState
          title={`No results for "${q}"`}
          description="Try a different roll number, name or subject."
        />
      ) : (
        <div className="space-y-8">
          {showStudents && data?.students && data.students.length > 0 && (
            <SearchSection icon={Users} title={`Students (${data.students.length})`}>
              {data.students.map((s) => (
                <div key={s.id} className="flex items-center gap-3 rounded-xl border bg-card p-3">
                  <div className="flex size-9 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                    {s.full_name
                      .split(/\s+/)
                      .slice(0, 2)
                      .map((p) => p[0])
                      .join("")}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{s.full_name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {s.roll_number} · {s.branch_code || s.branch_name || "—"}{" "}
                      {s.section_name ? `/ ${s.section_name}` : ""}
                    </p>
                  </div>
                  <Badge variant="outline" className={roleColor(s.role)}>
                    {s.role === "CR" ? "CR" : "Student"}
                  </Badge>
                </div>
              ))}
            </SearchSection>
          )}

          {data?.documents && data.documents.length > 0 && (
            <SearchSection icon={FileText} title={`Documents (${data.documents.length})`}>
              {data.documents.map((d) => (
                <a
                  key={d.id}
                  href={d.cloudinary_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 rounded-xl border bg-card p-3 transition-colors hover:bg-muted/40"
                >
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-rose-500/10 text-rose-500">
                    <FileText className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{d.title}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {d.subject_name} · {d.category_name} · {d.branch_code || d.branch_name} {d.section_name} ·{" "}
                      {formatBytes(d.file_size)}
                    </p>
                  </div>
                  <span className="hidden text-xs text-muted-foreground sm:block">
                    {formatDate(d.created_at)}
                  </span>
                </a>
              ))}
            </SearchSection>
          )}

          {data?.announcements && data.announcements.length > 0 && (
            <SearchSection icon={Megaphone} title={`Announcements (${data.announcements.length})`}>
              {data.announcements.map((a) => (
                <div key={a.id} className="rounded-xl border bg-card p-3">
                  <p className="font-medium">{a.title}</p>
                  <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{a.body}</p>
                </div>
              ))}
            </SearchSection>
          )}
        </div>
      )}
    </div>
  );
}

function SearchSection({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Users;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <motion.section initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
      <h3 className="mb-3 flex items-center gap-2 font-semibold">
        <Icon className="size-4 text-primary" /> {title}
      </h3>
      <div className="space-y-2">{children}</div>
    </motion.section>
  );
}

export default function SearchPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-[50vh] items-center justify-center">
          <Loader2 className="size-7 animate-spin text-primary" />
        </div>
      }
    >
      <SearchContent />
    </Suspense>
  );
}
