# aetherPet · 生产镜像（Docker Compose 自托管路径 b）
# 多阶段构建：
#   1) deps：安装依赖（锁定 lockfile）
#   2) build：next build（产出 .next/standalone）
#   3) runtime：node:20-alpine + standalone + assets/migrations（轻量 ~200MB）
#
# 说明：
#   - standalone 已含 migration SQL 与素材包（见 next.config.ts outputFileTracingIncludes）
#   - .env 不进入镜像：运行时通过 docker-compose 注入环境变量
#   - 日志走 stdout（PM2/容器采集），应用同时写 logs/（挂载卷可选）
# 构建：docker build -f docker/Dockerfile -t aetherpet:latest .
FROM node:20-alpine AS deps
WORKDIR /app
# 仅复制锁文件以利用缓存
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.json next.config.ts postcss.config.mjs eslint.config.mjs ./
COPY src ./src
COPY public ./public
COPY docker ./docker
RUN npx next build

FROM node:20-alpine AS runtime
ENV NODE_ENV=production

# 时区（与宝塔 MySQL 对齐，UTC+8）
RUN apk add --no-cache tzdata \
  && cp /usr/share/zoneinfo/Asia/Shanghai /etc/localtime \
  && echo "Asia/Shanghai" > /etc/timezone

# 非 root 运行（安全）
RUN addgroup -S app && adduser -S app -G app
WORKDIR /app

COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public

# standalone 产物内的 server.js 默认监听 3000
ENV PORT=3000
EXPOSE 3000

USER app
CMD ["node", "server.js"]