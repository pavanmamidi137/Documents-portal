"use client";

import { RoleGuard } from "@/components/role-guard";
import { StudentsPage } from "@/components/students/students-page";
import { LoadingPage } from "@/components/loading-page";
import { useMetaData } from "@/lib/use-meta";

export default function CrStudentsPage() {
  const { data: meta, isLoading } = useMetaData();
  if (isLoading || !meta) return <LoadingPage />;
  return (
    <RoleGuard roles={["CR"]}>
      <StudentsPage meta={meta} isCr />
    </RoleGuard>
  );
}
