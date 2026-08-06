"use client";

import { useQuery } from "@tanstack/react-query";

import { http } from "@/lib/api";
import type { MetaData } from "@/lib/types";

export function useMetaData() {
  return useQuery({
    queryKey: ["meta"],
    queryFn: () => http.get<MetaData>("/meta/"),
    // Short cache so newly created branches/sections/subjects show up in the
    // upload forms within seconds instead of several minutes.
    staleTime: 30_000,
  });
}
