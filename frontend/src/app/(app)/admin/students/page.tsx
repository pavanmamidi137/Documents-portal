"use client";

import { RoleGuard } from "@/components/role-guard";
import { StudentsPage } from "@/components/students/students-page";
import { LoadingPage } from "@/components/loading-page";
import { useMetaData } from "@/lib/use-meta";

export default function AdminStudentsPage() {
  const { data: meta, isLoading } = useMetaData();
  if (isLoading || !meta) return <LoadingPage />;
  return (
    <RoleGuard roles={["SUPER_ADMIN"]}>
      <StudentsPage meta={meta} />
    </RoleGuard>
  );
}
