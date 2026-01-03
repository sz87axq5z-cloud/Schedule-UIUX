/**
 * スケジュール管理アプリ - バックエンドサーバー
 *
 * このファイルがサーバーの入り口（メインファイル）です
 */

// 必要なパッケージを読み込む
const express = require('express');
const cors = require('cors');
const session = require('express-session');
const path = require('path');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

// Firebase接続
const { db } = require('./config/firebase');

// ログ機能
const { logger, requestLogger } = require('./config/logger');

// ========================================
// レート制限設定（DoS攻撃・ブルートフォース対策）
// ========================================

// 一般的なAPIレート制限（1分間に100リクエストまで）
const generalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1分間
  max: 100, // 最大100リクエスト
  message: {
    success: false,
    error: 'リクエストが多すぎます。しばらく待ってから再試行してください。'
  },
  standardHeaders: true,
  legacyHeaders: false
});

// 認証関連のレート制限（より厳しく：1分間に20リクエストまで）
const authLimiter = rateLimit({
  windowMs: 60 * 1000, // 1分間
  max: 20, // 最大20リクエスト
  message: {
    success: false,
    error: '認証リクエストが多すぎます。しばらく待ってから再試行してください。'
  },
  standardHeaders: true,
  legacyHeaders: false
});

// LINE連携コード生成のレート制限（ブルートフォース対策：1分間に5回まで）
const linkCodeLimiter = rateLimit({
  windowMs: 60 * 1000, // 1分間
  max: 5, // 最大5リクエスト
  message: {
    success: false,
    error: '連携コードの生成リクエストが多すぎます。しばらく待ってから再試行してください。'
  },
  standardHeaders: true,
  legacyHeaders: false
});

// スケジュール作成のレート制限（1分間に30リクエストまで）
const createScheduleLimiter = rateLimit({
  windowMs: 60 * 1000, // 1分間
  max: 30, // 最大30リクエスト
  message: {
    success: false,
    error: 'スケジュール作成リクエストが多すぎます。しばらく待ってから再試行してください。'
  },
  standardHeaders: true,
  legacyHeaders: false
});

// Expressアプリを作成
const app = express();

// プロキシを信頼（ngrok経由でHTTPSを使用するため）
app.set('trust proxy', 1);

// ミドルウェアの設定
// - cors: フロントエンドからのアクセスを許可
// - express.json: JSONデータを受け取れるようにする
// CORS設定（環境変数APP_URLがあればそれも許可）
const allowedOrigins = [
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'http://localhost:3000',
  'http://localhost:8080',
  'https://adaline-prefigurative-kirstie.ngrok-free.dev'
];
if (process.env.APP_URL) {
  allowedOrigins.push(process.env.APP_URL);
}
app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));

// LINE Webhookは生のボディが必要なので、express.jsonをスキップ
// リクエストサイズ制限を追加（DoS対策）
app.use((req, res, next) => {
  if (req.path === '/api/notifications/line/webhook') {
    next();
  } else {
    express.json({ limit: '10kb' })(req, res, next);
  }
});

// URLエンコードされたデータにもサイズ制限
app.use(express.urlencoded({ limit: '10kb', extended: true }));

// セッション設定（30分間の非活動でログアウト）
const SESSION_TTL = 30 * 60 * 1000; // 30分
const isProduction = process.env.NODE_ENV === 'production';
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key-change-in-production',
  resave: false,
  saveUninitialized: false,
  rolling: true, // リクエストごとにセッション有効期限をリセット
  cookie: {
    secure: isProduction, // 本番(HTTPS)のみtrue、ローカル(HTTP)はfalse
    httpOnly: true,
    sameSite: isProduction ? 'none' : 'lax', // ローカルはlax、本番はnone
    maxAge: SESSION_TTL // 30分間
  }
}));

// リクエストログ（全リクエストを記録）
app.use(requestLogger);

// ルート（API）の読み込み
logger.info('Loading routes...');
const authRoutes = require('./routes/auth');
const scheduleRoutes = require('./routes/schedules');
const notificationRoutes = require('./routes/notifications');
const photoRoutes = require('./routes/photos');
logger.info('All routes loaded');

// APIエンドポイントの設定（レート制限付き）
// 認証関連（厳しめのレート制限）
app.use('/api/auth', authLimiter, authRoutes);

// スケジュール関連（一般レート制限 + 作成は個別制限）
app.post('/api/schedules', createScheduleLimiter); // 作成は厳しく
app.post('/api/schedules/bulk', createScheduleLimiter); // 一括作成も厳しく
app.use('/api/schedules', generalLimiter, scheduleRoutes);

// 通知関連
app.post('/api/notifications/line/link-code', linkCodeLimiter); // 連携コード生成は厳しく
app.use('/api/notifications', generalLimiter, notificationRoutes);

// 写真関連（ビフォーアフター）
app.use('/api/photos', generalLimiter, photoRoutes);

// フロントエンドの静的ファイルを配信
const frontendPath = path.join(__dirname, '..'); // 親ディレクトリ（フロントエンド）
app.use(express.static(frontendPath));

// ========================================
// ヘルスチェック（実際に接続を確認）
// ========================================

// 簡易ヘルスチェック（ロードバランサー用）
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// 詳細ヘルスチェック（監視用）
app.get('/api/status', async (req, res) => {
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    checks: {}
  };

  // Firebase接続チェック
  try {
    const testRef = db.collection('_health').doc('check');
    await testRef.set({ timestamp: new Date() });
    health.checks.firebase = { status: 'ok' };
  } catch (error) {
    health.checks.firebase = { status: 'error', message: error.message };
    health.status = 'degraded';
  }

  // LINE API設定チェック
  health.checks.lineApi = {
    status: process.env.LINE_CHANNEL_ACCESS_TOKEN ? 'configured' : 'not_configured'
  };

  // Google API設定チェック
  health.checks.googleApi = {
    status: process.env.GOOGLE_CLIENT_ID ? 'configured' : 'not_configured'
  };

  const statusCode = health.status === 'ok' ? 200 : 503;
  res.status(statusCode).json(health);
});

// ========================================
// グローバルエラーハンドリング
// ========================================

// 404エラー
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'エンドポイントが見つかりません',
    path: req.path
  });
});

// エラーハンドラー（統一フォーマット）
app.use((err, req, res, next) => {
  logger.error('Unhandled error', {
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method
  });

  res.status(err.status || 500).json({
    success: false,
    error: process.env.NODE_ENV === 'production'
      ? 'サーバーエラーが発生しました'
      : err.message
  });
});

// ========================================
// サーバー起動とグレースフルシャットダウン
// ========================================

const PORT = process.env.PORT || 3001;
const server = app.listen(PORT, () => {
  logger.info(`Server started on port ${PORT}`);
});

// グレースフルシャットダウン
let isShuttingDown = false;

function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info(`${signal} received, starting graceful shutdown...`);

  // 新しいリクエストの受付を停止
  server.close((err) => {
    if (err) {
      logger.error('Error during shutdown', { error: err.message });
      process.exit(1);
    }

    logger.info('Server closed successfully');
    process.exit(0);
  });

  // 30秒後に強制終了
  setTimeout(() => {
    logger.warn('Forced shutdown after timeout');
    process.exit(1);
  }, 30000);
}

// シグナルハンドラー登録
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// 未処理のエラーをキャッチ
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { error: err.message, stack: err.stack });
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection', { reason: String(reason) });
});
