"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import { useTheme } from "next-themes";
import {
  ArrowRight,
  BarChart3,
  BellRing,
  BookOpen,
  Check,
  Download,
  FileText,
  FolderOpen,
  GraduationCap,
  Layers,
  Library,
  Moon,
  Search,
  Share2,
  ShieldCheck,
  Sparkles,
  Sun,
  UploadCloud,
  Users,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";

const fadeUp = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
};

const FEATURES = [
  {
    icon: UploadCloud,
    title: "Upload & secure storage",
    text: "Drop PDFs, PPTs, DOCX and TXT files. They're stored safely in Cloudinary — the portal only keeps the link.",
  },
  {
    icon: Layers,
    title: "Organized by semester & subject",
    text: "Notes, lab manuals, previous papers and question banks arranged exactly the way your course is structured.",
  },
  {
    icon: Search,
    title: "Search everything",
    text: "Find any document, student or announcement in seconds from the search bar.",
  },
  {
    icon: Share2,
    title: "Share across sections",
    text: "CRs request sharing with other sections — the receiving CR approves and it appears there. No re-upload, no extra storage.",
  },
  {
    icon: BellRing,
    title: "Smart notifications",
    text: "CRs get an instant bell notification when another section wants to share a document, and can accept or decline.",
  },
  {
    icon: Users,
    title: "Students & CR management",
    text: "Add students one by one or bulk-import via CSV. Promote CRs, reset passwords and manage every account.",
  },
  {
    icon: BarChart3,
    title: "Analytics dashboard",
    text: "Live totals, uploads by category and branch, and recent activity at a glance.",
  },
  {
    icon: ShieldCheck,
    title: "Complete audit trail",
    text: "Every login, upload, share and change is logged with the actor and IP address.",
  },
];

const ROLES = [
  {
    icon: BookOpen,
    title: "Students",
    color: "from-emerald-500/20 to-teal-500/10 text-emerald-600 dark:text-emerald-400",
    points: [
      "Browse & download documents for your branch and section",
      "Navigate by semester → category → subject",
      "Search and preview files in the browser",
      "Download multiple documents in one go",
    ],
  },
  {
    icon: GraduationCap,
    title: "Class Representatives (CR)",
    color: "from-violet-500/20 to-purple-500/10 text-violet-600 dark:text-violet-400",
    points: [
      "Upload documents for your assigned section",
      "Request sharing with other sections' CRs",
      "Accept incoming share requests for your students",
      "Manage your section's students — add, CSV import, reset passwords",
    ],
  },
  {
    icon: ShieldCheck,
    title: "Super Admin",
    color: "from-indigo-500/20 to-blue-500/10 text-indigo-600 dark:text-indigo-400",
    points: [
      "Manage branches, sections, semesters, subjects & categories",
      "Upload and share documents across every section",
      "Promote/demote CRs, activate accounts, reset passwords",
      "Full audit logs and college-wide analytics",
    ],
  },
];

const STEPS = [
  {
    step: "01",
    title: "Sign in with your roll number",
    text: "Students and CRs sign in with their Roll Number — the first-time password is the roll number itself.",
  },
  {
    step: "02",
    title: "Explore or upload",
    text: "Students browse by semester, category and subject. CRs and admins upload notes, manuals and more.",
  },
  {
    step: "03",
    title: "Share & download",
    text: "CRs share across sections with one tap, and everyone downloads what they need — no more chasing files.",
  },
];

export default function HomePage() {
  const { user, loading } = useAuth();
  const { theme, setTheme } = useTheme();
  const router = useRouter();

  useEffect(() => {
    if (!loading && user) router.replace("/dashboard");
  }, [loading, user, router]);

  if (loading || user) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <GraduationCap className="size-8 animate-pulse text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen overflow-x-hidden bg-background">
      {/* ------------------------------------------------ Navbar */}
      <header className="sticky top-0 z-40 border-b bg-background/75 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-md shadow-indigo-500/25">
              <GraduationCap className="size-5" />
            </div>
            <div className="leading-tight">
              <p className="text-sm font-bold tracking-tight">College Document Portal</p>
              <p className="text-[11px] text-muted-foreground">Every note, one place</p>
            </div>
          </Link>
          <nav className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
            <a href="#features" className="transition-colors hover:text-foreground">
              Features
            </a>
            <a href="#roles" className="transition-colors hover:text-foreground">
              For everyone
            </a>
            <a href="#how" className="transition-colors hover:text-foreground">
              How it works
            </a>
          </nav>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="Toggle light/dark mode"
              title="Toggle light/dark mode"
            >
              {theme === "dark" ? <Sun className="size-5" /> : <Moon className="size-5" />}
            </button>
            <Button render={<Link href="/login" />} variant="outline">
              Sign in <ArrowRight className="size-4" />
            </Button>
          </div>
        </div>
      </header>

      {/* ------------------------------------------------ Hero */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute -top-40 left-1/2 size-[42rem] -translate-x-1/2 rounded-full bg-indigo-500/15 blur-3xl" />
        <div className="pointer-events-none absolute top-48 -right-40 size-96 rounded-full bg-violet-500/15 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 -left-32 size-96 rounded-full bg-sky-500/10 blur-3xl" />

        <div className="relative mx-auto max-w-6xl px-4 pt-20 pb-16 text-center sm:px-6 sm:pt-28">
          <motion.div {...fadeUp} transition={{ duration: 0.5 }}>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
              <Sparkles className="size-3.5" /> The digital library for your college
            </span>
          </motion.div>

          <motion.h1
            {...fadeUp}
            transition={{ duration: 0.5, delay: 0.08 }}
            className="mx-auto mt-6 max-w-3xl text-4xl leading-tight font-extrabold tracking-tight sm:text-6xl"
          >
            Every note, question paper &amp; lab manual.{" "}
            <span className="bg-gradient-to-r from-indigo-500 to-violet-500 bg-clip-text text-transparent">
              One portal.
            </span>
          </motion.h1>

          <motion.p
            {...fadeUp}
            transition={{ duration: 0.5, delay: 0.16 }}
            className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground"
          >
            The College Document Portal lets students, Class Representatives and admins upload,
            browse, share and download study documents — organized by semester, category and
            subject, with role-based access for everyone.
          </motion.p>

          <motion.div
            {...fadeUp}
            transition={{ duration: 0.5, delay: 0.24 }}
            className="mt-9 flex flex-wrap items-center justify-center gap-3"
          >
            <Button size="lg" render={<Link href="/login" />} className="bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-lg shadow-indigo-500/25 hover:from-indigo-500 hover:to-violet-500">
              Get started <ArrowRight className="size-4" />
            </Button>
            <Button size="lg" variant="outline" render={<a href="#features" />}>
              Explore features
            </Button>
          </motion.div>

          <motion.div
            {...fadeUp}
            transition={{ duration: 0.5, delay: 0.32 }}
            className="mx-auto mt-12 flex max-w-2xl flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-muted-foreground"
          >
            <span className="flex items-center gap-1.5">
              <Check className="size-4 text-emerald-500" /> PDF, PPT, DOCX &amp; TXT
            </span>
            <span className="flex items-center gap-1.5">
              <Check className="size-4 text-emerald-500" /> Organized by semester
            </span>
            <span className="flex items-center gap-1.5">
              <Check className="size-4 text-emerald-500" /> Role-based access
            </span>
          </motion.div>
        </div>
      </section>

      {/* ------------------------------------------------ About */}
      <section id="about" className="border-y bg-muted/30 py-20">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-2">
          <div>
            <p className="text-sm font-semibold text-primary">What is this portal?</p>
            <h2 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
              A shared library built for your college
            </h2>
            <p className="mt-4 text-muted-foreground">
              Instead of notes scattered across WhatsApp groups and pen drives, everything lives in
              one organized, searchable place. Each branch and section sees exactly the documents
              meant for them — no clutter, no missing files.
            </p>
            <ul className="mt-6 space-y-3">
              {[
                "Documents stored once and shared across sections without re-uploading",
                "CRs keep their section's library up to date, admins keep the whole college in check",
                "Students always find the latest notes, manuals and question banks",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2.5 text-sm">
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                    <Check className="size-3" />
                  </span>
                  <span className="text-muted-foreground">{item}</span>
                </li>
              ))}
            </ul>
          </div>

          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="relative"
          >
            <div className="pointer-events-none absolute -inset-6 rounded-3xl bg-gradient-to-br from-indigo-500/10 to-violet-500/10 blur-2xl" />
            <div className="relative space-y-3 rounded-2xl border bg-card p-5 shadow-xl">
              <div className="flex items-center justify-between">
                <p className="flex items-center gap-2 text-sm font-semibold">
                  <FolderOpen className="size-4 text-primary" /> Semester 3-1
                </p>
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                  CSE · Sec A
                </span>
              </div>
              <div className="space-y-2.5">
                {[
                  { icon: FileText, name: "DBMS — Unit 1 Notes.pdf", meta: "Notes · 1.2 MB", color: "bg-rose-500/15 text-rose-500" },
                  { icon: FileText, name: "Operating Systems — Mid-1", meta: "Previous Paper · 480 KB", color: "bg-sky-500/15 text-sky-500" },
                  { icon: FileText, name: "Computer Networks — Lab Manual", meta: "Lab Manuals · 2.8 MB", color: "bg-amber-500/15 text-amber-500" },
                ].map((f, i) => (
                  <div
                    key={f.name}
                    className="flex items-center gap-3 rounded-xl border bg-background/60 p-3 transition-transform hover:-translate-y-0.5"
                    style={{ transitionDelay: `${i * 30}ms` }}
                  >
                    <div className={`flex size-9 items-center justify-center rounded-lg ring-1 ${f.color}`}>
                      <f.icon className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{f.name}</p>
                      <p className="text-xs text-muted-foreground">{f.meta}</p>
                    </div>
                    <Download className="size-4 text-muted-foreground" />
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ------------------------------------------------ Features */}
      <section id="features" className="py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-sm font-semibold text-primary">Features</p>
            <h2 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
              Everything your campus needs
            </h2>
            <p className="mt-4 text-muted-foreground">
              Built around the way colleges actually work — semesters, sections, subjects and the
              people who keep them running.
            </p>
          </div>

          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((feature, i) => (
              <motion.div
                key={feature.title}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: (i % 4) * 0.06 }}
                className="group rounded-2xl border bg-card p-5 transition-all hover:-translate-y-1 hover:border-primary/30 hover:shadow-lg"
              >
                <div className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500/15 to-violet-500/15 text-primary ring-1 ring-primary/20 transition-colors group-hover:from-indigo-500 group-hover:to-violet-600 group-hover:text-white">
                  <feature.icon className="size-5" />
                </div>
                <h3 className="mt-4 font-semibold">{feature.title}</h3>
                <p className="mt-1.5 text-sm text-muted-foreground">{feature.text}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------ Roles */}
      <section id="roles" className="border-y bg-muted/30 py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-sm font-semibold text-primary">Made for every role</p>
            <h2 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
              One portal, three ways to use it
            </h2>
          </div>

          <div className="mt-12 grid gap-5 lg:grid-cols-3">
            {ROLES.map((role, i) => (
              <motion.div
                key={role.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.45, delay: i * 0.08 }}
                className="flex flex-col rounded-2xl border bg-card p-6 shadow-sm transition-all hover:-translate-y-1 hover:shadow-lg"
              >
                <div className={`flex size-12 items-center justify-center rounded-xl bg-gradient-to-br ring-1 ${role.color}`}>
                  <role.icon className="size-6" />
                </div>
                <h3 className="mt-4 text-lg font-bold">{role.title}</h3>
                <ul className="mt-4 space-y-2.5">
                  {role.points.map((point) => (
                    <li key={point} className="flex items-start gap-2 text-sm text-muted-foreground">
                      <Check className="mt-0.5 size-4 shrink-0 text-emerald-500" />
                      {point}
                    </li>
                  ))}
                </ul>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------ How it works */}
      <section id="how" className="py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-sm font-semibold text-primary">How it works</p>
            <h2 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
              Up and running in minutes
            </h2>
          </div>

          <div className="mt-12 grid gap-5 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <motion.div
                key={s.step}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: i * 0.08 }}
                className="relative rounded-2xl border bg-card p-6"
              >
                <span className="bg-gradient-to-br from-indigo-500 to-violet-600 bg-clip-text text-5xl font-extrabold text-transparent">
                  {s.step}
                </span>
                <h3 className="mt-4 font-semibold">{s.title}</h3>
                <p className="mt-1.5 text-sm text-muted-foreground">{s.text}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------ CTA */}
      <section className="relative overflow-hidden border-t py-20">
        <div className="pointer-events-none absolute -top-24 left-1/2 size-96 -translate-x-1/2 rounded-full bg-indigo-500/20 blur-3xl" />
        <div className="relative mx-auto max-w-3xl px-4 text-center sm:px-6">
          <Library className="mx-auto size-10 text-primary" />
          <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">
            Ready to find everything you need?
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
            Sign in with your roll number and open your college&apos;s document library. Your default
            password is your roll number — change it after your first login.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Button
              size="lg"
              render={<Link href="/login" />}
              className="bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-lg shadow-indigo-500/25 hover:from-indigo-500 hover:to-violet-500"
            >
              Sign in to the portal <ArrowRight className="size-4" />
            </Button>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------ Footer */}
      <footer className="border-t bg-muted/30">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:px-6">
          <div className="flex items-center gap-2">
            <div className="flex size-7 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 text-white">
              <GraduationCap className="size-4" />
            </div>
            <span className="font-medium text-foreground">College Document Portal</span>
          </div>
          <p>Built for students, CRs and administrators.</p>
        </div>
      </footer>
    </div>
  );
}
