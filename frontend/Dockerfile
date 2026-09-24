FROM nginx:1.27-alpine
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html app.js app.css i18n.js /usr/share/nginx/html/
COPY frontend/config.js /usr/share/nginx/html/config.js
EXPOSE 80
