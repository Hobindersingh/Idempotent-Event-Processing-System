FROM node:20-slim

WORKDIR /srv

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

EXPOSE 8000
CMD ["node", "server.js"]
