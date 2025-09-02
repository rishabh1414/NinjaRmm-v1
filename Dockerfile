# ---- Build/runtime (single stage, small) ----
FROM node:20-alpine

# Optional: set timezone/locale if you want IST logs
# RUN apk add --no-cache tzdata && cp /usr/share/zoneinfo/Asia/Kolkata /etc/localtime

# App dir
WORKDIR /usr/src/app

# Install only production deps (faster, smaller). If you use dev deps at runtime, remove --omit=dev
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# Copy source
COPY server.js ./
# If you have other files (routes, utils, etc.) copy them too:
# COPY src/ ./src

# Env defaults (Cloud Run will override PORT)
ENV NODE_ENV=production \
    PORT=8080

# Cloud Run sends traffic to $PORT; EXPOSE is optional but nice for local run
EXPOSE 8080

# Start the app
CMD ["node", "server.js"]