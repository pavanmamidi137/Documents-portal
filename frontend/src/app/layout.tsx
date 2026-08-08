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
  title: "Placify | College Documents Portal",
  description:
    "Placify — placement drives, documents and resumes for your college. Upload, browse and share notes, question banks, lab manuals and more.",
  // PWA: point the browser at the manifest, icons and iOS metadata. The
  // service worker (public/sw.js) is registered by next-pwa at runtime.
  manifest: "/manifest.webmanifest",
  applicationName: "Placify",
  appleWebApp: {
    capable: true,
    title: "Placify",
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
      <body
        className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
