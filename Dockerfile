FROM node:22-alpine
WORKDIR /app
COPY package.json .
COPY server.js app.js admin.js styles.css index.html admin.html ./
ENV NODE_ENV=production
ENV DATA_DIR=/data
EXPOSE 3000
CMD ["node", "server.js"]
