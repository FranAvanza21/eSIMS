FROM nginx:alpine
COPY esims.html /usr/share/nginx/html/index.html
COPY config.example.js /usr/share/nginx/html/config.example.js
