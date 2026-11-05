FROM node:22-bookworm-slim

# ffmpeg untuk konversi, python3 untuk yt-dlp; Node.js sekaligus jadi JS runtime yt-dlp
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg python3 ca-certificates curl \
 && curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
 && chmod a+rx /usr/local/bin/yt-dlp \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN mkdir -p /app/data && chown -R node:node /app/data

ENV NODE_ENV=production PORT=3000 DATA_DIR=/app/data DOWNLOAD_DIR=/tmp/soundwave
EXPOSE 3000
VOLUME ["/app/data"]
USER node
CMD ["node", "server.js"]
