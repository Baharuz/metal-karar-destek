FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY migrations ./migrations
COPY scripts ./scripts
COPY tests ./tests
USER node
EXPOSE 3001
CMD ["npm", "start"]
