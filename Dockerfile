FROM node:12-alpine

RUN apk -U upgrade --no-cache

WORKDIR /usr/src/app

COPY package.json ./
COPY package-lock.json ./
COPY babel.config.json ./
COPY index.js .

RUN npm ci

RUN npm run build

# Purge the devDeps required for building
RUN npm prune --production

ENV NODE_ENV="production"

CMD [ "node", "dist/index.js" ]
