"use client";

import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowRight,
  Briefcase,
  GraduationCap,
  Handshake,
  Mail,
  Phone,
  Rocket,
  Sparkles,
  UserRound,
} from "lucide-react";

import { http } from "@/lib/api";
import type { PublicPortfolio } from "@/lib/types";
import { initials } from "@/lib/utils";

const fadeUp = {
  hidden: { opacity: 0, y: 18 },
  show: { opacity: 1, y: 0 },
};

function Section({
  icon: Icon,
  title,
  children,
  index = 0,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children: React.ReactNode;
  index?: number;
}) {
  return (
    <motion.section
      variants={fadeUp}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.45, delay: index * 0.05 }}
      className="group relative overflow-hidden rounded-3xl border border-border/60 bg-card/80 p-6 shadow-lg shadow-foreground/5 backdrop-blur-sm transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-xl hover:shadow-primary/5 sm:p-7"
    >
      <div className="pointer-events-none absolute -top-16 -right-16 size-40 rounded-full bg-gradient-to-br from-primary/15 to-transparent opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-100" />
      <h2 className="flex items-center gap-2.5 text-xs font-bold tracking-[0.18em] text-muted-foreground uppercase">
        <span className="flex size-7 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-primary/60 text-primary-foreground shadow-md shadow-primary/30">
          <Icon className="size-3.5" />
        </span>
        {title}
      </h2>
      <div className="mt-4">{children}</div>
    </motion.section>
  );
}

function SectionSkeleton() {
  return (
    <div className="rounded-3xl border bg-card/80 p-7 shadow-lg">
      <div className="h-4 w-32 animate-pulse rounded-full bg-muted" />
      <div className="mt-4 h-4 w-full animate-pulse rounded bg-muted" />
      <div className="mt-2 h-4 w-3/4 animate-pulse rounded bg-muted" />
    </div>
  );
}

export default function PublicPortfolioPage() {
  const { slug } = useParams<{ slug: string }>();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["portfolio", "public", slug],
    queryFn: () => http.get<PublicPortfolio>(`/portfolio/public/${slug}`),
    retry: false,
  });

  return (
    <div className="relative min-h-screen overflow-x-clip bg-background">
      {/* Ambient gradient mesh */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-40 left-1/2 h-[32rem] w-[48rem] -translate-x-1/2 rounded-full bg-gradient-to-br from-primary/25 via-primary/10 to-transparent blur-3xl" />
        <div className="absolute top-1/3 -left-40 size-96 rounded-full bg-indigo-500/10 blur-3xl" />
        <div className="absolute top-1/2 -right-40 size-96 rounded-full bg-violet-500/10 blur-3xl" />
        <div
          className="absolute inset-0 opacity-[0.35]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 1px 1px, hsl(var(--border)) 1px, transparent 0)",
            backgroundSize: "36px 36px",
            maskImage: "radial-gradient(ellipse 80% 60% at 50% 0%, black 60%, transparent 100%)",
            WebkitMaskImage: "radial-gradient(ellipse 80% 60% at 50% 0%, black 60%, transparent 100%)",
          }}
        />
      </div>

      {/* Sticky nav */}
      <header className="sticky top-0 z-40 border-b border-border/50 bg-background/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3.5">
          <Link href="/" className="group flex items-center gap-2.5">
            <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/60 text-primary-foreground shadow-md shadow-primary/30 transition-transform group-hover:scale-105">
              <Handshake className="size-4.5" />
            </div>
            <span className="text-sm font-bold tracking-tight">PlaceMate</span>
          </Link>
          <span className="flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-[11px] font-semibold tracking-wide text-primary uppercase">
            <Sparkles className="size-3" /> Portfolio
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 pb-20">
        {/* Loading */}
        {isLoading && (
          <div className="space-y-6 pt-10">
            <div className="relative overflow-hidden rounded-[2rem] border bg-card/80 p-10 text-center shadow-xl">
              <div className="mx-auto size-28 animate-pulse rounded-full bg-muted" />
              <div className="mx-auto mt-5 h-7 w-56 animate-pulse rounded-full bg-muted" />
              <div className="mx-auto mt-3 h-4 w-72 animate-pulse rounded-full bg-muted/70" />
            </div>
            <SectionSkeleton />
            <SectionSkeleton />
          </div>
        )}

        {/* Not found */}
        {!isLoading && (isError || !data) && (
          <div className="flex flex-col items-center justify-center gap-5 rounded-[2rem] border border-dashed bg-card/50 px-6 py-24 text-center backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex size-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 text-primary"
            >
              <UserRound className="size-8" />
            </motion.div>
            <div>
              <p className="text-xl font-bold tracking-tight">Portfolio not found</p>
              <p className="mt-1.5 text-sm text-muted-foreground">
                This link is either incorrect or the portfolio has been unpublished.
              </p>
            </div>
            <Link
              href="/"
              className="group flex items-center gap-1.5 rounded-full bg-gradient-to-r from-primary to-primary/70 px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/25 transition-all hover:shadow-xl hover:shadow-primary/35"
            >
              Back to PlaceMate
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>
        )}

        {/* Portfolio */}
        {!isLoading && data && (
          <div className="space-y-7 pt-10">
            {/* Hero */}
            <motion.section
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, ease: "easeOut" }}
              className="relative overflow-hidden rounded-[2rem] border border-border/60 bg-card/80 p-8 text-center shadow-xl shadow-foreground/5 backdrop-blur-sm sm:p-12"
            >
              <div className="pointer-events-none absolute -top-28 -right-28 size-80 rounded-full bg-gradient-to-br from-primary/25 to-transparent blur-3xl" />
              <div className="pointer-events-none absolute -bottom-32 -left-24 size-72 rounded-full bg-violet-500/15 blur-3xl" />

              {/* Avatar with animated gradient ring */}
              <div className="relative mx-auto w-fit">
                <div className="absolute -inset-1.5 animate-[spin_8s_linear_infinite] rounded-full bg-[conic-gradient(from_0deg,var(--primary),#8b5cf6,#ec4899,var(--primary))] opacity-80 blur-[2px]" />
                <div className="relative rounded-full bg-background p-1">
                  {data.owner_avatar_url ? (
                    <img
                      src={data.owner_avatar_url}
                      alt={data.owner_name}
                      className="size-28 rounded-full object-cover sm:size-32"
                    />
                  ) : (
                    <div className="flex size-28 items-center justify-center rounded-full bg-gradient-to-br from-primary via-primary/70 to-violet-500 text-3xl font-bold text-primary-foreground sm:size-32">
                      {initials(data.owner_name)}
                    </div>
                  )}
                </div>
              </div>

              <motion.h1
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.15 }}
                className="mt-6 text-3xl font-extrabold tracking-tight sm:text-4xl"
              >
                {data.owner_name}
              </motion.h1>

              {data.headline && (
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.22 }}
                  className="mx-auto mt-2 max-w-xl bg-gradient-to-r from-primary via-fuchsia-500 to-violet-500 bg-clip-text text-base font-semibold text-transparent sm:text-lg"
                >
                  {data.headline}
                </motion.p>
              )}

              <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">
                {data.owner_email && (
                  <a
                    href={`mailto:${data.owner_email}`}
                    className="flex items-center gap-1.5 rounded-full border border-border/70 bg-background/70 px-4 py-1.5 text-xs font-medium text-muted-foreground shadow-sm backdrop-blur transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:text-primary"
                  >
                    <Mail className="size-3.5" /> {data.owner_email}
                  </a>
                )}
                {data.owner_phone && (
                  <a
                    href={`tel:${data.owner_phone}`}
                    className="flex items-center gap-1.5 rounded-full border border-border/70 bg-background/70 px-4 py-1.5 text-xs font-medium text-muted-foreground shadow-sm backdrop-blur transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:text-primary"
                  >
                    <Phone className="size-3.5" /> {data.owner_phone}
                  </a>
                )}
              </div>
            </motion.section>

            {/* About */}
            {data.about && (
              <Section icon={Sparkles} title="About" index={1}>
                <p className="text-[15px] leading-relaxed text-foreground/90">{data.about}</p>
              </Section>
            )}

            {/* Skills */}
            {data.skills.length > 0 && (
              <Section icon={Rocket} title="Skills" index={2}>
                <div className="flex flex-wrap gap-2">
                  {data.skills.map((skill, i) => (
                    <motion.span
                      key={skill}
                      initial={{ opacity: 0, scale: 0.9 }}
                      whileInView={{ opacity: 1, scale: 1 }}
                      viewport={{ once: true }}
                      transition={{ delay: i * 0.03 }}
                      className="cursor-default rounded-full border border-primary/20 bg-gradient-to-br from-primary/10 to-violet-500/10 px-3.5 py-1.5 text-xs font-semibold text-foreground shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:from-primary/20"
                    >
                      {skill}
                    </motion.span>
                  ))}
                </div>
              </Section>
            )}

            {/* Experience / Education */}
            {(data.experience || data.education) && (
              <div className="grid gap-7 md:grid-cols-2">
                {data.experience && (
                  <Section icon={Briefcase} title="Experience" index={3}>
                    <p className="text-sm leading-relaxed whitespace-pre-line text-foreground/90">{data.experience}</p>
                  </Section>
                )}
                {data.education && (
                  <Section icon={GraduationCap} title="Education" index={4}>
                    <p className="text-sm leading-relaxed text-foreground/90">{data.education}</p>
                  </Section>
                )}
              </div>
            )}

            {/* Projects */}
            {data.projects && (
              <Section icon={Rocket} title="Projects" index={5}>
                <p className="text-sm leading-relaxed whitespace-pre-line text-foreground/90">{data.projects}</p>
              </Section>
            )}

            {/* Custom sections */}
            {(data.custom_sections ?? []).length > 0 && (
              <div className="space-y-7">
                {(data.custom_sections ?? []).map((section, i) =>
                  section.title ? (
                    <Section key={i} icon={Sparkles} title={section.title} index={6 + i}>
                      <p className="text-sm leading-relaxed whitespace-pre-line text-foreground/90">{section.content}</p>
                    </Section>
                  ) : (
                    <motion.div
                      key={i}
                      variants={fadeUp}
                      initial="hidden"
                      whileInView="show"
                      viewport={{ once: true }}
                      className="rounded-3xl border border-border/60 bg-card/80 p-6 shadow-lg shadow-foreground/5 backdrop-blur-sm"
                    >
                      <p className="text-sm leading-relaxed whitespace-pre-line text-foreground/90">{section.content}</p>
                    </motion.div>
                  )
                )}
              </div>
            )}

            {/* Footer */}
            <motion.footer
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              className="flex flex-col items-center gap-2 pt-4 text-center"
            >
              <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/60 text-primary-foreground shadow-md shadow-primary/30">
                <Handshake className="size-4.5" />
              </div>
              <p className="text-xs font-medium text-muted-foreground">
                Powered by <span className="font-bold text-foreground">PlaceMate</span> — campus documents, resumes &amp; placements
              </p>
            </motion.footer>
          </div>
        )}
      </main>
    </div>
  );
}
