/**
 * 通知関連のAPI
 *
 * - LINE通知の送信
 * - リマインド設定
 */

const express = require('express');
const router = express.Router();

// LINE通知を送信（後で実装）
router.post('/line', (req, res) => {
  // TODO: LINE Messaging APIを使って通知を送信
  res.json({
    message: 'LINE通知機能（まだ未実装）',
    status: 'pending'
  });
});

// リマインド一覧を取得
router.get('/reminders', (req, res) => {
  // TODO: 設定されているリマインドの一覧を返す
  res.json({
    message: 'リマインド一覧（まだ未実装）',
    status: 'pending',
    data: []
  });
});

// 手動でリマインドを実行（テスト用）
router.post('/reminders/trigger', (req, res) => {
  // TODO: 明日の予定を持つユーザーにLINE通知を送信
  res.json({
    message: '手動リマインド実行（まだ未実装）',
    status: 'pending'
  });
});

module.exports = router;
