"use client";

import { useQuery } from "@tanstack/react-query";

import { http } from "@/lib/api";
import type { MetaData } from "@/lib/types";

export function useMetaData() {
  return useQuery({
    queryKey: ["meta"],
    queryFn: () => http.get<MetaData>("/meta/"),
    staleTime: 5 * 60_000,
  });
}
