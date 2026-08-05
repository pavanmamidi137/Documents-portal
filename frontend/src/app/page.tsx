"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { useAuth } from "@/lib/auth";
import { Loader2 } from "lucide-react";

export default function HomePage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading) {
      router.replace(user ? "/dashboard" : "/login");
    }
  }, [loading, user, router]);

  return (
    <div className="flex h-screen items-center justify-center bg-background">
      <Loader2 className="size-8 animate-spin text-primary" />
    </div>
  );
}
