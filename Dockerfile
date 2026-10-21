# node:sqlite is unflagged from Node 22.13, so older images cannot start the app.
FROM node:24-slim

ENV NODE_ENV=production
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

# SQLite and generated PDFs live here; mount a volume over it.
ENV DATA_DIR=/app/data
VOLUME ["/app/data"]

EXPOSE 12000
CMD ["node", "src/server.js"]
