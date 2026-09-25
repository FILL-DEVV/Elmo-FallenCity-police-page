FROM node:18-slim

WORKDIR /app

# Install dependencies first (better layer caching — only re-runs npm ci
# when package.json/package-lock.json actually change).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY index.js ./

# Fly.io's http_service expects the app to listen on this exact port
# (see fly.toml's internal_port) — set here so index.js's
# process.env.PORT || 3000 resolves to it without needing a code change.
ENV PORT=8080
EXPOSE 8080

CMD ["npm", "start"]
