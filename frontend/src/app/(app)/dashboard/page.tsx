"use client";

import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import Link from "next/link";
import {
  Building2,
  Clock,
  FileText,
  FileUser,
  FolderOpen,
  Layers,
  Megaphone,
  School,
  Upload,
  Users,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { StatCard } from "@/components/stat-card";
import { PageHeader } from "@/components/layout/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { getDocumentTypeMeta } from "@/lib/document-types";
import { fetchMyResume, http } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { DashboardData } from "@/lib/types";
import { cn, formatBytes, formatDate } from "@/lib/utils";

const STAT_META: Record<string, { label: string; icon: typeof Users; gradient: string }> = {
  students: { label: "Total Students", icon: Users, gradient: "from-indigo-500 to-violet-600" },
  crs: { label: "Total CRs", icon: School, gradient: "from-sky-500 to-cyan-600" },
  branches: { label: "Total Branches", icon: Building2, gradient: "from-emerald-500 to-teal-600" },
  sections: { label: "Total Sections", icon: Layers, gradient: "from-amber-500 to-orange-600" },
  subjects: { label: "Total Subjects", icon: FolderOpen, gradient: "from-rose-500 to-pink-600" },
  documents: { label: "Total Documents", icon: FileText, gradient: "from-fuchsia-500 to-purple-600" },
  categories: { label: "Categories Used", icon: FolderOpen, gradient: "from-teal-500 to-emerald-600" },
  semesters: { label: "Semesters", icon: Layers, gradient: "from-orange-500 to-amber-600" },
  announcements: { label: "Announcements", icon: Megaphone, gradient: "from-pink-500 to-rose-600" },
  resumes: { label: "Resumes Uploaded", icon: FileUser, gradient: "from-cyan-500 to-sky-600" },
  pending_resumes: { label: "Pending Resumes", icon: Clock, gradient: "from-amber-500 to-orange-600" },
};

const CHART_COLORS = ["#6366f1", "#8b5cf6", "#0ea5e9", "#10b981", "#f59e0b", "#f43f5e"];

interface FacultyResume {
  id: number;
  student_name: string;
  student_roll: string;
  section_name: string | null;
  file_name: string;
  updated_at: string;
}

function FacultyRecentResumes({ data }: { data: DashboardData & { recent_resumes?: FacultyResume[] } }) {
  const resumes = data.recent_resumes ?? [];
  if (resumes.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No student resumes uploaded yet.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      {resumes.map((r) => (
        <div key={r.id} className="flex items-center gap-3 rounded-lg p-2 transition-colors hover:bg-muted/50">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-rose-500/10 text-rose-500 ring-1 ring-rose-500/20">
            <FileUser className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{r.student_name}</p>
            <p className="truncate text-xs text-muted-foreground">
              {r.student_roll}
              {r.section_name ? ` · Sec ${r.section_name}` : ""} · {r.file_name}
            </p>
          </div>
          <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">
            {formatDate(r.updated_at)}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => http.get<DashboardData>("/dashboard/"),
  });

  const isAdmin = user?.is_super_admin ?? false;
  const isFaculty = user?.is_faculty ?? false;
  const isStudent = user?.is_student ?? false;

  // Students: check whether they've uploaded a resume yet. Shares the cache
  // key with the /resume page, so the banner disappears the moment they upload.
  const { data: myResume } = useQuery({
    queryKey: ["resume", "mine"],
    queryFn: fetchMyResume,
    enabled: isStudent,
    staleTime: 30_000,
  });

  const totals = data?.totals ?? {};
  const statKeys = Object.keys(STAT_META).filter((key) => key in totals);

  const chartData = (data?.charts?.by_category ?? []).map((item) => ({
    name: item.category__name ?? "Unknown",
    count: item.count,
  }));

  return (
    <div>
      <PageHeader
        title={`Welcome back, ${user?.full_name.split(" ")[0]} 👋`}
        description={
          isAdmin
            ? "Here's what's happening across your college."
            : "Here's what's new in your section."
        }
      />

      {/* Student: resume reminder when none is uploaded yet */}
      {isStudent && myResume === null && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="mb-6 flex flex-col gap-4 rounded-2xl border border-indigo-500/20 bg-gradient-to-r from-indigo-500/10 via-violet-500/10 to-fuchsia-500/10 p-5 sm:flex-row sm:items-center"
        >
          <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-md shadow-indigo-500/30">
            <FileUser className="size-5 text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">Upload your resume</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Faculty in your branch can&apos;t review your profile until you add a resume — it only takes a
              minute.
            </p>
          </div>
          <Link
            href="/resume"
            className={cn(buttonVariants({ size: "lg" }), "gap-2 self-start sm:self-auto")}
          >
            <Upload className="size-4" /> Upload Resume
          </Link>
        </motion.div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
        {isLoading
          ? Array.from({ length: statKeys.length || 6 }).map((_, i) => (
              <div key={i} className="rounded-2xl border bg-card p-5">
                <Skeleton className="mb-3 h-4 w-24" />
                <Skeleton className="h-8 w-16" />
              </div>
            ))
          : statKeys.map((key, i) => {
              const meta = STAT_META[key];
              return (
                <StatCard
                  key={key}
                  label={meta.label}
                  value={totals[key] ?? 0}
                  icon={meta.icon}
                  gradient={meta.gradient}
                  delay={i}
                />
              );
            })}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        {/* Chart (admin only) */}
        {isAdmin && data?.charts && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.25 }}
            className="rounded-2xl border bg-card p-5 lg:col-span-1"
          >
            <h3 className="mb-4 font-semibold">Documents by Category</h3>
            {chartData.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                Upload documents to see distribution.
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 12 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} opacity={0.2} />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12 }} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={92}
                    tick={{ fontSize: 11 }}
                  />
                  <Tooltip
                    cursor={{ fill: "rgba(0,0,0,0.05)" }}
                    contentStyle={{
                      background: "var(--popover)",
                      border: "1px solid var(--border)",
                      borderRadius: 12,
                      fontSize: 13,
                    }}
                  />
                  <Bar dataKey="count" radius={[0, 6, 6, 0]} barSize={18}>
                    {chartData.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </motion.div>
        )}

        {/* Recent uploads (faculty see recent resumes instead) */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.3 }}
          className="rounded-2xl border bg-card p-5 lg:col-span-2"
        >
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-semibold">{isFaculty ? "Recently Updated Resumes" : "Recent Uploads"}</h3>
            {!isLoading && isFaculty && (
              <Badge variant="secondary">{(data as { recent_resumes?: unknown[] } | undefined)?.recent_resumes?.length ?? 0} latest</Badge>
            )}
          </div>
          <div className="space-y-2">
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 rounded-lg p-2">
                  <Skeleton className="size-9 rounded-lg" />
                  <div className="flex-1 space-y-1">
                    <Skeleton className="h-4 w-1/2" />
                    <Skeleton className="h-3 w-1/3" />
                  </div>
                </div>
              ))
            ) : isFaculty ? (
              <FacultyRecentResumes data={data as DashboardData & { recent_resumes?: FacultyResume[] }} />
            ) : data?.recent_uploads.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No documents uploaded yet.
              </p>
            ) : (
              data?.recent_uploads.map((doc) => {
                const typeMeta = getDocumentTypeMeta(doc.file_name);
                const DocIcon = typeMeta.Icon;
                return (
                <a
                  key={doc.id}
                  href={doc.cloudinary_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 rounded-lg p-2 transition-colors hover:bg-muted/50"
                >
                  <div className={`flex size-9 shrink-0 items-center justify-center rounded-lg ring-1 ${typeMeta.classes}`}>
                    <DocIcon className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{doc.title}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {doc.subject_name} · {doc.branch_name} {doc.section_name} ·{" "}
                      {formatBytes(doc.file_size)}
                    </p>
                  </div>
                  <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">
                    {formatDate(doc.created_at)}
                  </span>
                </a>
                );
              })
            )}
          </div>
        </motion.div>
      </div>

      {/* Student: recent announcements */}
      {!isAdmin && data?.recent_announcements && data.recent_announcements.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.35 }}
          className="mt-6 rounded-2xl border bg-card p-5"
        >
          <h3 className="mb-4 flex items-center gap-2 font-semibold">
            <Megaphone className="size-4 text-primary" /> Latest Announcements
          </h3>
          <div className="space-y-3">
            {data.recent_announcements.map((a) => (
              <div key={a.id} className="rounded-lg border bg-muted/30 p-3">
                <p className="text-sm font-medium">{a.title}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{formatDate(a.created_at)}</p>
              </div>
            ))}
          </div>
        </motion.div>
      )}
    </div>
  );
}
