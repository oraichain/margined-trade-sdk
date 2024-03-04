FROM node:18

WORKDIR /app

COPY patches packages lerna.json package.json tsconfig.json yarn.lock .

RUN yarn global add patch-package typescript tsc ts-node

RUN yarn 

RUN yarn build 
