FROM node:16-alpine

# metadata
ARG VCS_REF=master
ARG BUILD_DATE=""
ARG REGISTRY_PATH=docker.io/paritytech
ARG PROJECT_NAME=""

LABEL io.parity.image.authors="cicd-team@parity.io" \
    io.parity.image.vendor="Parity Technologies" \
    io.parity.image.title="${REGISTRY_PATH}/${PROJECT_NAME}" \
    io.parity.image.description="Substrate Tip bot" \
    io.parity.image.source="https://github.com/paritytech/${PROJECT_NAME}/blob/${VCS_REF}/Dockerfile" \
    io.parity.image.documentation="https://github.com/paritytech/${PROJECT_NAME}/blob/${VCS_REF}/README.md" \
    io.parity.image.revision="${VCS_REF}" \
    io.parity.image.created="${BUILD_DATE}"

RUN apk -U upgrade --no-cache

WORKDIR /usr/src/app

COPY package.json ./
COPY yarn.lock ./
COPY babel.config.json ./
COPY tsconfig.json ./
COPY src/ ./src

RUN yarn install --frozen-lockfile

RUN yarn build

# Purge the devDeps required for building
RUN yarn install --production

ENV NODE_ENV="production"

CMD [ "node", "dist/bot.js" ]
