import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/providers/providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "PlaceMate | Campus Documents, Resumes & Placements",
  description:
    "PlaceMate — campus documents, AI resume reviews and placement drives for your college. Upload, browse and share notes, question banks, lab manuals, resumes and drives.",
  // PWA: point the browser at the manifest, icons and iOS metadata. The
  // service worker (public/sw.js) is registered by next-pwa at runtime.
  manifest: "/manifest.webmanifest",
  applicationName: "PlaceMate",
  appleWebApp: {
    capable: true,
    title: "PlaceMate",
    statusBarStyle: "default",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192x192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512x512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
};

export const viewport: Viewport = {
  themeColor: "#f56d14",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      {/* suppressHydrationWarning on body too: browser extensions (e.g. the
          cz-shortcut listener) inject attributes like cz-shortcut-listen onto
          <body> before React hydrates, which would otherwise log a mismatch. */}
      <body
        suppressHydrationWarning
        className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
