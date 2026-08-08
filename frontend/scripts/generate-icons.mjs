// Generates the PWA app icons from an SVG design using sharp (already
// installed as a transitive dependency of Next.js).
// Run: node scripts/generate-icons.mjs
import { mkdir } from "node:fs/promises";
import sharp from "sharp";

const ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#f56d14"/>
      <stop offset="1" stop-color="#9d4acc"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="112" fill="url(#bg)"/>
  <rect x="178" y="112" width="196" height="240" rx="20" fill="#ffffff" opacity="0.45"/>
  <rect x="150" y="140" width="212" height="240" rx="20" fill="#ffffff"/>
  <path d="M362 140 L362 176 L326 140 Z" fill="#e2e8f0"/>
  <rect x="186" y="240" width="110" height="12" rx="6" fill="#f56d14"/>
  <rect x="186" y="268" width="142" height="12" rx="6" fill="#cbd5e1"/>
  <rect x="186" y="296" width="142" height="12" rx="6" fill="#cbd5e1"/>
  <rect x="186" y="324" width="96" height="12" rx="6" fill="#cbd5e1"/>
</svg>`;

// Full-bleed background + content scaled into the 80% safe zone for maskable.
const MASKABLE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#f56d14"/>
      <stop offset="1" stop-color="#9d4acc"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" fill="url(#bg)"/>
  <g transform="translate(64 64) scale(0.75)">
    <rect x="178" y="112" width="196" height="240" rx="20" fill="#ffffff" opacity="0.45"/>
    <rect x="150" y="140" width="212" height="240" rx="20" fill="#ffffff"/>
    <path d="M362 140 L362 176 L326 140 Z" fill="#e2e8f0"/>
    <rect x="186" y="240" width="110" height="12" rx="6" fill="#f56d14"/>
    <rect x="186" y="268" width="142" height="12" rx="6" fill="#cbd5e1"/>
    <rect x="186" y="296" width="142" height="12" rx="6" fill="#cbd5e1"/>
    <rect x="186" y="324" width="96" height="12" rx="6" fill="#cbd5e1"/>
  </g>
</svg>`;

await mkdir("public/icons", { recursive: true });

await sharp(Buffer.from(ICON)).resize(512, 512).png().toFile("public/icons/icon-512x512.png");
await sharp(Buffer.from(ICON)).resize(192, 192).png().toFile("public/icons/icon-192x192.png");
await sharp(Buffer.from(MASKABLE)).resize(512, 512).png().toFile("public/icons/icon-maskable-512x512.png");
await sharp(Buffer.from(ICON)).resize(180, 180).png().toFile("public/apple-touch-icon.png");

console.log("Icons written to public/icons/ + public/apple-touch-icon.png");
