FROM node:22-slim

WORKDIR /app

RUN apt-get update && apt-get install -y poppler-utils && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm install

COPY . .

EXPOSE 8000

CMD ["node", "--import", "tsx", "src/index.ts"]
