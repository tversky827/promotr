# Audicents — application image.
#
# One image runs both processes: `npm start` serves the web application and
# `npm run worker` runs background jobs. They are the same code and the same
# dependencies, so building twice would only invite them to drift apart.
#
# Development dependencies stay in the final image on purpose: the Prisma CLI
# applies migrations and the seed script runs through it. For a production
# image, add `npm prune --omit=dev` after the build and drop the seed step.

FROM node:22-slim AS build
WORKDIR /app

# Prisma's query engine needs OpenSSL to talk to Postgres over TLS.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# NEXT_PUBLIC_* values are inlined at build time, so the host the application
# will be reached on has to be known here rather than at startup. Override with
# --build-arg when deploying somewhere other than localhost.
ARG NEXT_PUBLIC_APP_URL=http://localhost:3000
ARG NEXT_PUBLIC_TRACKING_URL=http://localhost:3000
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_TRACKING_URL=$NEXT_PUBLIC_TRACKING_URL

RUN npx prisma generate && npm run build

FROM node:22-slim AS runtime
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PORT=3000

COPY --from=build /app ./

EXPOSE 3000
CMD ["npm", "start"]
