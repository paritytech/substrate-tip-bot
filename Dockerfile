FROM node:14-alpine

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
