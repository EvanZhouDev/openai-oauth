From node:20-alpine 

WORKDIR /app

RUN npm install -g openai-oauth@latest

EXPOSE 10531

VOLUME ["/root/.codex"]
CMD ["npx","openai-oauth","--host","0.0.0.0","--port","10531"]
