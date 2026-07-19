FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    PYTHON_BIN=/opt/venv/bin/python \
    PATH=/opt/venv/bin:$PATH \
    PORT=10000

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates fonts-dejavu-core gosu python3 python3-venv tini \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json requirements.txt ./
RUN python3 -m venv /opt/venv \
    && pip install --no-cache-dir --requirement requirements.txt \
    && npm ci --include=dev \
    && npm cache clean --force

COPY . .
RUN chmod +x /app/docker-entrypoint.sh \
    && npm run build \
    && npm test \
    && npm prune --omit=dev

EXPOSE 10000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:' + (process.env.PORT || 10000) + '/api/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--", "/app/docker-entrypoint.sh"]
CMD ["node", "server.js"]
