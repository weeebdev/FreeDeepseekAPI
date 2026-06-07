FROM node:20-alpine

WORKDIR /app

COPY package.json server.js client.js ./
COPY scripts ./scripts

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=9655 \
    NON_INTERACTIVE=1 \
    DEEPSEEK_AUTH_PATH=/config/deepseek-auth.json

EXPOSE 9655

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "scripts/docker-healthcheck.js"]

CMD ["node", "server.js"]
