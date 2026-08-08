"use client";

import axios, { type AxiosError, type InternalAxiosRequestConfig } from "axios";

import type { Resume } from "@/lib/types";
import { getErrorMessage } from "@/lib/utils";

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api";

const ACCESS_KEY = "portal_access";
const REFRESH_KEY = "portal_refresh";

export function getTokens(): { access: string | null; refresh: string | null } {
  if (typeof window === "undefined") return { access: null, refresh: null };
  return {
    access: localStorage.getItem(ACCESS_KEY),
    refresh: localStorage.getItem(REFRESH_KEY),
  };
}

export function setTokens(access: string, refresh?: string) {
  localStorage.setItem(ACCESS_KEY, access);
  if (refresh) localStorage.setItem(REFRESH_KEY, refresh);
}

export function clearTokens() {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

const api = axios.create({ baseURL: API_URL });

api.interceptors.request.use((config) => {
  const { access } = getTokens();
  if (access) config.headers.Authorization = `Bearer ${access}`;
  return config;
});

let refreshing: Promise<string | null> | null = null;

async function tryRefresh(): Promise<string | null> {
  const { refresh } = getTokens();
  if (!refresh) return null;
  try {
    const res = await axios.post(`${API_URL}/auth/refresh/`, { refresh });
    const nextAccess = res.data.access as string;
    setTokens(nextAccess, res.data.refresh || refresh);
    return nextAccess;
  } catch {
    clearTokens();
    return null;
  }
}

interface RetriableConfig extends InternalAxiosRequestConfig {
  _retry?: boolean;
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as RetriableConfig | undefined;
    const url = original?.url ?? "";
    const isAuthRoute = url.includes("/auth/login") || url.includes("/auth/refresh");
    if (error.response?.status === 401 && original && !original._retry && !isAuthRoute) {
      original._retry = true;
      const access = await (refreshing ??= tryRefresh().finally(() => (refreshing = null)));
      if (access) {
        original.headers.Authorization = `Bearer ${access}`;
        return api(original);
      }
      if (typeof window !== "undefined") {
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- axios interceptor, not a component
        window.location.assign("/login");
      }
    }
    return Promise.reject(error);
  }
);

/** Typed helpers used across the app. */
export const http = {
  get: <T>(url: string, params?: Record<string, unknown>) =>
    api.get<T>(url, { params }).then((r) => r.data),
  post: <T>(url: string, data?: unknown) =>
    api.post<T>(url, data).then((r) => r.data),
  patch: <T>(url: string, data?: unknown) =>
    api.patch<T>(url, data).then((r) => r.data),
  put: <T>(url: string, data?: unknown) =>
    api.put<T>(url, data).then((r) => r.data),
  delete: <T>(url: string) => api.delete<T>(url).then((r) => r.data),
  upload: <T>(url: string, form: FormData, timeout = 120_000) =>
    api
      .post<T>(url, form, {
        headers: { "Content-Type": "multipart/form-data" },
        timeout,
      })
      .then((r) => r.data),
  /** Fetch a file as a blob (used to open previews without auth headers). */
  blob: (url: string, params?: Record<string, unknown>) =>
    api.get<Blob>(url, { params, responseType: "blob" }).then((r) => r.data),
  /** Fetch a file as a blob and trigger a browser download. */
  download: async (url: string, params?: Record<string, unknown>, filename?: string) => {
    const res = await api.get(url, { params, responseType: "blob" });
    const blobUrl = URL.createObjectURL(res.data);
    const anchor = document.createElement("a");
    anchor.href = blobUrl;
    anchor.download = filename ?? "download.csv";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(blobUrl);
  },
};

/**
 * Open a resume PDF in a new tab.
 *
 * The file streams through the API (with the auth header) so the browser
 * receives the correct PDF content type - Cloudinary raw URLs make the
 * built-in viewer fail with "Failed to load PDF document".
 * Returns false when the preview could not be loaded.
 */
export async function openResumeInNewTab(resume: { id: number }): Promise<string | null> {
  try {
    const blob = await http.blob(`/resumes/${resume.id}/preview/`);
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener");
    // Never revoked: the PDF viewer may lazy-fetch ranges while the tab is
    // open, and files are capped at 10MB so memory cost is negligible.
    return null;
  } catch (error) {
    return getErrorMessage(error);
  }
}

/**
 * Fetch the signed-in student's resume, or null when none is uploaded yet
 * (the backend returns 404 in that case).
 */
export async function fetchMyResume(): Promise<Resume | null> {
  try {
    return await http.get<Resume>("/resumes/mine/");
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 404) return null;
    throw error;
  }
}

export default api;
