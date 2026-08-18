# PlaceMate frontend - Next.js 16 app (Node runtime, JWT + axios client).
# Used by Render Docker builds. For AIC Cloud, see the root Dockerfile.
FROM node:22-alpine

ENV NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000

WORKDIR /app

# No lockfile in the repo, so a plain npm install (same as the Cloudflare /
# Render build commands). Dependencies layer is cached until package.json changes.
COPY package.json ./
RUN npm install

# Application code, then the production build (next build --webpack).
COPY . .
RUN npm run build

EXPOSE 3000

# next start honours the PORT injected by the platform.
CMD ["sh", "-c", "npm run start -- -p ${PORT:-3000}"]
