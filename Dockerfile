# --- Étape 1 : build de l'application Vite ---
FROM node:22-alpine AS build
WORKDIR /app

# On copie d'abord les manifestes pour profiter du cache Docker
COPY package.json package-lock.json* pnpm-lock.yaml* ./
RUN npm install

# Puis le reste du code et on build
COPY . .
RUN npm run build

# --- Étape 2 : serveur web statique (nginx) ---
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
