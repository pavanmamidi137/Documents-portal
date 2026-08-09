"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { useTheme } from "next-themes";
import {
  ArrowRight,
  BellRing,
  BookOpen,
  Briefcase,
  Check,
  Download,
  FileText,
  FolderOpen,
  GraduationCap,
  Handshake,
  Layers,
  LayoutDashboard,
  Moon,
  Rocket,
  Search,
  Share2,
  ShieldCheck,
  Sun,
  UploadCloud,
  UserRoundCheck,
  Users,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { initials } from "@/lib/utils";

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
    text: "New documents, drives, resumes and admin replies land in the bell instantly — nothing slips through.",
  },
  {
    icon: Users,
    title: "Students & CR management",
    text: "Add students one by one or bulk-import via CSV. Promote CRs, reset passwords and manage every account.",
  },
  {
    icon: Briefcase,
    title: "Placement drives",
    text: "Company drives with eligibility, apply links and an AI assistant that answers which drives match you.",
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
      "Upload your resume and check your AI star rating",
      "See which placement drives match your profile",
    ],
  },
  {
    icon: GraduationCap,
    title: "Class Representatives (CR)",
    color: "from-violet-500/20 to-purple-500/10 text-violet-600 dark:text-violet-400",
    points: [
      "Upload documents & assignments for your section",
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
      "Control faculty portal access — resume and/or placement",
      "Full audit logs, AI credit usage and college-wide analytics",
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
    text: "Students browse by semester, category and subject. CRs and admins upload notes, assignments and drives.",
  },
  {
    step: "03",
    title: "Share & grow",
    text: "Share documents across sections, get AI resume reviews and track placement drives — all in one place.",
  },
];

function InstallAppButton() {
  const [installPrompt, setInstallPrompt] = useState<Event | null>(null);

  // Listen for the browser's "installable PWA" event so the button can trigger
  // a native app install (Android / Windows / supported browsers).
  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  if (!installPrompt) {
    return null;
  }

  return (
    <Button
      size="lg"
      variant="outline"
      onClick={() => {
        const promptEvent = installPrompt as unknown as {
          prompt: () => Promise<void>;
          userChoice: Promise<{ outcome: string }>;
        };
        void promptEvent.prompt();
        setInstallPrompt(null);
      }}
    >
      <Download className="size-4" /> Install as App
    </Button>
  );
}

export default function HomePage() {
  const { user } = useAuth();
  const { theme, setTheme } = useTheme();

  // Logged-in visitors can browse the public page too - they get a "Profile"
  // button (leading to their dashboard) instead of the Sign in button.

  return (
    <div className="min-h-screen overflow-x-hidden bg-background">
      {/* ------------------------------------------------ Navbar */}
      <header className="sticky top-0 z-40 border-b bg-background/75 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/60 text-primary-foreground shadow-md shadow-primary/25">
              <Handshake className="size-5" />
            </div>
            <div className="leading-tight">
              <p className="text-sm font-bold tracking-tight">PlaceMate</p>
              <p className="text-[11px] text-muted-foreground">Campus documents, placements &amp; more</p>
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
            {user ? (
              <Link
                href="/dashboard"
                title={user?.full_name ?? "Go to dashboard"}
                className="group relative size-9 overflow-hidden rounded-full ring-2 ring-primary/40 transition-all hover:ring-primary hover:shadow-md hover:shadow-primary/20"
              >
                {user?.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={user.avatar_url}
                    alt={user?.full_name ?? "Profile"}
                    className="size-full object-cover"
                  />
                ) : (
                  <span className="flex size-full items-center justify-center bg-gradient-to-br from-indigo-500/20 to-violet-500/20 text-sm font-bold text-indigo-600 dark:text-indigo-400 transition-colors group-hover:from-primary/25 group-hover:to-primary/10 group-hover:text-primary">
                    {initials(user?.full_name ?? "?")}
                  </span>
                )}
              </Link>
            ) : (
              <Button render={<Link href="/login" />} variant="outline">
                Sign in <ArrowRight className="size-4" />
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* ------------------------------------------------ Hero */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute -top-40 left-1/2 size-[42rem] -translate-x-1/2 rounded-full bg-primary/15 blur-3xl" />
        <div className="pointer-events-none absolute top-48 -right-40 size-96 rounded-full bg-primary/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 -left-32 size-96 rounded-full bg-primary/5 blur-3xl" />

        <div className="relative mx-auto max-w-6xl px-4 pt-20 pb-16 text-center sm:px-6 sm:pt-28">
          <motion.div {...fadeUp} transition={{ duration: 0.5 }}>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
              <Handshake className="size-3.5" /> PlaceMate — your campus hub
            </span>
          </motion.div>

          <motion.h1
            {...fadeUp}
            transition={{ duration: 0.5, delay: 0.08 }}
            className="mx-auto mt-6 max-w-3xl text-4xl leading-tight font-extrabold tracking-tight sm:text-6xl"
          >
            Every note, resume &amp; placement drive.{" "}
            <span className="bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
              One place.
            </span>
          </motion.h1>

          <motion.p
            {...fadeUp}
            transition={{ duration: 0.5, delay: 0.16 }}
            className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground"
          >
            PlaceMate brings together study documents, resumes with AI reviews, and placement drives
            for your whole college — organized by semester, subject and section, with role-based
            access for students, CRs, faculty and admins.
          </motion.p>

          <motion.div
            {...fadeUp}
            transition={{ duration: 0.5, delay: 0.24 }}
            className="mt-9 flex flex-wrap items-center justify-center gap-3"
          >
            {user ? (
              <Button
                size="lg"
                render={<Link href="/dashboard" />}
                className="bg-primary text-primary-foreground shadow-lg shadow-primary/25 transition-all hover:brightness-110"
              >
                <LayoutDashboard className="size-4" /> Go to dashboard
              </Button>
            ) : (
              <Button
                size="lg"
                render={<Link href="/login" />}
                className="bg-primary text-primary-foreground shadow-lg shadow-primary/25 transition-all hover:brightness-110"
              >
                Get started <ArrowRight className="size-4" />
              </Button>
            )}
            <Button size="lg" variant="outline" render={<a href="#features" />}>
              Explore features
            </Button>
            <InstallAppButton />
          </motion.div>

          <motion.div
            {...fadeUp}
            transition={{ duration: 0.5, delay: 0.32 }}
            className="mx-auto mt-12 flex max-w-3xl flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-muted-foreground"
          >
            <span className="flex items-center gap-1.5">
              <Check className="size-4 text-emerald-500" /> PDF, PPT, DOCX &amp; TXT
            </span>
            <span className="flex items-center gap-1.5">
              <Check className="size-4 text-emerald-500" /> AI resume reviews
            </span>
            <span className="flex items-center gap-1.5">
              <Check className="size-4 text-emerald-500" /> Placement drives
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
            <p className="text-sm font-semibold text-primary">What is PlaceMate?</p>
            <h2 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
              A shared campus platform built for your college
            </h2>
            <p className="mt-4 text-muted-foreground">
              Instead of notes scattered across WhatsApp groups, resumes lost in mail threads and
              drives forwarded from person to person — everything lives in one organized, searchable
              place. Each branch and section sees exactly what&apos;s meant for them, and faculty track
              resumes &amp; drives without chasing anyone.
            </p>
            <ul className="mt-6 space-y-3">
              {[
                "Documents stored once and shared across sections without re-uploading",
                "Resumes reviewed by faculty with an AI star rating and ATS report",
                "Placement drives with eligibility, apply links and an AI assistant",
                "CRs keep their section's library up to date, admins keep the whole college in check",
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
            <div className="pointer-events-none absolute -inset-6 rounded-3xl bg-gradient-to-br from-primary/10 to-primary/5 blur-2xl" />
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
                  { icon: UserRoundCheck, name: "My Resume — 4.5 ★ AI rating", meta: "Reviewed by faculty", color: "bg-violet-500/15 text-violet-500" },
                  { icon: Briefcase, name: "TCS Drive — Software Engineer", meta: "Apply by 15 Aug · 6-8 LPA", color: "bg-teal-500/15 text-teal-500" },
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
              Built around the way colleges actually work — semesters, sections, subjects, resumes
              and placements.
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
                <div className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary/15 to-primary/5 text-primary ring-1 ring-primary/20 transition-colors group-hover:from-primary group-hover:to-primary/60 group-hover:text-primary-foreground">
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
              One portal, four ways to use it
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

            {/* Faculty */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.45, delay: 0.24 }}
              className="flex flex-col rounded-2xl border bg-card p-6 shadow-sm transition-all hover:-translate-y-1 hover:shadow-lg"
            >
              <div className="flex size-12 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500/20 to-orange-500/10 text-amber-600 ring-1 ring-amber-500/20 dark:text-amber-400">
                <Rocket className="size-6" />
              </div>
              <h3 className="mt-4 text-lg font-bold">Faculty</h3>
              <ul className="mt-4 space-y-2.5">
                <li className="flex items-start gap-2 text-sm text-muted-foreground">
                  <Check className="mt-0.5 size-4 shrink-0 text-emerald-500" />
                  Review student resumes in your branch — with one-click mark-all-reviewed
                </li>
                <li className="flex items-start gap-2 text-sm text-muted-foreground">
                  <Check className="mt-0.5 size-4 shrink-0 text-emerald-500" />
                  Track who has uploaded a resume and who hasn&apos;t
                </li>
                <li className="flex items-start gap-2 text-sm text-muted-foreground">
                  <Check className="mt-0.5 size-4 shrink-0 text-emerald-500" />
                  Post and manage placement drives (if the admin gives you access)
                </li>
                <li className="flex items-start gap-2 text-sm text-muted-foreground">
                  <Check className="mt-0.5 size-4 shrink-0 text-emerald-500" />
                  Message the admin when you need help or changes
                </li>
              </ul>
            </motion.div>
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
                <span className="bg-gradient-to-br from-primary to-primary/60 bg-clip-text text-5xl font-extrabold text-transparent">
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
        <div className="pointer-events-none absolute -top-24 left-1/2 size-96 -translate-x-1/2 rounded-full bg-primary/20 blur-3xl" />
        <div className="relative mx-auto max-w-3xl px-4 text-center sm:px-6">
          <Handshake className="mx-auto size-10 text-primary" />
          <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">
            Ready to bring your campus together?
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
            Sign in with your roll number and open your college&apos;s PlaceMate. Your default password
            is your roll number — change it after your first login.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            {user ? (
              <Button
                size="lg"
                render={<Link href="/dashboard" />}
                className="bg-primary text-primary-foreground shadow-lg shadow-primary/25 transition-all hover:brightness-110"
              >
                <LayoutDashboard className="size-4" /> Go to dashboard
              </Button>
            ) : (
              <Button
                size="lg"
                render={<Link href="/login" />}
                className="bg-primary text-primary-foreground shadow-lg shadow-primary/25 transition-all hover:brightness-110"
              >
                Sign in to PlaceMate <ArrowRight className="size-4" />
              </Button>
            )}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------ Footer */}
      <footer className="border-t bg-muted/30">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:px-6">
          <div className="flex items-center gap-2">
            <div className="flex size-7 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-primary/60 text-primary-foreground">
              <Handshake className="size-4" />
            </div>
            <span className="font-medium text-foreground">PlaceMate</span>
          </div>
          <p>Built for students, CRs, faculty and administrators.</p>
        </div>
      </footer>
    </div>
  );
}
