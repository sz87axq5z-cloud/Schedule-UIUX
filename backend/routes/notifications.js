/**
 * LINE通知・連携API
 *
 * - LINE Webhook（友だち追加、メッセージ受信）
 * - LINE連携コード生成・検証
 * - リマインド送信
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { db } = require('../config/firebase');

// LINE API設定
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const LINE_API_URL = 'https://api.line.me/v2/bot/message';

// 連携コードの有効期限（10分）
const LINK_CODE_EXPIRY = 10 * 60 * 1000;

// 連携コードを一時保存（本番ではRedisなどを使用）
const pendingLinkCodes = new Map();

/**
 * LINE Webhook署名検証
 */
function verifySignature(body, signature) {
  if (!LINE_CHANNEL_SECRET) return false;
  const hash = crypto
    .createHmac('SHA256', LINE_CHANNEL_SECRET)
    .update(body)
    .digest('base64');
  return hash === signature;
}

/**
 * LINEにメッセージを送信
 */
async function sendLineMessage(lineUserId, messages) {
  if (!LINE_CHANNEL_ACCESS_TOKEN) {
    console.error('LINE_CHANNEL_ACCESS_TOKEN が設定されていません');
    return { success: false, error: 'LINE設定エラー' };
  }

  try {
    const response = await fetch(`${LINE_API_URL}/push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`
      },
      body: JSON.stringify({
        to: lineUserId,
        messages: Array.isArray(messages) ? messages : [messages]
      })
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('LINE送信エラー:', error);
      return { success: false, error };
    }

    return { success: true };
  } catch (error) {
    console.error('LINE送信エラー:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 連携コードを生成
 */
function generateLinkCode() {
  // 6桁の数字コード
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// ========================================
// API Routes
// ========================================

/**
 * LINE Webhook（LINEからのイベント受信）
 */
router.post('/line/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  // 署名検証
  const signature = req.headers['x-line-signature'];
  const bodyString = typeof req.body === 'string' ? req.body : req.body.toString();

  if (!verifySignature(bodyString, signature)) {
    console.error('LINE Webhook: 署名検証失敗');
    return res.status(401).json({ error: '署名検証失敗' });
  }

  try {
    const body = JSON.parse(bodyString);
    const events = body.events || [];

    for (const event of events) {
      console.log('LINE Event:', event.type, event);

      // 友だち追加イベント
      if (event.type === 'follow') {
        const lineUserId = event.source.userId;
        console.log(`友だち追加: ${lineUserId}`);

        // ウェルカムメッセージを送信
        await sendLineMessage(lineUserId, {
          type: 'text',
          text: 'スケジュール管理アプリの友だち追加ありがとうございます！\n\nアプリとLINEを連携するには、アプリに表示された6桁の連携コードをこちらに送信してください。'
        });
      }

      // メッセージ受信イベント（連携コードの確認）
      if (event.type === 'message' && event.message.type === 'text') {
        const lineUserId = event.source.userId;
        const text = event.message.text.trim();

        // 6桁の数字かチェック
        if (/^\d{6}$/.test(text)) {
          const linkData = pendingLinkCodes.get(text);

          if (linkData && Date.now() < linkData.expiresAt) {
            // 連携成功
            const { appUserId } = linkData;

            // FirestoreのユーザードキュメントにLINE UserIDを保存
            await db.collection('users').doc(appUserId).update({
              lineUserId: lineUserId,
              lineLinkedAt: new Date()
            });

            // 連携コードを削除
            pendingLinkCodes.delete(text);

            // 成功メッセージを送信
            await sendLineMessage(lineUserId, {
              type: 'text',
              text: '✅ LINE連携が完了しました！\n\nこれからスケジュールのリマインドをお届けします。'
            });

            console.log(`LINE連携成功: appUserId=${appUserId}, lineUserId=${lineUserId}`);
          } else {
            // コードが無効または期限切れ
            await sendLineMessage(lineUserId, {
              type: 'text',
              text: '❌ 連携コードが無効または期限切れです。\n\nアプリで新しい連携コードを取得してください。'
            });
          }
        }
      }
    }

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('LINE Webhookエラー:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * 連携コードを生成（フロントエンドから呼び出し）
 */
router.post('/line/link-code', async (req, res) => {
  const { userId } = req.body;

  if (!userId) {
    return res.status(400).json({
      success: false,
      error: 'userIdが必要です'
    });
  }

  // 既存の連携コードがあれば削除
  for (const [code, data] of pendingLinkCodes.entries()) {
    if (data.appUserId === userId) {
      pendingLinkCodes.delete(code);
    }
  }

  // 新しい連携コードを生成
  const linkCode = generateLinkCode();
  pendingLinkCodes.set(linkCode, {
    appUserId: userId,
    expiresAt: Date.now() + LINK_CODE_EXPIRY
  });

  console.log(`連携コード生成: ${linkCode} for user ${userId}`);

  res.json({
    success: true,
    linkCode,
    expiresIn: LINK_CODE_EXPIRY / 1000 // 秒
  });
});

/**
 * LINE連携状態を確認
 */
router.get('/line/status', async (req, res) => {
  const userId = req.query.userId;

  if (!userId) {
    return res.status(400).json({
      success: false,
      error: 'userIdが必要です'
    });
  }

  try {
    const userDoc = await db.collection('users').doc(userId).get();

    if (!userDoc.exists) {
      return res.json({
        success: true,
        linked: false
      });
    }

    const userData = userDoc.data();
    res.json({
      success: true,
      linked: !!userData.lineUserId,
      linkedAt: userData.lineLinkedAt || null
    });
  } catch (error) {
    console.error('LINE連携状態確認エラー:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * リマインド送信（翌日の予定があるユーザーに送信）
 */
router.post('/reminders/send', async (req, res) => {
  try {
    // 翌日の日付範囲を計算
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);

    const dayAfter = new Date(tomorrow);
    dayAfter.setDate(dayAfter.getDate() + 1);

    // 今日の日付文字列（重複チェック用）
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    console.log(`リマインド送信: ${tomorrow.toISOString()} 〜 ${dayAfter.toISOString()}`);
    console.log(`重複チェック日付: ${todayStr}`);

    // 翌日のスケジュールを取得
    const schedulesSnapshot = await db.collection('schedules')
      .where('startTime', '>=', tomorrow)
      .where('startTime', '<', dayAfter)
      .get();

    if (schedulesSnapshot.empty) {
      return res.json({
        success: true,
        message: '翌日の予定はありません',
        sent: 0,
        skipped: 0
      });
    }

    const sentUsers = new Set();
    let sentCount = 0;
    let skippedCount = 0;

    for (const doc of schedulesSnapshot.docs) {
      const schedule = doc.data();
      const studentId = schedule.studentId;

      // 既に送信済みのユーザーはスキップ
      if (!studentId || sentUsers.has(studentId)) continue;

      // このスケジュールに対して今日既にリマインドを送信済みかチェック
      if (schedule.reminderSentDate === todayStr) {
        console.log(`スキップ（送信済み）: ${doc.id}`);
        skippedCount++;
        sentUsers.add(studentId);
        continue;
      }

      // ユーザー情報を取得
      const userDoc = await db.collection('users').doc(studentId).get();
      if (!userDoc.exists) continue;

      const user = userDoc.data();
      const lineUserId = user.lineUserId;

      // LINE連携していないユーザーはスキップ
      if (!lineUserId) continue;

      // 時刻フォーマット
      const startTime = schedule.startTime.toDate ? schedule.startTime.toDate() : new Date(schedule.startTime);
      const endTime = schedule.endTime.toDate ? schedule.endTime.toDate() : new Date(schedule.endTime);
      const dateStr = `${startTime.getMonth() + 1}/${startTime.getDate()}`;
      const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
      const dayStr = dayNames[startTime.getDay()];
      const timeStr = `${startTime.getHours()}:${String(startTime.getMinutes()).padStart(2, '0')}〜${endTime.getHours()}:${String(endTime.getMinutes()).padStart(2, '0')}`;

      // リマインドメッセージを送信
      const message = {
        type: 'text',
        text: `📅 明日の予定のお知らせ\n\n${user.displayName || user.name}さん、明日の予定があります。\n\n【${dateStr}（${dayStr}）${timeStr}】\n${schedule.title}\n\n忘れずにご準備ください！`
      };

      const result = await sendLineMessage(lineUserId, message);
      if (result.success) {
        // 送信成功したら reminderSentDate を更新
        await doc.ref.update({
          reminderSentDate: todayStr,
          reminderSentAt: new Date()
        });
        sentCount++;
        sentUsers.add(studentId);
        console.log(`リマインド送信成功: ${studentId}`);
      }
    }

    res.json({
      success: true,
      message: `${sentCount}件のリマインドを送信しました（${skippedCount}件は送信済みのためスキップ）`,
      sent: sentCount,
      skipped: skippedCount
    });
  } catch (error) {
    console.error('リマインド送信エラー:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * テスト用：特定ユーザーにLINEメッセージを送信
 */
router.post('/line/test', async (req, res) => {
  const { userId, message } = req.body;

  if (!userId) {
    return res.status(400).json({
      success: false,
      error: 'userIdが必要です'
    });
  }

  try {
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({
        success: false,
        error: 'ユーザーが見つかりません'
      });
    }

    const user = userDoc.data();
    if (!user.lineUserId) {
      return res.status(400).json({
        success: false,
        error: 'このユーザーはLINE連携していません'
      });
    }

    const result = await sendLineMessage(user.lineUserId, {
      type: 'text',
      text: message || 'これはテストメッセージです'
    });

    res.json(result);
  } catch (error) {
    console.error('LINEテスト送信エラー:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * 開発用：LINE連携を解除（テスト用）
 */
router.delete('/line/unlink', async (req, res) => {
  const { email } = req.query;

  if (!email) {
    return res.status(400).json({
      success: false,
      error: 'emailパラメータが必要です'
    });
  }

  try {
    // メールアドレスでユーザーを検索
    const usersSnapshot = await db.collection('users')
      .where('email', '==', email)
      .get();

    if (usersSnapshot.empty) {
      return res.status(404).json({
        success: false,
        error: 'ユーザーが見つかりません'
      });
    }

    // LINE連携情報を削除
    for (const doc of usersSnapshot.docs) {
      await doc.ref.update({
        lineUserId: null,
        lineLinkedAt: null
      });
      console.log(`LINE連携を解除: ${email} (userId: ${doc.id})`);
    }

    res.json({
      success: true,
      message: `${email} のLINE連携を解除しました`
    });
  } catch (error) {
    console.error('LINE連携解除エラー:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
