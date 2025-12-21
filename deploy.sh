#!/bin/bash
# Cloud Runへのデプロイスクリプト

echo "🚀 Cloud Runにデプロイ中..."

cd /Users/a81807/Desktop/開発/スケジュール20251115

~/google-cloud-sdk/bin/gcloud run deploy schedule-app \
  --source . \
  --region asia-northeast1 \
  --project=schedule-app-2025-da39c \
  --quiet

echo ""
echo "✅ デプロイ完了！"
echo "📱 URL: https://schedule-app-127450379214.asia-northeast1.run.app"
