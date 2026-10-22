FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip ca-certificates curl \
 && pip3 install --break-system-packages --no-cache-dir gallery-dl \
 && curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
 && chmod a+rx /usr/local/bin/yt-dlp \
 && apt-get purge -y curl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --include=optional && npm i --no-save tsx
COPY src ./src
CMD ["npx", "tsx", "src/index.ts"]
