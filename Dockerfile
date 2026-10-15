FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN npm install -g pnpm@11.19.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY index.html vite.config.js ./
COPY web ./web
RUN pnpm build

FROM node:24-bookworm-slim
WORKDIR /app
RUN npm install -g pnpm@11.19.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile
COPY server ./server
COPY --from=build /app/dist ./dist
ENV HOST=0.0.0.0 PORT=80 DATA_DIR=/tmp/waiqi-runtime \
    DEPLOYMENT_TARGET=wechat-cloudrun DB_DRIVER=mysql AUDIO_STORAGE=cos \
    ALLOW_DEV_LOGIN=false PRIVACY_POLICY_CONFIRMED=false CONTENT_SAFETY_PROVIDER=wechat-cloudrun \
    NODE_EXTRA_CA_CERTS=/app/cert/certificate.crt
EXPOSE 80
CMD ["node", "server/index.mjs"]
