"use client";

import { useAuth } from "@/lib/auth";
import { useMetaData } from "@/lib/use-meta";
import { DocumentsManagement } from "@/components/documents/documents-management";
import { StudentBrowser } from "@/components/documents/student-browser";
import { LoadingPage } from "@/components/loading-page";

export default function DocumentsPage() {
  const { user } = useAuth();
  const { data: meta, isLoading } = useMetaData();

  if (isLoading || !meta) return <LoadingPage />;

  if (user?.is_student) {
    return <StudentBrowser />;
  }
  return <DocumentsManagement meta={meta} isCr={user?.is_cr} />;
}
