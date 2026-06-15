
FROM oven/bun:1-alpine AS build

WORKDIR /app

COPY package.json bun.lock* ./
COPY src ./src
COPY tsconfig.json ./

RUN bun install --production

# Compile to a single native binary.
#   --minify            : strip whitespace / shorten identifiers
#   --bytecode          : pre-compile to bytecode for faster cold start
#   --compile-exec-argv : pass --smol to the embedded runtime
RUN bun build --compile --minify --bytecode \
    --compile-exec-argv="--smol" \
    ./src/index.ts \
    --outfile character-bot


FROM oven/bun:1-alpine AS runtime
RUN apk add --no-cache tini
WORKDIR /app
COPY --from=build /app/character-bot ./character-bot

COPY config.example.toml ./config.toml

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:3000/healthz > /dev/null 2>&1 || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["./character-bot"]
