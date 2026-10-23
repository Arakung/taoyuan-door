# 桃园谷开门服务 · 容器镜像（零依赖，无需 npm install）
#
# 构建：docker build -f http-service/deploy/Dockerfile -t taoyuan-open .
# 或直接用 http-service/deploy/docker-compose.yml
FROM node:22-alpine

WORKDIR /app

# 只拷运行需要的两个文件，镜像 ~50MB
COPY http-service/core.mjs http-service/serve.mjs ./
COPY http-service/config.example.json ./config.example.json

# 凭据通过挂载覆盖：-v /host/config.json:/app/config.json:ro
ENV PORT=8787 \
    HOST=0.0.0.0 \
    NODE_ENV=production

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "serve.mjs"]
