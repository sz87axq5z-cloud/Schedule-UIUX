# Node.js 20をベースに使用
FROM node:20-slim

# 作業ディレクトリを設定
WORKDIR /app

# package.jsonをコピーして依存関係をインストール
COPY backend/package*.json ./backend/
RUN cd backend && npm install --production

# アプリケーションのソースをコピー
COPY backend/ ./backend/
COPY index.html ./
COPY privacy.html ./
COPY googlead8afeaec97ce92e.html ./
COPY styles/ ./styles/
COPY scripts/ ./scripts/

# Cloud Runはポート8080を使用
ENV PORT=8080

# バックエンドディレクトリに移動して起動
WORKDIR /app/backend

# アプリケーションを起動
CMD ["node", "index.js"]
