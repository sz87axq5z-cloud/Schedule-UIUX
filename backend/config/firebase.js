/**
 * Firebase設定
 *
 * このファイルでFirebaseへの接続を管理します
 */

const admin = require('firebase-admin');
const path = require('path');

// サービスアカウントキーを読み込む
const serviceAccount = require(path.join(__dirname, '..', 'firebase-service-account.json'));

// Firebaseを初期化
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: serviceAccount.project_id
});

// Firestoreデータベースの参照を取得
const db = admin.firestore();

// 接続確認用のログ
console.log(`Firebase接続完了: ${serviceAccount.project_id}`);

// 他のファイルから使えるようにエクスポート
module.exports = {
  admin,
  db
};
