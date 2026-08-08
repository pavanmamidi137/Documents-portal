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

/** The 8 portal-wide themes (keys must match the backend SITE_THEMES set). */
export const SITE_THEMES: SiteTheme[] = [
  { key: "orange", label: "Orange", description: "Brand orange #F56D14", colors: ["#f56d14", "#ff9a4d"] },
  { key: "purple", label: "Purple", description: "Violet purple #9D4ACC", colors: ["#9d4acc", "#b96fe0"] },
  { key: "gray", label: "Gray", description: "Neutral slate gray", colors: ["#64748b", "#94a3b8"] },
  { key: "light-green", label: "Light Green", description: "Fresh lime green", colors: ["#22c55e", "#4ade80"] },
  { key: "dark-green", label: "Dark Green", description: "Deep forest green", colors: ["#15803d", "#16a34a"] },
  { key: "brown", label: "Brown", description: "Warm dark brown", colors: ["#7c4a24", "#a16207"] },
  { key: "pink", label: "Pink", description: "Bright pink", colors: ["#db2777", "#ec4899"] },
  { key: "dark-pink", label: "Dark Pink", description: "Deep magenta pink", colors: ["#be185d", "#db2777"] },
];

const STORAGE_KEY = "portal_site_theme";

/** The theme applied when nothing is stored server-side (matches the base :root CSS). */
export const DEFAULT_THEME_KEY = "orange";

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
  if (key === DEFAULT_THEME_KEY) root.removeAttribute("data-site-theme");
  else root.setAttribute("data-site-theme", key);
  try {
    localStorage.setItem(STORAGE_KEY, key);
  } catch {
    /* private mode */
  }
}

function readCachedTheme(): string {
  if (typeof window === "undefined") return DEFAULT_THEME_KEY;
  try {
    const cached = localStorage.getItem(STORAGE_KEY) || "";
    // Ignore stale keys from older theme sets (e.g. "flame", "default").
    return SITE_THEMES.some((t) => t.key === cached) ? cached : DEFAULT_THEME_KEY;
  } catch {
    return DEFAULT_THEME_KEY;
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
        // The backend already falls back to the default, but guard anyway.
        const safe = SITE_THEMES.some((t) => t.key === data.theme)
          ? data.theme
          : DEFAULT_THEME_KEY;
        appliedRef.current = safe;
        applyTheme(safe);
        setThemeState(safe);
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
