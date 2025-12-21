/**
 * Firestoreセッションストア
 *
 * express-sessionと連携してセッションをFirestoreに永続化
 */

const session = require('express-session');
const { db } = require('./firebase');

class FirestoreStore extends session.Store {
  constructor(options = {}) {
    super();
    this.collection = db.collection(options.collection || 'sessions');
    this.ttl = options.ttl || 30 * 60 * 1000; // デフォルト30分
  }

  async get(sid, callback) {
    try {
      const doc = await this.collection.doc(sid).get();
      if (!doc.exists) {
        return callback(null, null);
      }

      const data = doc.data();

      // 有効期限チェック
      if (data.expires && new Date(data.expires) < new Date()) {
        await this.destroy(sid, () => {});
        return callback(null, null);
      }

      callback(null, data.session);
    } catch (error) {
      callback(error);
    }
  }

  async set(sid, session, callback) {
    try {
      const expires = session.cookie && session.cookie.expires
        ? new Date(session.cookie.expires)
        : new Date(Date.now() + this.ttl);

      // セッションオブジェクトをプレーンなJSONに変換（Firestoreはカスタムプロトタイプを保存できない）
      const sessionData = JSON.parse(JSON.stringify(session));

      await this.collection.doc(sid).set({
        session: sessionData,
        expires: expires.toISOString(),
        updatedAt: new Date().toISOString()
      });

      callback && callback(null);
    } catch (error) {
      callback && callback(error);
    }
  }

  async destroy(sid, callback) {
    try {
      await this.collection.doc(sid).delete();
      callback && callback(null);
    } catch (error) {
      callback && callback(error);
    }
  }

  async touch(sid, session, callback) {
    // セッションの有効期限を更新
    try {
      const expires = session.cookie && session.cookie.expires
        ? new Date(session.cookie.expires)
        : new Date(Date.now() + this.ttl);

      await this.collection.doc(sid).update({
        expires: expires.toISOString(),
        updatedAt: new Date().toISOString()
      });

      callback && callback(null);
    } catch (error) {
      // ドキュメントが存在しない場合は新規作成
      this.set(sid, session, callback);
    }
  }
}

module.exports = FirestoreStore;
