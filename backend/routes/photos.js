/**
 * 写真関連のAPI
 *
 * - ビフォー写真の送信
 * - アフター写真の送信
 * - 講師による写真チェック・承認
 * - 写真一覧の取得
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { db } = require('../config/firebase');

// コレクション名
const SCHEDULES_COLLECTION = 'schedules';

// アップロード先ディレクトリ
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'photos');

// アップロードディレクトリを作成
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Multer設定
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, `photo-${uniqueSuffix}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('画像ファイルのみアップロード可能です'));
    }
  }
});

// LINE API設定
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const LINE_API_URL = 'https://api.line.me/v2/bot/message';

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
 * セキュリティ: 認証チェックヘルパー
 */
async function getAuthenticatedUser(req) {
  const userId = req.session?.userId;
  if (!userId) return null;

  const userDoc = await db.collection('users').doc(userId).get();
  if (!userDoc.exists) return null;

  return {
    id: userId,
    ...userDoc.data()
  };
}

/**
 * ビフォー写真を送信（ファイルアップロード対応）
 * POST /api/photos/before/:scheduleId
 */
router.post('/before/:scheduleId', upload.single('photo'), async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'ログインが必要です'
      });
    }

    const { scheduleId } = req.params;
    const { comment } = req.body;

    // スケジュール取得
    const scheduleRef = db.collection(SCHEDULES_COLLECTION).doc(scheduleId);
    const scheduleDoc = await scheduleRef.get();

    if (!scheduleDoc.exists) {
      return res.status(404).json({
        success: false,
        error: 'スケジュールが見つかりません'
      });
    }

    const schedule = scheduleDoc.data();

    // 本人確認（生徒のみ送信可能）
    if (schedule.studentId !== user.id) {
      return res.status(403).json({
        success: false,
        error: 'このスケジュールの写真を送信する権限がありません'
      });
    }

    // 写真URL（アップロードされた場合はそのパス、なければダミー）
    const photoUrl = req.file
      ? `/api/photos/uploads/${req.file.filename}`
      : 'demo-before-photo.jpg';

    // ビフォー写真を記録
    await scheduleRef.update({
      beforePhoto: {
        url: photoUrl,
        filename: req.file?.filename || null,
        comment: comment || '',
        submittedAt: new Date(),
        submittedBy: user.id,
        submittedVia: 'app'
      },
      status: 'before_submitted',
      updatedAt: new Date()
    });

    res.json({
      success: true,
      message: 'ビフォー写真を送信しました',
      status: 'before_submitted',
      photoUrl
    });
  } catch (error) {
    console.error('ビフォー写真送信エラー:', error);
    res.status(500).json({
      success: false,
      error: 'ビフォー写真の送信に失敗しました'
    });
  }
});

/**
 * アフター写真を送信（ファイルアップロード対応）
 * POST /api/photos/after/:scheduleId
 */
router.post('/after/:scheduleId', upload.single('photo'), async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'ログインが必要です'
      });
    }

    const { scheduleId } = req.params;
    const { comment } = req.body;

    // スケジュール取得
    const scheduleRef = db.collection(SCHEDULES_COLLECTION).doc(scheduleId);
    const scheduleDoc = await scheduleRef.get();

    if (!scheduleDoc.exists) {
      return res.status(404).json({
        success: false,
        error: 'スケジュールが見つかりません'
      });
    }

    const schedule = scheduleDoc.data();

    // 本人確認（生徒のみ送信可能）
    if (schedule.studentId !== user.id) {
      return res.status(403).json({
        success: false,
        error: 'このスケジュールの写真を送信する権限がありません'
      });
    }

    // ビフォー写真が送信されているか確認
    if (!schedule.beforePhoto) {
      return res.status(400).json({
        success: false,
        error: '先にビフォー写真を送信してください'
      });
    }

    // 写真URL（アップロードされた場合はそのパス、なければダミー）
    const photoUrl = req.file
      ? `/api/photos/uploads/${req.file.filename}`
      : 'demo-after-photo.jpg';

    // アフター写真を記録
    await scheduleRef.update({
      afterPhoto: {
        url: photoUrl,
        filename: req.file?.filename || null,
        comment: comment || '',
        submittedAt: new Date(),
        submittedBy: user.id,
        submittedVia: 'app'
      },
      status: 'pending_approval', // 講師の承認待ち
      updatedAt: new Date()
    });

    res.json({
      success: true,
      message: 'アフター写真を送信しました。講師の確認をお待ちください',
      status: 'pending_approval',
      photoUrl
    });
  } catch (error) {
    console.error('アフター写真送信エラー:', error);
    res.status(500).json({
      success: false,
      error: 'アフター写真の送信に失敗しました'
    });
  }
});

/**
 * アップロードされた写真を配信
 * GET /api/photos/uploads/:filename
 */
router.get('/uploads/:filename', async (req, res) => {
  try {
    const { filename } = req.params;
    const filePath = path.join(UPLOAD_DIR, filename);

    // ファイルが存在するか確認
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        error: '画像が見つかりません'
      });
    }

    // ファイルを送信
    res.sendFile(filePath);
  } catch (error) {
    console.error('画像配信エラー:', error);
    res.status(500).json({
      success: false,
      error: '画像の取得に失敗しました'
    });
  }
});

/**
 * 講師が写真を承認
 * POST /api/photos/approve/:scheduleId
 */
router.post('/approve/:scheduleId', async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'ログインが必要です'
      });
    }

    // 講師のみ承認可能
    if (user.role !== 'teacher') {
      return res.status(403).json({
        success: false,
        error: '講師のみ承認できます'
      });
    }

    const { scheduleId } = req.params;
    const { comment } = req.body;

    // スケジュール取得
    const scheduleRef = db.collection(SCHEDULES_COLLECTION).doc(scheduleId);
    const scheduleDoc = await scheduleRef.get();

    if (!scheduleDoc.exists) {
      return res.status(404).json({
        success: false,
        error: 'スケジュールが見つかりません'
      });
    }

    const schedule = scheduleDoc.data();

    // 承認待ち状態か確認
    if (schedule.status !== 'pending_approval') {
      return res.status(400).json({
        success: false,
        error: 'このスケジュールは承認待ち状態ではありません',
        currentStatus: schedule.status
      });
    }

    // 承認を記録
    await scheduleRef.update({
      status: 'completed',
      approval: {
        approvedAt: new Date(),
        approvedBy: user.id,
        approverName: user.displayName || user.name,
        comment: comment || ''
      },
      completedAt: new Date(),
      updatedAt: new Date()
    });

    // 生徒にLINE通知を送信
    let lineNotificationSent = false;
    if (schedule.studentId) {
      try {
        const studentDoc = await db.collection('users').doc(schedule.studentId).get();
        if (studentDoc.exists) {
          const student = studentDoc.data();
          if (student.lineUserId) {
            const scheduleTitle = schedule.locationIcon
              ? `${schedule.locationIcon} ${schedule.title || schedule.location}`
              : schedule.title || schedule.location;

            // コメントがある場合はメッセージに含める
            const commentText = comment ? `\n\n💬 講師より:\n「${comment}」` : '';
            const result = await sendLineMessage(student.lineUserId, {
              type: 'text',
              text: `🎉 片付け完了！\n\n${scheduleTitle}\n\nお疲れさまでした！写真が承認されました。${commentText}`
            });
            lineNotificationSent = result.success;
          }
        }
      } catch (lineError) {
        console.error('LINE通知送信エラー:', lineError);
      }
    }

    res.json({
      success: true,
      message: '写真を承認しました' + (lineNotificationSent ? '。生徒にLINE通知を送信しました' : ''),
      status: 'completed',
      lineNotificationSent
    });
  } catch (error) {
    console.error('写真承認エラー:', error);
    res.status(500).json({
      success: false,
      error: '写真の承認に失敗しました'
    });
  }
});

/**
 * 承認待ちの写真一覧を取得（講師用）
 * GET /api/photos/pending
 */
router.get('/pending', async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'ログインが必要です'
      });
    }

    // 講師のみ取得可能
    if (user.role !== 'teacher') {
      return res.status(403).json({
        success: false,
        error: '講師のみアクセスできます'
      });
    }

    // 承認待ちのスケジュールを取得（インデックス不要なクエリ）
    const snapshot = await db.collection(SCHEDULES_COLLECTION)
      .where('status', '==', 'pending_approval')
      .get();

    const pendingItems = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      pendingItems.push({
        id: doc.id,
        title: data.title,
        location: data.location,
        locationIcon: data.locationIcon,
        studentId: data.studentId,
        studentName: data.studentName,
        beforePhoto: data.beforePhoto,
        afterPhoto: data.afterPhoto,
        startTime: data.startTime,
        updatedAt: data.updatedAt
      });
    });

    // メモリ内でソート（updatedAtの降順）
    pendingItems.sort((a, b) => {
      const timeA = a.updatedAt?.toDate ? a.updatedAt.toDate() : new Date(a.updatedAt || 0);
      const timeB = b.updatedAt?.toDate ? b.updatedAt.toDate() : new Date(b.updatedAt || 0);
      return timeB - timeA;
    });

    res.json({
      success: true,
      count: pendingItems.length,
      data: pendingItems
    });
  } catch (error) {
    console.error('承認待ち一覧取得エラー:', error);
    res.status(500).json({
      success: false,
      error: '承認待ち一覧の取得に失敗しました'
    });
  }
});

/**
 * 特定スケジュールの写真ステータスを取得
 * GET /api/photos/status/:scheduleId
 */
router.get('/status/:scheduleId', async (req, res) => {
  try {
    const { scheduleId } = req.params;

    const scheduleDoc = await db.collection(SCHEDULES_COLLECTION).doc(scheduleId).get();

    if (!scheduleDoc.exists) {
      return res.status(404).json({
        success: false,
        error: 'スケジュールが見つかりません'
      });
    }

    const data = scheduleDoc.data();

    res.json({
      success: true,
      data: {
        id: scheduleId,
        status: data.status,
        beforePhoto: data.beforePhoto || null,
        afterPhoto: data.afterPhoto || null,
        approval: data.approval || null
      }
    });
  } catch (error) {
    console.error('写真ステータス取得エラー:', error);
    res.status(500).json({
      success: false,
      error: '写真ステータスの取得に失敗しました'
    });
  }
});

/**
 * テスト用: スケジュールのステータスをリセット（開発環境のみ認証不要）
 * POST /api/photos/reset/:scheduleId
 */
router.post('/reset/:scheduleId', async (req, res) => {
  try {
    // 開発環境では認証スキップ可能
    const isDev = process.env.NODE_ENV !== 'production';
    if (!isDev) {
      const user = await getAuthenticatedUser(req);
      if (!user) {
        return res.status(401).json({
          success: false,
          error: 'ログインが必要です'
        });
      }
    }

    const { scheduleId } = req.params;

    const scheduleRef = db.collection(SCHEDULES_COLLECTION).doc(scheduleId);
    const scheduleDoc = await scheduleRef.get();

    if (!scheduleDoc.exists) {
      return res.status(404).json({
        success: false,
        error: 'スケジュールが見つかりません'
      });
    }

    // ステータスをリセット
    await scheduleRef.update({
      status: 'scheduled',
      beforePhoto: null,
      afterPhoto: null,
      approval: null,
      completedAt: null,
      updatedAt: new Date()
    });

    res.json({
      success: true,
      message: 'スケジュールのステータスをリセットしました'
    });
  } catch (error) {
    console.error('ステータスリセットエラー:', error);
    res.status(500).json({
      success: false,
      error: 'ステータスのリセットに失敗しました'
    });
  }
});

/**
 * LINE写真を取得（プロキシ）
 * GET /api/photos/line-image/:messageId
 */
router.get('/line-image/:messageId', async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'ログインが必要です'
      });
    }

    // 講師のみアクセス可能
    if (user.role !== 'teacher') {
      return res.status(403).json({
        success: false,
        error: '講師のみアクセスできます'
      });
    }

    const { messageId } = req.params;

    if (!LINE_CHANNEL_ACCESS_TOKEN) {
      return res.status(500).json({
        success: false,
        error: 'LINE設定エラー'
      });
    }

    // LINE APIから画像を取得
    const response = await fetch(`https://api-data.line.me/v2/bot/message/${messageId}/content`, {
      headers: {
        'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`
      }
    });

    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        error: '画像の取得に失敗しました'
      });
    }

    // Content-Typeをそのまま転送
    const contentType = response.headers.get('content-type');
    res.setHeader('Content-Type', contentType || 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=3600');

    // 画像データをストリームで転送
    const buffer = await response.arrayBuffer();
    res.send(Buffer.from(buffer));

  } catch (error) {
    console.error('LINE画像取得エラー:', error);
    res.status(500).json({
      success: false,
      error: '画像の取得に失敗しました'
    });
  }
});

module.exports = router;
