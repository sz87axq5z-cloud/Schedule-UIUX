/**
 * ログ設定（Winston）
 *
 * - 開発環境: コンソール出力（カラフル）
 * - 本番環境: JSON形式（Cloud Loggingと統合）
 */

const winston = require('winston');

// 環境判定
const isProduction = process.env.NODE_ENV === 'production';

// ログフォーマット
const devFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.colorize(),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaStr = Object.keys(meta).length ? JSON.stringify(meta) : '';
    return `${timestamp} [${level}] ${message} ${metaStr}`;
  })
);

const prodFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.json()
);

// ロガーを作成
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug'),
  format: isProduction ? prodFormat : devFormat,
  defaultMeta: { service: 'schedule-app' },
  transports: [
    new winston.transports.Console()
  ]
});

// リクエストログ用のミドルウェア
function requestLogger(req, res, next) {
  const start = Date.now();

  // レスポンス完了時にログ出力
  res.on('finish', () => {
    const duration = Date.now() - start;
    const logData = {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration: `${duration}ms`,
      userAgent: req.get('user-agent')?.substring(0, 50),
      userId: req.session?.userId || 'anonymous'
    };

    // ステータスコードに応じてログレベルを変更
    if (res.statusCode >= 500) {
      logger.error('Request failed', logData);
    } else if (res.statusCode >= 400) {
      logger.warn('Request error', logData);
    } else {
      logger.info('Request completed', logData);
    }
  });

  next();
}

// 監査ログ（重要な操作を記録）
function auditLog(action, userId, details = {}) {
  logger.info('Audit', {
    action,
    userId,
    timestamp: new Date().toISOString(),
    ...details
  });
}

module.exports = {
  logger,
  requestLogger,
  auditLog
};
