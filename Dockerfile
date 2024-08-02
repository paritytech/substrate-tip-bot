FROM node:22-alpine as builder

WORKDIR /usr/src/app

COPY package.json yarn.lock .yarnrc.yml tsconfig.json ./
COPY .yarn/ ./.yarn/
COPY .papi/ ./.papi/
RUN yarn install --immutable
COPY src/ ./src

RUN yarn build

FROM node:22-slim

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

WORKDIR /usr/src/app

COPY --from=builder /usr/src/app/package.json ./
COPY --from=builder /usr/src/app/dist ./dist/
COPY --from=builder /usr/src/app/node_modules ./node_modules/
COPY --from=builder /usr/src/app/.papi ./papi/

ENV NODE_ENV="production"

CMD [ "node", "dist/bot.js" ]
