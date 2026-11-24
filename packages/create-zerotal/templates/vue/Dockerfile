# Dockerfile — build and run the app in one image.
#
#   docker build -t {{name}} .
#   docker run -p 3000:3000 --env-file .env.production {{name}}
#
# The image needs APP_KEY (and HEALTH_KEY, for the health check) at run time, never at
# build time — pass them with --env-file or your platform's secrets, not ARG or ENV here.
FROM oven/bun:1 AS base
WORKDIR /app

# Install deps first for better layer caching
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# App source, then the production frontend bundle
COPY . .
RUN bun run build

ENV APP_ENV=production
EXPOSE 3000

# /health answers only with the key in production (see config/app.ts). The image has no
# curl, so Bun makes the request.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD bun -e "const r = await fetch('http://localhost:3000/health', { headers: { 'X-Health-Key': process.env.HEALTH_KEY ?? '' } }); process.exit(r.ok ? 0 : 1)"

# Run migrations then serve (use your platform's release step for migrate in real setups)
CMD bun zt migrate && bun zt serve --port=3000
