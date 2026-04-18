# --- Stage 1: сборка нативных зависимостей (better-sqlite3 компилируется из C++) ---
FROM node:22-slim AS builder

WORKDIR /app

COPY package*.json ./

# better-sqlite3 требует python3 и build tools для компиляции
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

RUN npm ci --omit=dev

# --- Stage 2: минимальный runtime-образ ---
FROM node:22-slim

WORKDIR /app

# Копируем только то, что нужно в runtime
COPY --from=builder /app/node_modules ./node_modules
COPY src/        ./src/
COPY *.html      ./
COPY package.json ./

# SQLite-база хранится в отдельной папке — монтируется как volume.
# Даём права пользователю node ДО переключения на него.
RUN mkdir -p /data && chown node:node /data

ENV NODE_ENV=production \
    DB_PATH=/data/barter.db \
    PORT=3000

EXPOSE 3000

# Запускаем от непривилегированного пользователя
USER node

CMD ["node", "src/index.js"]
