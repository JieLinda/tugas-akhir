FROM node:22-slim

WORKDIR /app

RUN npm install -g pnpm@10

COPY package.json pnpm-lock.yaml ./
RUN pnpm install

COPY . .

EXPOSE 8002

CMD ["node", "--import", "tsx", "src/index.ts"]
