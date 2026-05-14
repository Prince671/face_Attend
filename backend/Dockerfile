FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

RUN mkdir -p uploads/profiles uploads/captures

EXPOSE 5000

CMD ["sh", "-c", "node scripts/seedAdmin.js && node server.js"]
