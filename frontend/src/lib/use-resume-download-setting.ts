"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { http } from "@/lib/api";
import { getErrorMessage } from "@/lib/utils";
import { toast } from "sonner";

/**
 * The admin-controlled "resume downloads" flag.
 *
 * When disabled, the backend rejects resume downloads (and the ZIP) for
 * everyone except the Super Admin, and the UI hides the download buttons.
 * Previewing stays available.
 */
export function useResumeDownloadSetting() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["resume-download-setting"],
    queryFn: () => http.get<{ resume_download_enabled: boolean }>("/resume-download-setting/"),
    staleTime: 60_000,
  });

  const enabled = query.data?.resume_download_enabled ?? true;

  const mutation = useMutation({
    mutationFn: (next: boolean) =>
      http.put<{ resume_download_enabled: boolean }>("/resume-download-setting/", {
        enabled: next,
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(["resume-download-setting"], data);
      toast.success(
        data.resume_download_enabled
          ? "Resume downloads are now allowed."
          : "Resume downloads are now disabled."
      );
    },
    onError: (error: unknown) => toast.error(getErrorMessage(error)),
  });

  const setEnabled = (next: boolean) => mutation.mutate(next);

  return { enabled, setEnabled, isLoading: query.isLoading, isPending: mutation.isPending };
}
