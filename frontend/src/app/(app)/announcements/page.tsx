"use client";

import { AnnouncementsPage } from "@/components/announcements/announcements-page";
import { LoadingPage } from "@/components/loading-page";
import { useMetaData } from "@/lib/use-meta";

export default function AnnouncementsRoute() {
  const { data: meta, isLoading } = useMetaData();
  if (isLoading || !meta) return <LoadingPage />;
  return <AnnouncementsPage meta={meta} />;
}
