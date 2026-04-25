# Notification service doesn't expose HTTP port
FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev

FROM node:18-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/node_modules ./node_modules
COPY src ./src
COPY package.json .

CMD ["node", "src/index.js"]
