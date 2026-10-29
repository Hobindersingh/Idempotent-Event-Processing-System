FROM node:20-slim AS build
WORKDIR /srv
COPY package*.json ./
RUN npm install
COPY . .
ARG VITE_API_URL=http://localhost:8000
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

FROM node:20-slim
WORKDIR /srv
RUN npm install -g serve
COPY --from=build /srv/dist ./dist
EXPOSE 5173
# Bind explicitly to 0.0.0.0 (not just the port) -- some `serve` versions
# default to a loopback-only host, which would be unreachable through
# Docker's port mapping even though the container itself looks healthy.
CMD ["serve", "-s", "dist", "-l", "tcp://0.0.0.0:5173"]
