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
require('dotenv').config();

// Firebase接続
const { db } = require('./config/firebase');


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
app.use((req, res, next) => {
  if (req.path === '/api/notifications/line/webhook') {
    next();
  } else {
    express.json()(req, res, next);
  }
});

// セッション設定（30分間の非活動でログアウト）
const SESSION_TTL = 30 * 60 * 1000; // 30分
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key-change-in-production',
  resave: false,
  saveUninitialized: false,
  rolling: true, // リクエストごとにセッション有効期限をリセット
  cookie: {
    secure: true, // HTTPS必須（ngrokはHTTPS）
    httpOnly: true,
    sameSite: 'none', // クロスサイトでもCookieを送信（ngrok用）
    maxAge: SESSION_TTL // 30分間
  }
}));

// ルート（API）の読み込み
console.log('Loading auth routes...');
const authRoutes = require('./routes/auth');
console.log('Auth routes loaded');
console.log('Loading schedule routes...');
const scheduleRoutes = require('./routes/schedules');
console.log('Schedule routes loaded');
console.log('Loading notification routes...');
const notificationRoutes = require('./routes/notifications');
console.log('All routes loaded');

// APIエンドポイントの設定
app.use('/api/auth', authRoutes);           // 認証関連: /api/auth/...
app.use('/api/schedules', scheduleRoutes);  // スケジュール関連: /api/schedules/...
app.use('/api/notifications', notificationRoutes); // 通知関連: /api/notifications/...

// フロントエンドの静的ファイルを配信
const frontendPath = path.join(__dirname, '..'); // 親ディレクトリ（フロントエンド）
app.use(express.static(frontendPath));

// APIステータス確認用エンドポイント
app.get('/api/status', (req, res) => {
  res.json({
    message: 'スケジュール管理APIサーバーが動いています',
    status: 'ok',
    firebase: 'connected',
    timestamp: new Date().toISOString()
  });
});

// Firebase接続テスト用エンドポイント
app.get('/api/test-firebase', async (req, res) => {
  try {
    // テスト用のドキュメントを書き込み
    const testRef = db.collection('_test').doc('connection');
    await testRef.set({
      message: 'Firebase接続成功！',
      timestamp: new Date().toISOString()
    });

    // 書き込んだデータを読み取り
    const doc = await testRef.get();

    res.json({
      success: true,
      message: 'Firebaseとの接続に成功しました',
      data: doc.data()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Firebase接続エラー',
      error: error.message
    });
  }
});

// サーバーを起動
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`------------------------------------`);
  console.log(`サーバーが起動しました`);
  console.log(`URL: http://localhost:${PORT}`);
  console.log(`------------------------------------`);
});
