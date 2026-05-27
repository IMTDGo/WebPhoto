# ── Stage 1: install production dependencies ──────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# ── Stage 2: final image ───────────────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app

# Copy dependencies from stage 1
COPY --from=deps /app/node_modules ./node_modules

# Copy application source (excludes files listed in .dockerignore)
COPY . .

# Ensure the upload directory exists at runtime
RUN mkdir -p upload

# Non-root user for security
RUN addgroup -S webphoto && adduser -S webphoto -G webphoto
RUN chown -R webphoto:webphoto /app
USER webphoto

EXPOSE 3000
ENV NODE_ENV=production

CMD ["node", "server.js"]
