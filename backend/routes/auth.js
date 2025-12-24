/**
 * 認証関連のAPI
 *
 * - Googleログイン
 * - ユーザー情報の取得
 */

const express = require('express');
const router = express.Router();
const { db } = require('../config/firebase');

// googleapis を遅延ロード（起動時間短縮のため）
let google = null;
let oauth2Client = null;

function getGoogle() {
  if (!google) {
    google = require('googleapis').google;
  }
  return google;
}

function getOAuth2Client() {
  if (!oauth2Client) {
    const g = getGoogle();
    const callbackUrl = process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3001/api/auth/google/callback';
    oauth2Client = new g.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      callbackUrl
    );
  }
  return oauth2Client;
}

// 必要な権限（スコープ）
const SCOPES = [
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events'
];

// Googleログイン画面へリダイレクト
router.get('/google', (req, res) => {
  const url = getOAuth2Client().generateAuthUrl({
    access_type: 'offline', // リフレッシュトークンを取得
    scope: SCOPES,
    prompt: 'consent' // 毎回同意画面を表示（リフレッシュトークン取得のため）
  });
  res.redirect(url);
});

// Googleログインのコールバック
router.get('/google/callback', async (req, res) => {
  const { code } = req.query;

  if (!code) {
    return res.status(400).json({
      success: false,
      error: '認証コードがありません'
    });
  }

  try {
    // 認証コードをトークンに交換
    const client = getOAuth2Client();
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);

    // ユーザー情報を取得
    const oauth2 = getGoogle().oauth2({ version: 'v2', auth: client });
    const { data: userInfo } = await oauth2.userinfo.get();

    // Firestoreにユーザーを保存/更新
    const userRef = db.collection('users').doc(userInfo.id);
    const userDoc = await userRef.get();

    const userData = {
      email: userInfo.email,
      name: userInfo.name,
      picture: userInfo.picture,
      googleAccessToken: tokens.access_token,
      googleRefreshToken: tokens.refresh_token || (userDoc.exists ? userDoc.data().googleRefreshToken : null),
      updatedAt: new Date()
    };

    if (!userDoc.exists) {
      // 新規ユーザー
      userData.role = 'student'; // デフォルトは生徒
      userData.createdAt = new Date();
      userData.lineUserId = null;
    }

    await userRef.set(userData, { merge: true });

    // セッションにユーザー情報を保存
    req.session.userId = userInfo.id;
    req.session.userEmail = userInfo.email;

    // セッションを明示的に保存（Firestoreへの書き込み完了を待つ）
    await new Promise((resolve, reject) => {
      req.session.save((err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    // ポップアップウィンドウ: localStorageに保存してすぐに閉じる
    res.send(`
      <!DOCTYPE html>
      <html>
        <head><title>ログイン処理中</title></head>
        <body>
          <script>
            // ログイン成功情報をlocalStorageに保存
            localStorage.setItem('login_success', JSON.stringify({
              userId: '${userInfo.id}',
              timestamp: Date.now()
            }));
            window.close();
          </script>
        </body>
      </html>
    `);

  } catch (error) {
    console.error('Google認証エラー:', error);
    res.status(500).json({
      success: false,
      error: '認証に失敗しました',
      details: error.message
    });
  }
});

// 現在のユーザー情報を取得
router.get('/me', async (req, res) => {
  const userId = req.session?.userId || req.query.userId;

  if (!userId) {
    return res.json({
      success: false,
      user: null
    });
  }

  try {
    const userDoc = await db.collection('users').doc(userId).get();

    if (!userDoc.exists) {
      return res.json({
        success: false,
        user: null
      });
    }

    const userData = userDoc.data();
    // トークンは返さない（セキュリティ）
    delete userData.googleAccessToken;
    delete userData.googleRefreshToken;

    res.json({
      success: true,
      user: {
        id: userDoc.id,
        ...userData
      }
    });
  } catch (error) {
    console.error('ユーザー情報取得エラー:', error);
    res.json({
      success: false,
      user: null
    });
  }
});

// ユーザーの役割を更新（生徒/講師）
router.put('/role', async (req, res) => {
  const userId = req.session?.userId || req.body.userId;
  const { role } = req.body;

  if (!userId) {
    return res.status(401).json({
      success: false,
      error: 'ログインしていません'
    });
  }

  if (!['student', 'teacher'].includes(role)) {
    return res.status(400).json({
      success: false,
      error: '役割は student または teacher を指定してください'
    });
  }

  try {
    await db.collection('users').doc(userId).update({
      role,
      updatedAt: new Date()
    });

    res.json({
      success: true,
      message: `役割を ${role === 'student' ? '生徒' : '講師'} に更新しました`
    });
  } catch (error) {
    console.error('役割更新エラー:', error);
    res.status(500).json({
      success: false,
      error: '役割の更新に失敗しました'
    });
  }
});

// ユーザーの表示名を更新（初回ログイン時など）
router.put('/displayName', async (req, res) => {
  const userId = req.session?.userId || req.body.userId;
  const { displayName } = req.body;

  if (!userId) {
    return res.status(401).json({
      success: false,
      error: 'ログインしていません'
    });
  }

  if (!displayName || displayName.trim().length === 0) {
    return res.status(400).json({
      success: false,
      error: '表示名を入力してください'
    });
  }

  try {
    await db.collection('users').doc(userId).update({
      displayName: displayName.trim(),
      updatedAt: new Date()
    });

    res.json({
      success: true,
      displayName: displayName.trim()
    });
  } catch (error) {
    console.error('表示名更新エラー:', error);
    res.status(500).json({
      success: false,
      error: '表示名の更新に失敗しました'
    });
  }
});

// ログアウト
router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({
        success: false,
        error: 'ログアウトに失敗しました'
      });
    }
    res.json({
      success: true,
      message: 'ログアウトしました'
    });
  });
});

// ユーザー一覧を取得（管理用）
router.get('/users', async (req, res) => {
  try {
    const snapshot = await db.collection('users').get();
    const users = [];

    snapshot.forEach(doc => {
      const data = doc.data();
      // トークンは返さない
      delete data.googleAccessToken;
      delete data.googleRefreshToken;
      users.push({
        id: doc.id,
        ...data
      });
    });

    res.json({
      success: true,
      count: users.length,
      data: users
    });
  } catch (error) {
    console.error('ユーザー一覧取得エラー:', error);
    res.status(500).json({
      success: false,
      error: 'ユーザー一覧の取得に失敗しました'
    });
  }
});

module.exports = router;
