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

/** A theme stored as ``custom:#RRGGBB`` — any color picked in the admin picker. */
export const CUSTOM_THEME_PREFIX = "custom:";
const CUSTOM_STYLE_ID = "placemate-custom-theme";

// ---------------------------------------------------------------------------
// Color helpers (used to derive the full palette from one picked hex)
// ---------------------------------------------------------------------------

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Blend ``hex`` toward ``other`` by ``ratio`` (0 = unchanged, 1 = other). */
function mix(hex: string, other: string, ratio: number): string {
  const [r1, g1, b1] = hexToRgb(hex);
  const [r2, g2, b2] = hexToRgb(other);
  return rgbToHex(
    r1 + (r2 - r1) * ratio,
    g1 + (g2 - g1) * ratio,
    b1 + (b2 - b1) * ratio
  );
}

/** Perceived luminance 0-1 — drives whether foreground text is light or dark. */
function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

function contrastText(hex: string): string {
  return luminance(hex) > 0.6 ? "#1f2937" : "#ffffff";
}

export function isCustomTheme(key: string): boolean {
  if (!key.startsWith(CUSTOM_THEME_PREFIX)) return false;
  return /^#[0-9a-fA-F]{6}$/.test(key.slice(CUSTOM_THEME_PREFIX.length));
}

/** Extract the raw hex (e.g. "#ff5500") from a theme key, if custom. */
export function customThemeHex(key: string): string | null {
  if (!isCustomTheme(key)) return null;
  return key.slice(CUSTOM_THEME_PREFIX.length).toLowerCase();
}

/**
 * Build the light + dark CSS variable blocks for an arbitrary color, mirroring
 * the structure of the preset themes in globals.css. The rules are keyed off
 * ``data-site-theme="custom:#hex"`` so they only apply while that theme is set.
 */
function buildCustomStyle(hex: string): string {
  const h = hex.toLowerCase();
  const light = "#ffffff";
  const dark = "#000000";
  return `
:root[data-site-theme="${CUSTOM_THEME_PREFIX}${h}"] {
  --primary: ${h};
  --primary-foreground: ${contrastText(h)};
  --ring: ${mix(h, light, 0.15)};
  --accent: ${mix(h, light, 0.88)};
  --accent-foreground: ${mix(h, dark, 0.35)};
  --sidebar-primary: ${h};
  --sidebar-primary-foreground: ${contrastText(h)};
  --chart-1: ${h};
  --chart-2: ${mix(h, light, 0.25)};
  --chart-3: ${mix(h, dark, 0.2)};
  --chart-4: ${mix(h, light, 0.55)};
  --chart-5: ${mix(h, dark, 0.4)};
}
.dark[data-site-theme="${CUSTOM_THEME_PREFIX}${h}"] {
  --primary: ${mix(h, light, 0.2)};
  --primary-foreground: ${mix(h, dark, 0.5)};
  --ring: ${mix(h, light, 0.1)};
  --accent: ${mix(h, dark, 0.75)};
  --accent-foreground: ${mix(h, light, 0.5)};
  --sidebar-primary: ${mix(h, light, 0.2)};
  --sidebar-primary-foreground: ${mix(h, dark, 0.5)};
  --chart-1: ${mix(h, light, 0.2)};
  --chart-2: ${mix(h, light, 0.45)};
  --chart-3: ${mix(h, light, 0.1)};
  --chart-4: ${mix(h, dark, 0.15)};
  --chart-5: ${mix(h, light, 0.35)};
}`;
}

// ---------------------------------------------------------------------------
// Theme application
// ---------------------------------------------------------------------------

function applyTheme(key: string) {
  const root = document.documentElement;
  const customStyle = document.getElementById(CUSTOM_STYLE_ID) as HTMLStyleElement | null;

  if (isCustomTheme(key)) {
    // Custom color: inject a stylesheet with the derived palette and flag it
    // via data-site-theme so the rules above take precedence over the base CSS.
    const hex = key.slice(CUSTOM_THEME_PREFIX.length).toLowerCase();
    root.setAttribute("data-site-theme", key);
    let style = customStyle;
    if (!style) {
      style = document.createElement("style");
      style.id = CUSTOM_STYLE_ID;
      document.head.appendChild(style);
    }
    style.textContent = buildCustomStyle(hex);
    try {
      localStorage.setItem(STORAGE_KEY, key);
    } catch {
      /* private mode */
    }
    return;
  }

  // A custom:-prefixed key that failed hex validation (e.g. tampered storage)
  // must never be applied as a junk attribute — clear the theme instead.
  if (key.startsWith(CUSTOM_THEME_PREFIX)) {
    customStyle?.remove();
    root.removeAttribute("data-site-theme");
    try {
      localStorage.setItem(STORAGE_KEY, DEFAULT_THEME_KEY);
    } catch {
      /* private mode */
    }
    return;
  }

  // Preset (or default): drop the custom stylesheet and use the globals.css rules.
  customStyle?.remove();
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
    if (isCustomTheme(cached)) return cached.toLowerCase();
    // Ignore stale keys from older theme sets (e.g. "flame", "default").
    return SITE_THEMES.some((t) => t.key === cached) ? cached : DEFAULT_THEME_KEY;
  } catch {
    return DEFAULT_THEME_KEY;
  }
}

interface SiteThemeContextValue {
  theme: string;
  themes: SiteTheme[];
  loading: boolean;
  /** Persist the theme site-wide (super admin only). Optimistic apply + revert on failure. */
  setTheme: (key: string) => Promise<void>;
}

const SiteThemeContext = createContext<SiteThemeContextValue | undefined>(undefined);

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
        const safe =
          isCustomTheme(data.theme) ||
          SITE_THEMES.some((t) => t.key === data.theme)
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
