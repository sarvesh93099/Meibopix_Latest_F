# Build the frontend bundle and serve it from Nginx in production.
FROM node:20-alpine AS build

WORKDIR /app/frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

ARG VITE_API_URL=
ENV VITE_API_URL=$VITE_API_URL

COPY frontend ./
RUN npm run build

FROM nginx:1.27-alpine

COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html

EXPOSE 80
