FROM nginx:alpine

COPY waf/waf.conf /etc/nginx/nginx.conf
COPY nginx/ssl/ /etc/nginx/ssl/

EXPOSE 80 443

CMD ["nginx", "-g", "daemon off;"]
