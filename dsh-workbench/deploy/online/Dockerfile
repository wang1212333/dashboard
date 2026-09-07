FROM node:22-bookworm-slim
WORKDIR /app
COPY --chown=node:node server.mjs feishu.mjs feishu-cli.mjs ./
RUN mkdir /data && chown node:node /data
USER node
ENV HOST=0.0.0.0 PORT=8080 DATA_DIR=/data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:8080'+new URL(process.env.PUBLIC_URL).pathname.replace(/\/$/,'')+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]
