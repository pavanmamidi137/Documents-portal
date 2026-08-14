"use client";

import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  Briefcase,
  GraduationCap,
  Handshake,
  Mail,
  Phone,
  Sparkles,
  UserRound,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { http } from "@/lib/api";
import type { PublicPortfolio } from "@/lib/types";
import { initials } from "@/lib/utils";

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border bg-card p-5 shadow-sm">
      <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        <Icon className="size-4 text-primary" /> {title}
      </h2>
      <div className="mt-3">{children}</div>
    </section>
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
    <div className="min-h-screen bg-background">
      {/* Minimal top bar — logo returns home */}
      <header className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
        <Link href="/" className="flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-primary/60 text-primary-foreground shadow-md shadow-primary/30">
            <Handshake className="size-4" />
          </div>
          <span className="text-sm font-semibold">PlaceMate</span>
        </Link>
        <span className="text-[11px] text-muted-foreground">Portfolio</span>
      </header>

      <main className="mx-auto max-w-3xl px-4 pb-16">
        {isLoading && (
          <div className="space-y-6 pt-8">
            <div className="flex flex-col items-center gap-4 rounded-2xl border bg-card p-8 text-center shadow-sm">
              <Skeleton className="size-24 rounded-full" />
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-4 w-64" />
            </div>
            <Skeleton className="h-32 w-full rounded-2xl" />
            <Skeleton className="h-32 w-full rounded-2xl" />
          </div>
        )}

        {!isLoading && (isError || !data) && (
          <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-dashed bg-card/50 px-6 py-24 text-center">
            <div className="flex size-14 items-center justify-center rounded-2xl bg-muted">
              <UserRound className="size-7 text-muted-foreground" />
            </div>
            <div>
              <p className="font-semibold">Portfolio not found</p>
              <p className="mt-1 text-sm text-muted-foreground">
                This link is either incorrect or the portfolio has been unpublished.
              </p>
            </div>
            <Link href="/" className="text-sm font-medium text-primary hover:underline">
              ← Back to PlaceMate
            </Link>
          </div>
        )}

        {!isLoading && data && (
          <div className="space-y-6 pt-8">
            {/* Hero */}
            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
              className="relative overflow-hidden rounded-2xl border bg-card p-8 text-center shadow-sm"
            >
              <div className="pointer-events-none absolute -top-24 -right-24 size-72 rounded-full bg-gradient-to-br from-primary/25 to-primary/5 blur-3xl" />
              {data.owner_avatar_url ? (
                <img
                  src={data.owner_avatar_url}
                  alt={data.owner_name}
                  className="mx-auto size-24 rounded-full border-4 border-primary/20 object-cover shadow-lg"
                />
              ) : (
                <div className="mx-auto flex size-24 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/60 text-2xl font-bold text-primary-foreground shadow-lg">
                  {initials(data.owner_name)}
                </div>
              )}
              <h1 className="mt-4 text-2xl font-bold tracking-tight">{data.owner_name}</h1>
              {data.headline && (
                <p className="mt-1 text-sm font-medium text-primary">{data.headline}</p>
              )}
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                {data.owner_email && (
                  <a
                    href={`mailto:${data.owner_email}`}
                    className="flex items-center gap-1.5 rounded-full border bg-muted/40 px-3 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <Mail className="size-3.5" /> {data.owner_email}
                  </a>
                )}
                {data.owner_phone && (
                  <a
                    href={`tel:${data.owner_phone}`}
                    className="flex items-center gap-1.5 rounded-full border bg-muted/40 px-3 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <Phone className="size-3.5" /> {data.owner_phone}
                  </a>
                )}
              </div>
            </motion.div>

            {data.about && (
              <Section icon={Sparkles} title="About">
                <p className="text-sm leading-relaxed text-foreground/90">{data.about}</p>
              </Section>
            )}

            {data.skills.length > 0 && (
              <Section icon={Sparkles} title="Skills">
                <div className="flex flex-wrap gap-2">
                  {data.skills.map((skill) => (
                    <Badge key={skill} variant="secondary" className="rounded-full px-3 py-1">
                      {skill}
                    </Badge>
                  ))}
                </div>
              </Section>
            )}

            <div className="grid gap-6 md:grid-cols-2">
              {data.experience && (
                <Section icon={Briefcase} title="Experience">
                  <p className="text-sm leading-relaxed whitespace-pre-line text-foreground/90">{data.experience}</p>
                </Section>
              )}
              {data.education && (
                <Section icon={GraduationCap} title="Education">
                  <p className="text-sm leading-relaxed text-foreground/90">{data.education}</p>
                </Section>
              )}
            </div>

            {data.projects && (
              <Section icon={Sparkles} title="Projects">
                <p className="text-sm leading-relaxed whitespace-pre-line text-foreground/90">{data.projects}</p>
              </Section>
            )}

            {(data.custom_sections ?? []).length > 0 && (
              <div className="space-y-6">
                {(data.custom_sections ?? []).map((section, i) =>
                  section.title ? (
                    <Section key={i} icon={Sparkles} title={section.title}>
                      <p className="text-sm leading-relaxed whitespace-pre-line text-foreground/90">{section.content}</p>
                    </Section>
                  ) : (
                    <div key={i} className="rounded-2xl border bg-card p-5 shadow-sm">
                      <p className="text-sm leading-relaxed whitespace-pre-line text-foreground/90">{section.content}</p>
                    </div>
                  )
                )}
              </div>
            )}

            <p className="pt-2 text-center text-[11px] text-muted-foreground">
              Powered by PlaceMate — campus documents, resumes &amp; placements
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
