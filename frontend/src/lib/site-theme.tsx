"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { http } from "@/lib/api";

export interface SiteTheme {
  key: string;
  label: string;
  description: string;
  /** Two accent colors used to render the picker swatch. */
  colors: [string, string];
}

/** The 7 portal-wide themes (keys must match the backend SITE_THEMES set). */
export const SITE_THEMES: SiteTheme[] = [
  { key: "default", label: "Indigo", description: "Classic indigo & violet", colors: ["#6366f1", "#8b5cf6"] },
  { key: "flame", label: "Flame", description: "Orange on black & white", colors: ["#f97316", "#ea580c"] },
  { key: "ocean", label: "Ocean", description: "Blue on black & white", colors: ["#0ea5e9", "#2563eb"] },
  { key: "forest", label: "Forest", description: "Green & emerald tones", colors: ["#10b981", "#059669"] },
  { key: "royal", label: "Royal", description: "Purple & violet tones", colors: ["#8b5cf6", "#7c3aed"] },
  { key: "rose", label: "Rose", description: "Pink & crimson tones", colors: ["#f43f5e", "#e11d48"] },
  { key: "graphite", label: "Graphite", description: "Slate & black tones", colors: ["#64748b", "#334155"] },
];

const STORAGE_KEY = "portal_site_theme";

interface SiteThemeContextValue {
  theme: string;
  themes: SiteTheme[];
  loading: boolean;
  /** Persist the theme site-wide (super admin only). Optimistic apply + revert on failure. */
  setTheme: (key: string) => Promise<void>;
}

const SiteThemeContext = createContext<SiteThemeContextValue | undefined>(undefined);

function applyTheme(key: string) {
  const root = document.documentElement;
  if (key === "default") root.removeAttribute("data-site-theme");
  else root.setAttribute("data-site-theme", key);
  try {
    localStorage.setItem(STORAGE_KEY, key);
  } catch {
    /* private mode */
  }
}

function readCachedTheme(): string {
  if (typeof window === "undefined") return "default";
  try {
    return localStorage.getItem(STORAGE_KEY) || "default";
  } catch {
    return "default";
  }
}

export function SiteThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<string>(readCachedTheme);
  const [loading, setLoading] = useState(true);
  const appliedRef = useRef(theme);

  useEffect(() => {
    // Instant paint from cache, then sync with the server (public endpoint).
    applyTheme(theme);
    let active = true;

    http
      .get<{ theme: string }>("/site-theme/")
      .then((data) => {
        if (!active || !data.theme) return;
        appliedRef.current = data.theme;
        applyTheme(data.theme);
        setThemeState(data.theme);
      })
      .catch(() => {
        /* offline — keep cached theme */
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- apply cached theme once on mount
  }, []);

  const setTheme = useCallback(async (key: string) => {
    const previous = appliedRef.current;
    appliedRef.current = key;
    applyTheme(key);
    setThemeState(key);
    try {
      const data = await http.put<{ theme: string }>("/site-theme/", { theme: key });
      if (data.theme) {
        appliedRef.current = data.theme;
        applyTheme(data.theme);
        setThemeState(data.theme);
      }
    } catch (error) {
      appliedRef.current = previous;
      applyTheme(previous);
      setThemeState(previous);
      throw error;
    }
  }, []);

  const value = useMemo(
    () => ({ theme, themes: SITE_THEMES, loading, setTheme }),
    [theme, loading, setTheme]
  );

  return <SiteThemeContext.Provider value={value}>{children}</SiteThemeContext.Provider>;
}

export function useSiteTheme(): SiteThemeContextValue {
  const ctx = useContext(SiteThemeContext);
  if (!ctx) throw new Error("useSiteTheme must be used inside SiteThemeProvider");
  return ctx;
}
