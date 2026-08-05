"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { useAuth } from "@/lib/auth";
import type { Role } from "@/lib/types";

export function RoleGuard({
  roles,
  children,
}: {
  roles: Role[];
  children: React.ReactNode;
}) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && user && !roles.includes(user.role)) {
      router.replace("/dashboard");
    }
  }, [loading, user, roles, router]);

  if (loading || !user) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="size-7 animate-spin text-primary" />
      </div>
    );
  }

  if (!roles.includes(user.role)) return null;

  return <>{children}</>;
}
