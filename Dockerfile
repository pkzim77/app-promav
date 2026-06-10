# Backend (Express) para o Cloud Run.
FROM node:20-slim

WORKDIR /app

# Instala só as dependências de produção (sem vite/concurrency).
COPY package*.json ./
RUN npm ci --omit=dev

# Código do servidor.
COPY server ./server

ENV NODE_ENV=production
# O Cloud Run injeta PORT (8080). server/index.js usa process.env.PORT.
EXPOSE 8080

CMD ["node", "server/index.js"]
