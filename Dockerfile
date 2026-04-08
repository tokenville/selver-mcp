FROM oven/bun:1 AS base

# Install Playwright dependencies for Smart-ID login
RUN apt-get update && apt-get install -y \
    python3 python3-pip \
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 \
    libcups2 libdrm2 libdbus-1-3 libxkbcommon0 \
    libatspi2.0-0 libxcomposite1 libxdamage1 libxfixes3 \
    libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2 \
    && rm -rf /var/lib/apt/lists/*

RUN pip3 install --break-system-packages playwright && \
    playwright install chromium

WORKDIR /app

# Install dependencies
COPY mcp-server/package.json mcp-server/bun.lock* mcp-server/
RUN cd mcp-server && bun install --frozen-lockfile

# Copy source
COPY mcp-server/ mcp-server/
COPY scripts/ scripts/
COPY .env* ./

ENV MCP_TRANSPORT=http
ENV PORT=3000

EXPOSE 3000

CMD ["bun", "run", "mcp-server/server.ts"]
