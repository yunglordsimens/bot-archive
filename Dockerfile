FROM node:22-slim
# yt-dlp as the standalone build so `yt-dlp -U` works inside the container; gallery-dl for TikTok slideshows.
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip ca-certificates curl \
 && pip3 install --break-system-packages --no-cache-dir gallery-dl \
 && curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
 && chmod a+rwx /usr/local/bin/yt-dlp \
 && apt-get purge -y curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
CMD ["npm", "start"]
