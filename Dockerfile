FROM node:24-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY bin ./bin
ENV NODE_ENV=production PORT=3000 SQLITE_PATH=/app/data/facilitator.db
VOLUME /app/data
EXPOSE 3000
CMD ["node", "bin/amnt-x402-facilitator.mjs"]
