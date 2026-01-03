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
const { validate, schemas } = require('../middleware/validation');

// LINE API設定
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const LINE_API_URL = 'https://api.line.me/v2/bot/message';

// 連携コードの有効期限（30分）
const LINK_CODE_EXPIRY = 30 * 60 * 1000;

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
 * セキュリティ修正: crypto.randomInt()を使用して暗号学的に安全な乱数を生成
 */
function generateLinkCode() {
  // 6桁の数字コード（100000〜999999）
  // crypto.randomInt()は暗号学的に安全な乱数を生成
  return crypto.randomInt(100000, 1000000).toString();
}

// ========================================
// 写真処理関数
// ========================================

/**
 * LINEから受信した写真を処理
 */
async function processPhotoFromLine(lineUserId, messageId) {
  try {
    // LINEユーザーに紐づくアプリユーザーを検索
    const usersSnapshot = await db.collection('users')
      .where('lineUserId', '==', lineUserId)
      .get();

    if (usersSnapshot.empty) {
      await sendLineMessage(lineUserId, {
        type: 'text',
        text: '写真を受け取りましたが、アプリとの連携ができていないようです。\n\nアプリからLINE連携を行ってください。'
      });
      return;
    }

    const userDoc = usersSnapshot.docs[0];
    const userId = userDoc.id;
    const user = userDoc.data();

    // このユーザーの「before_submitted」または「scheduled」のスケジュールを探す
    let targetSchedule = null;
    let targetDoc = null;
    let photoType = null;

    // まず「before_submitted」（アフター写真待ち）を探す
    const beforeSubmittedSnapshot = await db.collection('schedules')
      .where('studentId', '==', userId)
      .where('status', '==', 'before_submitted')
      .get();

    if (!beforeSubmittedSnapshot.empty) {
      // startTimeでソートして最初のものを使用
      const schedules = beforeSubmittedSnapshot.docs.map(doc => ({ doc, data: doc.data() }));
      schedules.sort((a, b) => {
        const timeA = a.data.startTime.toDate ? a.data.startTime.toDate() : new Date(a.data.startTime);
        const timeB = b.data.startTime.toDate ? b.data.startTime.toDate() : new Date(b.data.startTime);
        return timeA - timeB;
      });
      targetDoc = schedules[0].doc;
      targetSchedule = schedules[0].data;
      photoType = 'after';
    } else {
      // 「scheduled」（ビフォー写真待ち）を探す
      const scheduledSnapshot = await db.collection('schedules')
        .where('studentId', '==', userId)
        .where('status', '==', 'scheduled')
        .get();

      if (!scheduledSnapshot.empty) {
        // startTimeでソートして最初のものを使用
        const schedules = scheduledSnapshot.docs.map(doc => ({ doc, data: doc.data() }));
        schedules.sort((a, b) => {
          const timeA = a.data.startTime.toDate ? a.data.startTime.toDate() : new Date(a.data.startTime);
          const timeB = b.data.startTime.toDate ? b.data.startTime.toDate() : new Date(b.data.startTime);
          return timeA - timeB;
        });
        targetDoc = schedules[0].doc;
        targetSchedule = schedules[0].data;
        photoType = 'before';
      }
    }

    if (!targetSchedule) {
      await sendLineMessage(lineUserId, {
        type: 'text',
        text: '写真を受け取りましたが、対象の予定が見つかりませんでした。\n\n新しい予定を登録するか、既存の予定を確認してください。'
      });
      return;
    }

    const scheduleTitle = targetSchedule.locationIcon
      ? `${targetSchedule.locationIcon} ${targetSchedule.title || targetSchedule.location}`
      : targetSchedule.title || targetSchedule.location;

    if (photoType === 'before') {
      // ビフォー写真として記録
      await targetDoc.ref.update({
        beforePhoto: {
          lineMessageId: messageId,
          submittedAt: new Date(),
          submittedVia: 'line'
        },
        status: 'before_submitted',
        updatedAt: new Date()
      });

      await sendLineMessage(lineUserId, {
        type: 'text',
        text: `📷 ビフォー写真を受け取りました！\n\n【${scheduleTitle}】\n\n片付けを頑張ってください！\n終わったらアフター写真を送ってくださいね。`
      });
      console.log(`ビフォー写真記録: scheduleId=${targetDoc.id}, userId=${userId}`);
    } else {
      // アフター写真として記録
      await targetDoc.ref.update({
        afterPhoto: {
          lineMessageId: messageId,
          submittedAt: new Date(),
          submittedVia: 'line'
        },
        status: 'pending_approval',
        updatedAt: new Date()
      });

      await sendLineMessage(lineUserId, {
        type: 'text',
        text: `📷 アフター写真を受け取りました！\n\n【${scheduleTitle}】\n\nお疲れ様でした！\n講師が確認してOKを出すと完了になります。少々お待ちください。`
      });
      console.log(`アフター写真記録: scheduleId=${targetDoc.id}, userId=${userId}`);
    }
  } catch (error) {
    console.error('写真処理エラー:', error);
    await sendLineMessage(lineUserId, {
      type: 'text',
      text: '写真の処理中にエラーが発生しました。もう一度お試しください。'
    });
  }
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

      // 画像メッセージ受信イベント（写真送信）
      if (event.type === 'message' && event.message.type === 'image') {
        const lineUserId = event.source.userId;
        const messageId = event.message.id;
        console.log(`画像受信: lineUserId=${lineUserId}, messageId=${messageId}`);

        // 写真処理（後で定義するhandlePhotoMessage関数を呼び出し）
        await processPhotoFromLine(lineUserId, messageId);
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
 * バリデーション: userIdは必須
 */
router.post('/line/link-code', validate(schemas.linkCode), async (req, res) => {
  const { userId } = req.body;

  // バリデーションはミドルウェアで実行済み

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
 * 日時フォーマットヘルパー（日本時間 JST で表示）
 */
function formatScheduleDateTime(startTime, endTime) {
  // 日本時間（JST = UTC+9）に変換
  const jstOffset = 9 * 60 * 60 * 1000; // 9時間をミリ秒で
  const startJST = new Date(startTime.getTime() + jstOffset);
  const endJST = new Date(endTime.getTime() + jstOffset);

  // UTCメソッドを使うことで、オフセット済みの時刻をそのまま取得
  const dateStr = `${startJST.getUTCMonth() + 1}/${startJST.getUTCDate()}`;
  const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
  const dayStr = dayNames[startJST.getUTCDay()];
  const timeStr = `${startJST.getUTCHours()}:${String(startJST.getUTCMinutes()).padStart(2, '0')}〜${endJST.getUTCHours()}:${String(endJST.getUTCMinutes()).padStart(2, '0')}`;
  return { dateStr, dayStr, timeStr };
}

/**
 * 前日リマインド送信（毎日20時に実行）
 * 翌日の予定があるユーザーにLINE通知
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

    console.log(`前日リマインド送信: ${tomorrow.toISOString()} 〜 ${dayAfter.toISOString()}`);

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
        console.log(`スキップ（前日リマインド送信済み）: ${doc.id}`);
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
      const { dateStr, dayStr, timeStr } = formatScheduleDateTime(startTime, endTime);

      // 前日リマインドメッセージ
      const message = {
        type: 'text',
        text: `📅 明日の予定のお知らせ\n\n${user.displayName || user.name}さん、明日は予定があります！\n\n【${dateStr}（${dayStr}）${timeStr}】\n${schedule.title}\n\n片付けを始める前に「ビフォー写真」を送ってください。完了したら「アフター写真」を送ってください！`
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
        console.log(`前日リマインド送信成功: ${studentId}`);
      }
    }

    res.json({
      success: true,
      message: `${sentCount}件の前日リマインドを送信しました（${skippedCount}件は送信済みのためスキップ）`,
      sent: sentCount,
      skipped: skippedCount
    });
  } catch (error) {
    console.error('前日リマインド送信エラー:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * 1時間前リマインド送信（5分ごとに実行して、1時間前の予定を通知）
 * 当日の予定開始1時間前にLINE通知
 */
router.post('/reminders/send-hourly', async (req, res) => {
  try {
    const now = new Date();

    // 1時間後の時間範囲（55分後〜65分後の予定を対象）
    const oneHourLater = new Date(now.getTime() + 55 * 60 * 1000);
    const oneHourLaterEnd = new Date(now.getTime() + 65 * 60 * 1000);

    // 今日の日付文字列 + "hourly"（重複チェック用）
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}-hourly`;

    console.log(`1時間前リマインド: ${oneHourLater.toISOString()} 〜 ${oneHourLaterEnd.toISOString()}`);

    // 1時間後に開始する予定を取得
    const schedulesSnapshot = await db.collection('schedules')
      .where('startTime', '>=', oneHourLater)
      .where('startTime', '<=', oneHourLaterEnd)
      .get();

    if (schedulesSnapshot.empty) {
      return res.json({
        success: true,
        message: '1時間後に開始する予定はありません',
        sent: 0,
        skipped: 0
      });
    }

    let sentCount = 0;
    let skippedCount = 0;

    for (const doc of schedulesSnapshot.docs) {
      const schedule = doc.data();
      const studentId = schedule.studentId;

      if (!studentId) continue;

      // 1時間前リマインドを既に送信済みかチェック
      if (schedule.hourlyReminderSentDate === todayStr) {
        console.log(`スキップ（1時間前リマインド送信済み）: ${doc.id}`);
        skippedCount++;
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
      const { timeStr } = formatScheduleDateTime(startTime, endTime);

      // 1時間前リマインドメッセージ
      const message = {
        type: 'text',
        text: `⏰ まもなく予定の時間です！\n\n${user.displayName || user.name}さん、あと1時間で予定が始まります。\n\n【本日 ${timeStr}】\n${schedule.title}\n\n片付けを始める前に「ビフォー写真」を送ってください！`
      };

      const result = await sendLineMessage(lineUserId, message);
      if (result.success) {
        // 送信成功したら hourlyReminderSentDate を更新
        await doc.ref.update({
          hourlyReminderSentDate: todayStr,
          hourlyReminderSentAt: new Date()
        });
        sentCount++;
        console.log(`1時間前リマインド送信成功: ${studentId}`);
      }
    }

    res.json({
      success: true,
      message: `${sentCount}件の1時間前リマインドを送信しました（${skippedCount}件は送信済みのためスキップ）`,
      sent: sentCount,
      skipped: skippedCount
    });
  } catch (error) {
    console.error('1時間前リマインド送信エラー:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * 5分前リマインド送信（毎分実行して、5分前の予定を通知）
 * 予定開始5分前にビフォー写真を送るよう促すLINE通知
 */
router.post('/reminders/send-5min', async (req, res) => {
  try {
    const now = new Date();

    // 3分後〜7分後の範囲の予定を取得（5分前リマインド）
    const fiveMinLater = new Date(now.getTime() + 3 * 60 * 1000);
    const fiveMinLaterEnd = new Date(now.getTime() + 7 * 60 * 1000);

    // 今日の日付文字列 + "5min"（重複チェック用）
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}-5min`;

    console.log(`5分前リマインド: ${fiveMinLater.toISOString()} 〜 ${fiveMinLaterEnd.toISOString()}`);

    // 5分後に開始する予定を取得
    const schedulesSnapshot = await db.collection('schedules')
      .where('startTime', '>=', fiveMinLater)
      .where('startTime', '<=', fiveMinLaterEnd)
      .get();

    let sentCount = 0;
    let skippedCount = 0;

    for (const doc of schedulesSnapshot.docs) {
      const schedule = doc.data();
      const studentId = schedule.studentId;

      if (!studentId) continue;

      // ビフォー写真が既に送られている場合はスキップ
      if (schedule.status === 'before_submitted' || schedule.status === 'pending_approval' || schedule.status === 'completed') {
        console.log(`スキップ（既に開始済み）: ${doc.id}`);
        skippedCount++;
        continue;
      }

      // 5分前リマインドを既に送信済みかチェック
      if (schedule.fiveMinReminderSentDate === todayStr) {
        console.log(`スキップ（5分前リマインド送信済み）: ${doc.id}`);
        skippedCount++;
        continue;
      }

      // 生徒情報を取得
      const userDoc = await db.collection('users').doc(studentId).get();
      if (!userDoc.exists) continue;

      const user = userDoc.data();
      const lineUserId = user.lineUserId;
      if (!lineUserId) continue;

      // 時刻をフォーマット
      const startTime = schedule.startTime.toDate ? schedule.startTime.toDate() : new Date(schedule.startTime);
      const endTime = schedule.endTime.toDate ? schedule.endTime.toDate() : new Date(schedule.endTime);
      const { timeStr } = formatScheduleDateTime(startTime, endTime);

      // 5分前リマインドメッセージ
      const message = {
        type: 'text',
        text: `📸 まもなく片付け開始！\n\n${user.displayName || user.name}さん、あと5分で予定の時間です。\n\n【${timeStr}】\n${schedule.locationIcon || '📋'} ${schedule.title || schedule.location}\n\n⬇️ 片付けを始める前に「ビフォー写真」を送ってください！`
      };

      const result = await sendLineMessage(lineUserId, message);
      if (result.success) {
        // 送信成功したら fiveMinReminderSentDate を更新
        await doc.ref.update({
          fiveMinReminderSentDate: todayStr,
          fiveMinReminderSentAt: new Date()
        });
        sentCount++;
        console.log(`5分前リマインド送信成功: ${studentId}`);
      }
    }

    res.json({
      success: true,
      message: `${sentCount}件の5分前リマインドを送信しました（${skippedCount}件はスキップ）`,
      sent: sentCount,
      skipped: skippedCount
    });
  } catch (error) {
    console.error('5分前リマインド送信エラー:', error);
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

/**
 * 開発用：メールアドレスでユーザー情報を取得
 */
router.get('/user/by-email', async (req, res) => {
  const { email } = req.query;

  if (!email) {
    return res.status(400).json({
      success: false,
      error: 'emailパラメータが必要です'
    });
  }

  try {
    const usersSnapshot = await db.collection('users')
      .where('email', '==', email)
      .get();

    if (usersSnapshot.empty) {
      return res.status(404).json({
        success: false,
        error: 'ユーザーが見つかりません'
      });
    }

    const userData = [];
    usersSnapshot.forEach(doc => {
      const data = doc.data();
      userData.push({
        id: doc.id,
        email: data.email,
        displayName: data.displayName || data.name,
        role: data.role,
        lineUserId: data.lineUserId ? '連携済み' : '未連携',
        lineLinkedAt: data.lineLinkedAt
      });
    });

    res.json({
      success: true,
      data: userData[0]
    });
  } catch (error) {
    console.error('ユーザー検索エラー:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * 開発用：特定ユーザーにダミーリマインドを送信
 */
router.post('/line/test-reminder', async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({
      success: false,
      error: 'emailが必要です'
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

    const userDoc = usersSnapshot.docs[0];
    const user = userDoc.data();

    if (!user.lineUserId) {
      return res.status(400).json({
        success: false,
        error: 'このユーザーはLINE連携していません',
        userId: userDoc.id
      });
    }

    // このユーザーのスケジュールを取得（scheduledステータスのもの）
    const schedulesSnapshot = await db.collection('schedules')
      .where('studentId', '==', userDoc.id)
      .where('status', '==', 'scheduled')
      .get();

    let scheduleInfo = '予定なし';
    let scheduleId = null;
    if (!schedulesSnapshot.empty) {
      // startTimeでソートして最初のものを使用
      const schedules = schedulesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      schedules.sort((a, b) => {
        const timeA = a.startTime.toDate ? a.startTime.toDate() : new Date(a.startTime);
        const timeB = b.startTime.toDate ? b.startTime.toDate() : new Date(b.startTime);
        return timeA - timeB;
      });
      const schedule = schedules[0];
      scheduleId = schedule.id;
      const startTime = schedule.startTime.toDate ? schedule.startTime.toDate() : new Date(schedule.startTime);
      const { dateStr, dayStr, timeStr } = formatScheduleDateTime(startTime, startTime);
      scheduleInfo = `${schedule.locationIcon || '📋'} ${schedule.title || schedule.location}\n${dateStr}（${dayStr}）${timeStr}`;
    }

    // テストリマインドを送信
    const result = await sendLineMessage(user.lineUserId, {
      type: 'text',
      text: `📅 【テストリマインド】\n\n${user.displayName || user.name}さん、片付けの予定があります！\n\n${scheduleInfo}\n\n片付けを始める前に「ビフォー写真」を送ってください。完了したら「アフター写真」を送ってください！`
    });

    res.json({
      success: result.success,
      message: result.success ? 'テストリマインドを送信しました' : 'テストリマインドの送信に失敗しました',
      userId: userDoc.id,
      scheduleId: scheduleId,
      error: result.error
    });
  } catch (error) {
    console.error('テストリマインド送信エラー:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * 生徒にフォローアップメッセージを送信（講師用）
 * POST /api/notifications/send-followup
 */
router.post('/send-followup', async (req, res) => {
  const { studentId, message, scheduleId } = req.body;

  // 認証チェック
  const userId = req.session?.userId;
  if (!userId) {
    return res.status(401).json({
      success: false,
      error: 'ログインが必要です'
    });
  }

  // 講師権限チェック
  const teacherDoc = await db.collection('users').doc(userId).get();
  if (!teacherDoc.exists || teacherDoc.data().role !== 'teacher') {
    return res.status(403).json({
      success: false,
      error: '講師のみ使用できます'
    });
  }

  if (!studentId || !message) {
    return res.status(400).json({
      success: false,
      error: 'studentIdとmessageが必要です'
    });
  }

  try {
    // 生徒情報を取得
    const studentDoc = await db.collection('users').doc(studentId).get();
    if (!studentDoc.exists) {
      return res.status(404).json({
        success: false,
        error: '生徒が見つかりません'
      });
    }

    const student = studentDoc.data();
    if (!student.lineUserId) {
      return res.status(400).json({
        success: false,
        error: 'この生徒はLINE連携していません'
      });
    }

    // LINEメッセージを送信
    const result = await sendLineMessage(student.lineUserId, {
      type: 'text',
      text: `📩 講師からのメッセージ\n\n${message}`
    });

    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: 'メッセージの送信に失敗しました'
      });
    }

    // 送信履歴を保存（オプション）
    if (scheduleId) {
      const scheduleRef = db.collection('schedules').doc(scheduleId);
      const scheduleDoc = await scheduleRef.get();
      if (scheduleDoc.exists) {
        const existingMessages = scheduleDoc.data().followupMessages || [];
        await scheduleRef.update({
          followupMessages: [...existingMessages, {
            message,
            sentAt: new Date(),
            sentBy: userId
          }]
        });
      }
    }

    res.json({
      success: true,
      message: 'メッセージを送信しました'
    });
  } catch (error) {
    console.error('フォローアップメッセージ送信エラー:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * 写真受信用のLINE Webhook処理を拡張
 * 画像メッセージを受信したら写真として処理
 */
async function handlePhotoMessage(lineUserId, messageId, replyToken) {
  try {
    // LINEユーザーに紐づくアプリユーザーを検索
    const usersSnapshot = await db.collection('users')
      .where('lineUserId', '==', lineUserId)
      .get();

    if (usersSnapshot.empty) {
      await sendLineMessage(lineUserId, {
        type: 'text',
        text: '写真を受け取りましたが、アプリとの連携ができていないようです。\n\nアプリからLINE連携を行ってください。'
      });
      return;
    }

    const userDoc = usersSnapshot.docs[0];
    const userId = userDoc.id;
    const user = userDoc.data();

    // このユーザーの「before_submitted」または「scheduled」のスケジュールを探す
    let targetSchedule = null;
    let targetDoc = null;
    let photoType = null;

    // まず「before_submitted」（アフター写真待ち）を探す
    const beforeSubmittedSnapshot = await db.collection('schedules')
      .where('studentId', '==', userId)
      .where('status', '==', 'before_submitted')
      .get();

    if (!beforeSubmittedSnapshot.empty) {
      // startTimeでソートして最初のものを使用
      const schedules = beforeSubmittedSnapshot.docs.map(doc => ({ doc, data: doc.data() }));
      schedules.sort((a, b) => {
        const timeA = a.data.startTime.toDate ? a.data.startTime.toDate() : new Date(a.data.startTime);
        const timeB = b.data.startTime.toDate ? b.data.startTime.toDate() : new Date(b.data.startTime);
        return timeA - timeB;
      });
      targetDoc = schedules[0].doc;
      targetSchedule = schedules[0].data;
      photoType = 'after';
    } else {
      // 「scheduled」（ビフォー写真待ち）を探す
      const scheduledSnapshot = await db.collection('schedules')
        .where('studentId', '==', userId)
        .where('status', '==', 'scheduled')
        .get();

      if (!scheduledSnapshot.empty) {
        // startTimeでソートして最初のものを使用
        const schedules = scheduledSnapshot.docs.map(doc => ({ doc, data: doc.data() }));
        schedules.sort((a, b) => {
          const timeA = a.data.startTime.toDate ? a.data.startTime.toDate() : new Date(a.data.startTime);
          const timeB = b.data.startTime.toDate ? b.data.startTime.toDate() : new Date(b.data.startTime);
          return timeA - timeB;
        });
        targetDoc = schedules[0].doc;
        targetSchedule = schedules[0].data;
        photoType = 'before';
      }
    }

    if (!targetSchedule) {
      await sendLineMessage(lineUserId, {
        type: 'text',
        text: '写真を受け取りましたが、対象の予定が見つかりませんでした。\n\n新しい予定を登録するか、既存の予定を確認してください。'
      });
      return;
    }

    const scheduleTitle = targetSchedule.locationIcon ? `${targetSchedule.locationIcon} ${targetSchedule.title || targetSchedule.location}` : targetSchedule.title || targetSchedule.location;

    if (photoType === 'before') {
      // ビフォー写真として記録
      await targetDoc.ref.update({
        beforePhoto: {
          lineMessageId: messageId,
          submittedAt: new Date(),
          submittedVia: 'line'
        },
        status: 'before_submitted',
        updatedAt: new Date()
      });

      await sendLineMessage(lineUserId, {
        type: 'text',
        text: `📷 ビフォー写真を受け取りました！\n\n【${scheduleTitle}】\n\n片付けを頑張ってください！終わったらアフター写真を送ってくださいね。`
      });
    } else {
      // アフター写真として記録
      await targetDoc.ref.update({
        afterPhoto: {
          lineMessageId: messageId,
          submittedAt: new Date(),
          submittedVia: 'line'
        },
        status: 'pending_approval',
        updatedAt: new Date()
      });

      await sendLineMessage(lineUserId, {
        type: 'text',
        text: `📷 アフター写真を受け取りました！\n\n【${scheduleTitle}】\n\nお疲れ様でした！講師が確認してOKを出すと完了になります。少々お待ちください。`
      });
    }
  } catch (error) {
    console.error('写真メッセージ処理エラー:', error);
    await sendLineMessage(lineUserId, {
      type: 'text',
      text: '写真の処理中にエラーが発生しました。もう一度お試しください。'
    });
  }
}

// Webhookに画像メッセージ処理を追加（exportして使用）
router.handlePhotoMessage = handlePhotoMessage;

module.exports = router;
