/**
 * スケジュール関連のAPI
 *
 * - スケジュールの一覧取得
 * - スケジュールの作成
 * - スケジュールの更新
 * - スケジュールの削除
 */

const express = require('express');
const router = express.Router();
const { db } = require('../config/firebase');
const { syncScheduleToCalendars, addEventToCalendar, updateCalendarEvent, deleteCalendarEvent, getCalendarEvent } = require('../services/googleCalendar');
const { validate, schemas } = require('../middleware/validation');

// コレクション名
const COLLECTION = 'schedules';

/**
 * セキュリティ: 認証チェックヘルパー
 * セッションからユーザーIDを取得し、ユーザー情報を返す
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
 * セキュリティ: スケジュールへのアクセス権限チェック
 * ユーザーがスケジュールの関係者（生徒/講師）または講師ロールであるかを確認
 */
function canAccessSchedule(user, schedule) {
  if (!user) return false;

  // 講師ロールはすべてのスケジュールにアクセス可能
  if (user.role === 'teacher') return true;

  // スケジュールの生徒または講師である場合はアクセス可能
  return schedule.studentId === user.id || schedule.teacherId === user.id;
}

/**
 * Firestoreのタイムスタンプを ISO文字列に変換
 */
function convertTimestamp(timestamp) {
  if (!timestamp) return null;
  // Firestore Timestamp オブジェクトの場合
  if (timestamp._seconds !== undefined) {
    return new Date(timestamp._seconds * 1000).toISOString();
  }
  // toDate() メソッドがある場合（Firestore Timestamp）
  if (typeof timestamp.toDate === 'function') {
    return timestamp.toDate().toISOString();
  }
  // すでに文字列の場合
  if (typeof timestamp === 'string') {
    return timestamp;
  }
  // Dateオブジェクトの場合
  if (timestamp instanceof Date) {
    return timestamp.toISOString();
  }
  return null;
}

/**
 * スケジュールデータのタイムスタンプを変換
 */
function formatScheduleData(data) {
  return {
    ...data,
    startTime: convertTimestamp(data.startTime),
    endTime: convertTimestamp(data.endTime),
    createdAt: convertTimestamp(data.createdAt),
    updatedAt: convertTimestamp(data.updatedAt)
  };
}

// スケジュール一覧を取得
router.get('/', async (req, res) => {
  try {
    const snapshot = await db.collection(COLLECTION)
      .orderBy('startTime', 'asc')
      .get();

    const schedules = [];
    snapshot.forEach(doc => {
      schedules.push({
        id: doc.id,
        ...formatScheduleData(doc.data())
      });
    });

    res.json({
      success: true,
      count: schedules.length,
      data: schedules
    });
  } catch (error) {
    console.error('スケジュール一覧取得エラー:', error);
    res.status(500).json({
      success: false,
      error: 'スケジュールの取得に失敗しました'
    });
  }
});

// 特定のスケジュールを取得
// セキュリティ修正: 認証と所有者チェックを追加
router.get('/:id', async (req, res) => {
  try {
    // 認証チェック
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'ログインが必要です'
      });
    }

    const doc = await db.collection(COLLECTION).doc(req.params.id).get();

    if (!doc.exists) {
      return res.status(404).json({
        success: false,
        error: 'スケジュールが見つかりません'
      });
    }

    const scheduleData = doc.data();

    // 所有者チェック
    if (!canAccessSchedule(user, scheduleData)) {
      return res.status(403).json({
        success: false,
        error: 'このスケジュールへのアクセス権限がありません'
      });
    }

    res.json({
      success: true,
      data: {
        id: doc.id,
        ...scheduleData
      }
    });
  } catch (error) {
    console.error('スケジュール取得エラー:', error);
    res.status(500).json({
      success: false,
      error: 'スケジュールの取得に失敗しました'
    });
  }
});

// スケジュールを作成
// バリデーション: タイトル（1-100文字）、日時形式、開始<終了
router.post('/', validate(schemas.scheduleCreate), async (req, res) => {
  try {
    const {
      title,
      startTime,
      endTime,
      location,
      locationIcon,
      studentId,
      studentName,
      teacherId,
      teacherName
    } = req.body;

    // バリデーションはミドルウェアで実行済み

    // 生徒の表示名を取得する優先順位:
    // 1. 既存スケジュールのstudentName
    // 2. usersコレクションのdisplayName
    // 3. フロントエンドから渡されたstudentName
    let effectiveStudentName = studentName || null;
    if (studentId) {
      try {
        // まず既存スケジュールから名前を探す
        const existingSchedules = await db.collection(COLLECTION)
          .where('studentId', '==', studentId)
          .limit(1)
          .get();

        if (!existingSchedules.empty) {
          const existingData = existingSchedules.docs[0].data();
          if (existingData.studentName) {
            effectiveStudentName = existingData.studentName;
            console.log(`既存の表示名を使用: ${effectiveStudentName}`);
          }
        } else {
          // 既存スケジュールがない場合、usersコレクションからdisplayNameを取得
          const userDoc = await db.collection('users').doc(studentId).get();
          if (userDoc.exists) {
            const userData = userDoc.data();
            if (userData.displayName) {
              effectiveStudentName = userData.displayName;
              console.log(`ユーザーのdisplayNameを使用: ${effectiveStudentName}`);
            }
          }
        }
      } catch (err) {
        console.error('表示名の取得エラー:', err.message);
        // エラーが発生しても続行（元の名前を使用）
      }
    }

    const newSchedule = {
      title,
      startTime: new Date(startTime),
      endTime: new Date(endTime),
      location: location || null,
      locationIcon: locationIcon || null,
      studentId: studentId || null,
      studentName: effectiveStudentName,
      teacherId: teacherId || null,
      teacherName: teacherName || null,
      status: 'scheduled',
      studentGoogleEventId: null,
      teacherGoogleEventId: null,
      reminderSent: false,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // 講師同期はバッチ処理で行うため、pendingフラグを設定
    newSchedule.teacherSyncPending = true;

    const docRef = await db.collection(COLLECTION).add(newSchedule);

    // Googleカレンダーに同期（生徒のみ即時同期、講師はバッチ処理）
    let calendarSync = { student: null, teacher: { pending: true } };
    if (studentId) {
      try {
        // 生徒のカレンダーのみ即時同期
        const studentResult = await addEventToCalendar(studentId, newSchedule, {
          titlePrefix: null,
          additionalDescription: null
        });

        calendarSync.student = studentResult;

        // GoogleイベントIDを保存
        if (studentResult.success) {
          await docRef.update({
            studentGoogleEventId: studentResult.googleEventId
          });
        }
      } catch (syncError) {
        console.error('生徒カレンダー同期エラー:', syncError);
        calendarSync.student = { success: false, error: syncError.message };
      }
    }

    res.status(201).json({
      success: true,
      message: 'スケジュールを作成しました',
      data: {
        id: docRef.id,
        ...newSchedule
      },
      calendarSync
    });
  } catch (error) {
    console.error('スケジュール作成エラー:', error);
    res.status(500).json({
      success: false,
      error: 'スケジュールの作成に失敗しました'
    });
  }
});

// スケジュール一括登録（ウィザード用）
// 複数の場所のスケジュールを一度に登録
router.post('/bulk', validate(schemas.scheduleBulkCreate), async (req, res) => {
  try {
    const { schedules, studentId, studentName } = req.body;

    // 認証チェック（ログインユーザーを生徒として使用）
    const user = await getAuthenticatedUser(req);
    const effectiveStudentId = studentId || (user ? user.id : null);

    // 生徒の表示名を取得
    let effectiveStudentName = studentName || null;
    if (effectiveStudentId && !effectiveStudentName) {
      try {
        // 既存スケジュールから名前を探す
        const existingSchedules = await db.collection(COLLECTION)
          .where('studentId', '==', effectiveStudentId)
          .limit(1)
          .get();

        if (!existingSchedules.empty) {
          const existingData = existingSchedules.docs[0].data();
          if (existingData.studentName) {
            effectiveStudentName = existingData.studentName;
          }
        } else if (user) {
          effectiveStudentName = user.displayName || user.name;
        }
      } catch (err) {
        console.error('表示名の取得エラー:', err.message);
      }
    }

    const createdSchedules = [];
    const errors = [];

    for (const scheduleData of schedules) {
      try {
        // 場所名をタイトルとして使用
        const title = scheduleData.location;

        const newSchedule = {
          title,
          location: scheduleData.location,
          locationIcon: scheduleData.locationIcon || null,
          startTime: new Date(scheduleData.startTime),
          endTime: new Date(scheduleData.endTime),
          studentId: effectiveStudentId,
          studentName: effectiveStudentName,
          teacherId: process.env.TEACHER_USER_ID || null,
          teacherName: null,
          status: 'scheduled',
          studentGoogleEventId: null,
          teacherGoogleEventId: null,
          teacherSyncPending: true,
          reminderSent: false,
          createdAt: new Date(),
          updatedAt: new Date()
        };

        const docRef = await db.collection(COLLECTION).add(newSchedule);

        // 生徒のGoogleカレンダーに同期
        let calendarSync = { student: null };
        if (effectiveStudentId) {
          try {
            const studentResult = await addEventToCalendar(effectiveStudentId, newSchedule, {
              titlePrefix: null,
              additionalDescription: null
            });

            if (studentResult && studentResult.id) {
              await docRef.update({
                studentGoogleEventId: studentResult.id
              });
              calendarSync.student = { success: true, googleEventId: studentResult.id };
            }
          } catch (syncError) {
            console.error('生徒カレンダー同期エラー:', syncError);
            calendarSync.student = { success: false, error: syncError.message };
          }
        }

        createdSchedules.push({
          id: docRef.id,
          ...newSchedule,
          calendarSync
        });
      } catch (error) {
        console.error('スケジュール作成エラー:', error);
        errors.push({
          location: scheduleData.location,
          error: error.message
        });
      }
    }

    res.status(201).json({
      success: true,
      message: `${createdSchedules.length}件のスケジュールを作成しました`,
      data: createdSchedules,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    console.error('一括スケジュール作成エラー:', error);
    res.status(500).json({
      success: false,
      error: 'スケジュールの作成に失敗しました'
    });
  }
});

// スケジュールを更新
// セキュリティ修正: 認証と所有者チェックを追加
// バリデーション: フィールドの形式と長さをチェック
router.put('/:id', validate(schemas.scheduleUpdate), async (req, res) => {
  try {
    // 認証チェック
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'ログインが必要です'
      });
    }

    const docRef = db.collection(COLLECTION).doc(req.params.id);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({
        success: false,
        error: 'スケジュールが見つかりません'
      });
    }

    const existingData = doc.data();

    // 所有者チェック
    if (!canAccessSchedule(user, existingData)) {
      return res.status(403).json({
        success: false,
        error: 'このスケジュールを編集する権限がありません'
      });
    }

    // 更新データを準備
    const updateData = {
      ...req.body,
      updatedAt: new Date()
    };

    // 日付フィールドの変換
    if (updateData.startTime) {
      updateData.startTime = new Date(updateData.startTime);
    }
    if (updateData.endTime) {
      updateData.endTime = new Date(updateData.endTime);
    }

    await docRef.update(updateData);

    // 更新後のデータを取得
    const updatedDoc = await docRef.get();
    const updatedData = updatedDoc.data();

    // Googleカレンダーを更新
    let calendarSync = { student: null, teacher: null };

    // Firestoreのタイムスタンプを変換
    let startTimeForSync = updatedData.startTime;
    let endTimeForSync = updatedData.endTime;
    if (startTimeForSync && typeof startTimeForSync.toDate === 'function') {
      startTimeForSync = startTimeForSync.toDate();
    } else if (startTimeForSync && startTimeForSync._seconds !== undefined) {
      startTimeForSync = new Date(startTimeForSync._seconds * 1000);
    }
    if (endTimeForSync && typeof endTimeForSync.toDate === 'function') {
      endTimeForSync = endTimeForSync.toDate();
    } else if (endTimeForSync && endTimeForSync._seconds !== undefined) {
      endTimeForSync = new Date(endTimeForSync._seconds * 1000);
    }

    const scheduleForSync = {
      title: updatedData.title,
      startTime: startTimeForSync,
      endTime: endTimeForSync
    };

    // 生徒のカレンダーを更新
    if (existingData.studentId && existingData.studentGoogleEventId) {
      try {
        await updateCalendarEvent(existingData.studentId, existingData.studentGoogleEventId, scheduleForSync);
        calendarSync.student = { success: true };
        console.log(`生徒カレンダー更新成功: ${existingData.studentGoogleEventId}`);
      } catch (syncError) {
        console.error('生徒カレンダー更新エラー:', syncError.message);
        calendarSync.student = { success: false, error: syncError.message };
      }
    }

    // 講師のカレンダーを更新
    const teacherId = existingData.teacherId || process.env.TEACHER_USER_ID;
    if (teacherId && existingData.teacherGoogleEventId) {
      try {
        // 講師用は生徒名をタイトルに含める（更新後の生徒名を使用）
        const teacherSchedule = { ...scheduleForSync };
        const studentName = updatedData.studentName || existingData.studentName;
        if (studentName) {
          teacherSchedule.title = `【${studentName}】 ${scheduleForSync.title}`;
        }
        await updateCalendarEvent(teacherId, existingData.teacherGoogleEventId, teacherSchedule);
        calendarSync.teacher = { success: true };
        console.log(`講師カレンダー更新成功: ${existingData.teacherGoogleEventId}`);
      } catch (syncError) {
        console.error('講師カレンダー更新エラー:', syncError.message);
        calendarSync.teacher = { success: false, error: syncError.message };
      }
    }

    res.json({
      success: true,
      message: 'スケジュールを更新しました',
      data: {
        id: updatedDoc.id,
        ...formatScheduleData(updatedData)
      },
      calendarSync
    });
  } catch (error) {
    console.error('スケジュール更新エラー:', error);
    res.status(500).json({
      success: false,
      error: 'スケジュールの更新に失敗しました'
    });
  }
});

// スケジュールを削除
// セキュリティ修正: 認証と所有者チェックを追加
router.delete('/:id', async (req, res) => {
  try {
    // 認証チェック
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'ログインが必要です'
      });
    }

    const docRef = db.collection(COLLECTION).doc(req.params.id);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({
        success: false,
        error: 'スケジュールが見つかりません'
      });
    }

    const existingData = doc.data();

    // 所有者チェック
    if (!canAccessSchedule(user, existingData)) {
      return res.status(403).json({
        success: false,
        error: 'このスケジュールを削除する権限がありません'
      });
    }

    let calendarSync = { student: null, teacher: null };

    // 生徒のGoogleカレンダーから削除
    if (existingData.studentId && existingData.studentGoogleEventId) {
      try {
        await deleteCalendarEvent(existingData.studentId, existingData.studentGoogleEventId);
        calendarSync.student = { success: true };
      } catch (syncError) {
        console.error('生徒カレンダー削除エラー:', syncError.message);
        calendarSync.student = { success: false, error: syncError.message };
      }
    }

    // 講師のGoogleカレンダーから削除
    const teacherId = existingData.teacherId || process.env.TEACHER_USER_ID;
    if (teacherId && existingData.teacherGoogleEventId) {
      try {
        await deleteCalendarEvent(teacherId, existingData.teacherGoogleEventId);
        calendarSync.teacher = { success: true };
      } catch (syncError) {
        console.error('講師カレンダー削除エラー:', syncError.message);
        calendarSync.teacher = { success: false, error: syncError.message };
      }
    }

    // Firestoreから削除
    await docRef.delete();

    res.json({
      success: true,
      message: 'スケジュールを削除しました',
      calendarSync
    });
  } catch (error) {
    console.error('スケジュール削除エラー:', error);
    res.status(500).json({
      success: false,
      error: 'スケジュールの削除に失敗しました'
    });
  }
});

// スケジュールをキャンセル（削除ではなく履歴として残す）
router.post('/:id/cancel', async (req, res) => {
  try {
    // 認証チェック
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'ログインが必要です'
      });
    }

    const docRef = db.collection(COLLECTION).doc(req.params.id);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({
        success: false,
        error: 'スケジュールが見つかりません'
      });
    }

    const existingData = doc.data();

    // 所有者チェック
    if (!canAccessSchedule(user, existingData)) {
      return res.status(403).json({
        success: false,
        error: 'このスケジュールをキャンセルする権限がありません'
      });
    }

    // scheduled状態のみキャンセル可能
    if (existingData.status && existingData.status !== 'scheduled') {
      return res.status(400).json({
        success: false,
        error: '開始済みの予定はキャンセルできません'
      });
    }

    // ステータスをcancelledに更新
    await docRef.update({
      status: 'cancelled',
      cancelledAt: new Date(),
      cancelledBy: user.id,
      updatedAt: new Date()
    });

    res.json({
      success: true,
      message: 'スケジュールをキャンセルしました'
    });
  } catch (error) {
    console.error('スケジュールキャンセルエラー:', error);
    res.status(500).json({
      success: false,
      error: 'スケジュールのキャンセルに失敗しました'
    });
  }
});

// 特定ユーザーのスケジュールを取得
router.get('/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { role } = req.query; // ?role=student または ?role=teacher

    let query = db.collection(COLLECTION);

    if (role === 'student') {
      query = query.where('studentId', '==', userId);
    } else if (role === 'teacher') {
      query = query.where('teacherId', '==', userId);
    } else {
      // 両方の役割で検索（生徒または講師として関連するスケジュール）
      // Firestoreは OR クエリが制限されているため、2回クエリする
      const studentSnapshot = await db.collection(COLLECTION)
        .where('studentId', '==', userId)
        .get();
      const teacherSnapshot = await db.collection(COLLECTION)
        .where('teacherId', '==', userId)
        .get();

      const schedules = [];
      const seenIds = new Set();

      studentSnapshot.forEach(doc => {
        schedules.push({ id: doc.id, ...formatScheduleData(doc.data()) });
        seenIds.add(doc.id);
      });

      teacherSnapshot.forEach(doc => {
        if (!seenIds.has(doc.id)) {
          schedules.push({ id: doc.id, ...formatScheduleData(doc.data()) });
        }
      });

      // JavaScript側でソート
      schedules.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));

      return res.json({
        success: true,
        count: schedules.length,
        data: schedules
      });
    }

    const snapshot = await query.get();

    const schedules = [];
    snapshot.forEach(doc => {
      schedules.push({
        id: doc.id,
        ...formatScheduleData(doc.data())
      });
    });

    // JavaScript側でソート
    schedules.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));

    res.json({
      success: true,
      count: schedules.length,
      data: schedules
    });
  } catch (error) {
    console.error('ユーザースケジュール取得エラー:', error);
    res.status(500).json({
      success: false,
      error: 'スケジュールの取得に失敗しました'
    });
  }
});

// 古いスケジュールをGoogleカレンダーに連携
router.post('/link-to-google', async (req, res) => {
  try {
    // Googleカレンダー連携がないスケジュールを取得
    const snapshot = await db.collection(COLLECTION).get();

    const results = {
      linked: 0,
      skipped: 0,
      errors: []
    };

    for (const doc of snapshot.docs) {
      const schedule = doc.data();
      const scheduleId = doc.id;

      // 既に連携済みの場合はスキップ
      if (schedule.studentGoogleEventId || schedule.teacherGoogleEventId) {
        results.skipped++;
        continue;
      }

      // studentIdがない場合はスキップ
      if (!schedule.studentId) {
        results.skipped++;
        continue;
      }

      console.log(`Googleカレンダーに連携中: ${scheduleId} - ${schedule.title}`);

      try {
        // Firestoreのタイムスタンプを変換
        let startTime = schedule.startTime;
        let endTime = schedule.endTime;

        // Firestore Timestamp オブジェクトの場合
        if (startTime && typeof startTime.toDate === 'function') {
          startTime = startTime.toDate();
        } else if (startTime && startTime._seconds !== undefined) {
          startTime = new Date(startTime._seconds * 1000);
        }

        if (endTime && typeof endTime.toDate === 'function') {
          endTime = endTime.toDate();
        } else if (endTime && endTime._seconds !== undefined) {
          endTime = new Date(endTime._seconds * 1000);
        }

        console.log(`開始: ${startTime}, 終了: ${endTime}`);

        // Googleカレンダーに同期
        const effectiveTeacherId = schedule.teacherId || process.env.TEACHER_USER_ID;
        const calendarSync = await syncScheduleToCalendars({
          ...schedule,
          startTime,
          endTime,
          teacherId: effectiveTeacherId
        });

        // GoogleイベントIDを保存
        const updateData = { updatedAt: new Date() };
        if (calendarSync.student?.success) {
          updateData.studentGoogleEventId = calendarSync.student.googleEventId;
        }
        if (calendarSync.teacher?.success) {
          updateData.teacherGoogleEventId = calendarSync.teacher.googleEventId;
        }

        if (updateData.studentGoogleEventId || updateData.teacherGoogleEventId) {
          await db.collection(COLLECTION).doc(scheduleId).update(updateData);
          results.linked++;
          console.log(`連携成功: ${scheduleId}`);
        } else {
          results.errors.push({
            scheduleId,
            title: schedule.title,
            error: 'カレンダー同期に失敗'
          });
        }
      } catch (error) {
        console.error(`連携エラー: ${scheduleId}`, error.message);
        results.errors.push({
          scheduleId,
          title: schedule.title,
          error: error.message
        });
      }
    }

    res.json({
      success: true,
      message: '古いスケジュールをGoogleカレンダーに連携しました',
      results
    });
  } catch (error) {
    console.error('Googleカレンダー連携エラー:', error);
    res.status(500).json({
      success: false,
      error: 'Googleカレンダーへの連携に失敗しました'
    });
  }
});

// Googleカレンダーからスケジュールを同期
router.post('/sync-from-google', async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'userIdが必要です'
      });
    }

    // このユーザーに関連するスケジュールを取得
    const studentSchedules = await db.collection(COLLECTION)
      .where('studentId', '==', userId)
      .get();

    const teacherSchedules = await db.collection(COLLECTION)
      .where('teacherId', '==', userId)
      .get();

    // 両方のスケジュールをマージ（重複排除）
    const scheduleMap = new Map();
    studentSchedules.forEach(doc => {
      scheduleMap.set(doc.id, { id: doc.id, ...doc.data(), isStudent: true });
    });
    teacherSchedules.forEach(doc => {
      const existing = scheduleMap.get(doc.id);
      if (existing) {
        existing.isTeacher = true;
      } else {
        scheduleMap.set(doc.id, { id: doc.id, ...doc.data(), isTeacher: true });
      }
    });

    const syncResults = {
      updated: 0,
      deleted: 0,
      errors: []
    };

    console.log(`同期対象スケジュール数: ${scheduleMap.size}`);

    // 各スケジュールについてGoogleカレンダーの状態を確認
    for (const [scheduleId, schedule] of scheduleMap) {
      console.log(`チェック中: ${scheduleId}, studentGoogleEventId: ${schedule.studentGoogleEventId}, teacherGoogleEventId: ${schedule.teacherGoogleEventId}`);

      // 生徒のGoogleイベントを確認
      if (schedule.isStudent && schedule.studentGoogleEventId) {
        try {
          console.log(`Googleカレンダーからイベント取得: ${schedule.studentGoogleEventId}`);
          const googleEvent = await getCalendarEvent(userId, schedule.studentGoogleEventId);

          if (!googleEvent) {
            // Googleカレンダーから削除されている場合
            // アプリからも削除（ただし講師側のイベントも削除する必要がある）
            const teacherId = schedule.teacherId || process.env.TEACHER_USER_ID;
            if (teacherId && schedule.teacherGoogleEventId) {
              try {
                await deleteCalendarEvent(teacherId, schedule.teacherGoogleEventId);
              } catch (e) {
                console.error('講師カレンダー削除エラー:', e.message);
              }
            }
            await db.collection(COLLECTION).doc(scheduleId).delete();
            syncResults.deleted++;
          } else if (googleEvent.status === 'cancelled') {
            // キャンセルされた場合も削除
            const teacherId = schedule.teacherId || process.env.TEACHER_USER_ID;
            if (teacherId && schedule.teacherGoogleEventId) {
              try {
                await deleteCalendarEvent(teacherId, schedule.teacherGoogleEventId);
              } catch (e) {
                console.error('講師カレンダー削除エラー:', e.message);
              }
            }
            await db.collection(COLLECTION).doc(scheduleId).delete();
            syncResults.deleted++;
          } else {
            // イベントが更新されているか確認
            const googleStart = new Date(googleEvent.start.dateTime || googleEvent.start.date);
            const googleEnd = new Date(googleEvent.end.dateTime || googleEvent.end.date);
            const googleTitle = googleEvent.summary || '';

            const firestoreStart = schedule.startTime.toDate ? schedule.startTime.toDate() : new Date(schedule.startTime);
            const firestoreEnd = schedule.endTime.toDate ? schedule.endTime.toDate() : new Date(schedule.endTime);

            // 時間が変更されている場合は更新
            if (Math.abs(googleStart - firestoreStart) > 60000 || Math.abs(googleEnd - firestoreEnd) > 60000 || googleTitle !== schedule.title) {
              const updateData = {
                title: googleTitle,
                startTime: googleStart,
                endTime: googleEnd,
                updatedAt: new Date()
              };

              await db.collection(COLLECTION).doc(scheduleId).update(updateData);

              // 講師のGoogleカレンダーも更新
              const teacherId = schedule.teacherId || process.env.TEACHER_USER_ID;
              if (teacherId && schedule.teacherGoogleEventId) {
                try {
                  const teacherSchedule = {
                    title: schedule.studentName ? `【${schedule.studentName}】 ${googleTitle}` : googleTitle,
                    startTime: googleStart,
                    endTime: googleEnd
                  };
                  await updateCalendarEvent(teacherId, schedule.teacherGoogleEventId, teacherSchedule);
                } catch (e) {
                  console.error('講師カレンダー更新エラー:', e.message);
                }
              }

              syncResults.updated++;
            }
          }
        } catch (error) {
          syncResults.errors.push({
            scheduleId,
            error: error.message
          });
        }
      }

      // 講師としてのGoogleイベントを確認（生徒がいない場合のみ）
      if (schedule.isTeacher && !schedule.isStudent && schedule.teacherGoogleEventId) {
        try {
          const googleEvent = await getCalendarEvent(userId, schedule.teacherGoogleEventId);

          if (!googleEvent || googleEvent.status === 'cancelled') {
            // 講師側で削除された場合
            // 生徒側のイベントも削除
            if (schedule.studentId && schedule.studentGoogleEventId) {
              try {
                await deleteCalendarEvent(schedule.studentId, schedule.studentGoogleEventId);
              } catch (e) {
                console.error('生徒カレンダー削除エラー:', e.message);
              }
            }
            await db.collection(COLLECTION).doc(scheduleId).delete();
            syncResults.deleted++;
          } else {
            // 講師側でイベントが更新されているか確認
            const googleStart = new Date(googleEvent.start.dateTime || googleEvent.start.date);
            const googleEnd = new Date(googleEvent.end.dateTime || googleEvent.end.date);
            // 講師用タイトルから生徒名を除去
            let googleTitle = googleEvent.summary || '';
            const prefixMatch = googleTitle.match(/^【.*?】\s*/);
            if (prefixMatch) {
              googleTitle = googleTitle.slice(prefixMatch[0].length);
            }

            const firestoreStart = schedule.startTime.toDate ? schedule.startTime.toDate() : new Date(schedule.startTime);
            const firestoreEnd = schedule.endTime.toDate ? schedule.endTime.toDate() : new Date(schedule.endTime);

            if (Math.abs(googleStart - firestoreStart) > 60000 || Math.abs(googleEnd - firestoreEnd) > 60000 || googleTitle !== schedule.title) {
              const updateData = {
                title: googleTitle,
                startTime: googleStart,
                endTime: googleEnd,
                updatedAt: new Date()
              };

              await db.collection(COLLECTION).doc(scheduleId).update(updateData);

              // 生徒のGoogleカレンダーも更新
              if (schedule.studentId && schedule.studentGoogleEventId) {
                try {
                  await updateCalendarEvent(schedule.studentId, schedule.studentGoogleEventId, {
                    title: googleTitle,
                    startTime: googleStart,
                    endTime: googleEnd
                  });
                } catch (e) {
                  console.error('生徒カレンダー更新エラー:', e.message);
                }
              }

              syncResults.updated++;
            }
          }
        } catch (error) {
          syncResults.errors.push({
            scheduleId,
            error: error.message
          });
        }
      }
    }

    res.json({
      success: true,
      message: 'Googleカレンダーと同期しました',
      results: syncResults
    });
  } catch (error) {
    console.error('Googleカレンダー同期エラー:', error);
    res.status(500).json({
      success: false,
      error: 'Googleカレンダーとの同期に失敗しました'
    });
  }
});

// 顧客（生徒）の表示名を更新し、Googleカレンダーに同期
// セキュリティ修正: 講師のみ実行可能
// バリデーション: 表示名は1-100文字
router.put('/customer/:studentId/name', validate(schemas.customerName), async (req, res) => {
  try {
    // 認証チェック
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'ログインが必要です'
      });
    }

    // 講師のみ実行可能
    if (user.role !== 'teacher') {
      return res.status(403).json({
        success: false,
        error: 'この操作は講師のみ可能です'
      });
    }

    const { studentId } = req.params;
    const { displayName } = req.body;

    if (!displayName || !displayName.trim()) {
      return res.status(400).json({
        success: false,
        error: '表示名を入力してください'
      });
    }

    const newName = displayName.trim();

    // この生徒のすべてのスケジュールを取得
    const snapshot = await db.collection(COLLECTION)
      .where('studentId', '==', studentId)
      .get();

    if (snapshot.empty) {
      return res.status(404).json({
        success: false,
        error: '該当する生徒のスケジュールが見つかりません'
      });
    }

    const results = {
      updated: 0,
      calendarUpdated: 0,
      errors: []
    };

    // 各スケジュールの生徒名を更新
    for (const doc of snapshot.docs) {
      const schedule = doc.data();
      const scheduleId = doc.id;

      try {
        // Firestoreの生徒名を更新
        await db.collection(COLLECTION).doc(scheduleId).update({
          studentName: newName,
          updatedAt: new Date()
        });
        results.updated++;

        // 講師のGoogleカレンダーを更新（【生徒名】部分を変更）
        const teacherId = schedule.teacherId || process.env.TEACHER_USER_ID;
        if (teacherId && schedule.teacherGoogleEventId) {
          try {
            // タイムスタンプを変換
            let startTime = schedule.startTime;
            let endTime = schedule.endTime;
            if (startTime && typeof startTime.toDate === 'function') {
              startTime = startTime.toDate();
            } else if (startTime && startTime._seconds !== undefined) {
              startTime = new Date(startTime._seconds * 1000);
            }
            if (endTime && typeof endTime.toDate === 'function') {
              endTime = endTime.toDate();
            } else if (endTime && endTime._seconds !== undefined) {
              endTime = new Date(endTime._seconds * 1000);
            }

            const teacherSchedule = {
              title: `【${newName}】 ${schedule.title}`,
              startTime,
              endTime
            };
            await updateCalendarEvent(teacherId, schedule.teacherGoogleEventId, teacherSchedule);
            results.calendarUpdated++;
            console.log(`講師カレンダー更新: ${scheduleId} - 【${newName}】`);
          } catch (calendarError) {
            console.error(`講師カレンダー更新エラー: ${scheduleId}`, calendarError.message);
            results.errors.push({
              scheduleId,
              error: calendarError.message
            });
          }
        }
      } catch (error) {
        console.error(`スケジュール更新エラー: ${scheduleId}`, error.message);
        results.errors.push({
          scheduleId,
          error: error.message
        });
      }
    }

    res.json({
      success: true,
      message: `${results.updated}件のスケジュールの生徒名を更新しました`,
      newName,
      results
    });
  } catch (error) {
    console.error('生徒名更新エラー:', error);
    res.status(500).json({
      success: false,
      error: '生徒名の更新に失敗しました'
    });
  }
});

/**
 * 講師カレンダーへのバッチ同期（3時間ごとに実行）
 * teacherSyncPending: true のスケジュールを講師カレンダーに同期
 */
router.post('/batch-sync-teacher', async (req, res) => {
  try {
    const teacherId = process.env.TEACHER_USER_ID;

    if (!teacherId) {
      return res.status(400).json({
        success: false,
        error: 'TEACHER_USER_IDが設定されていません'
      });
    }

    console.log('講師カレンダーバッチ同期開始...');

    // teacherSyncPending: true のスケジュールを取得
    const pendingSnapshot = await db.collection(COLLECTION)
      .where('teacherSyncPending', '==', true)
      .get();

    if (pendingSnapshot.empty) {
      return res.json({
        success: true,
        message: '同期が必要なスケジュールはありません',
        synced: 0,
        errors: 0
      });
    }

    console.log(`同期対象: ${pendingSnapshot.size}件`);

    let syncedCount = 0;
    let errorCount = 0;
    const errors = [];

    for (const doc of pendingSnapshot.docs) {
      const schedule = doc.data();
      const scheduleId = doc.id;

      try {
        // Firestoreのタイムスタンプを変換
        let startTime = schedule.startTime;
        let endTime = schedule.endTime;

        if (startTime && typeof startTime.toDate === 'function') {
          startTime = startTime.toDate();
        } else if (startTime && startTime._seconds !== undefined) {
          startTime = new Date(startTime._seconds * 1000);
        }

        if (endTime && typeof endTime.toDate === 'function') {
          endTime = endTime.toDate();
        } else if (endTime && endTime._seconds !== undefined) {
          endTime = new Date(endTime._seconds * 1000);
        }

        // 講師カレンダーに同期
        const calendarResult = await addEventToCalendar(teacherId, {
          ...schedule,
          startTime,
          endTime
        }, {
          titlePrefix: schedule.studentName ? `【${schedule.studentName}】` : null,
          additionalDescription: schedule.studentName ? `生徒: ${schedule.studentName}` : null
        });

        // addEventToCalendarは成功時にGoogleイベントオブジェクトを返す
        if (calendarResult && calendarResult.id) {
          // 同期成功：フラグを更新
          await doc.ref.update({
            teacherSyncPending: false,
            teacherGoogleEventId: calendarResult.id,
            teacherSyncedAt: new Date()
          });
          syncedCount++;
          console.log(`同期成功: ${scheduleId} - ${schedule.title}`);
        } else {
          errorCount++;
          errors.push({ scheduleId, title: schedule.title, error: 'カレンダーイベントIDが取得できませんでした' });
        }
      } catch (error) {
        console.error(`同期エラー: ${scheduleId}`, error.message);
        errorCount++;
        errors.push({ scheduleId, title: schedule.title, error: error.message });
      }
    }

    res.json({
      success: true,
      message: `講師カレンダーへの同期が完了しました`,
      synced: syncedCount,
      errors: errorCount,
      errorDetails: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    console.error('講師カレンダーバッチ同期エラー:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * 開発用: テストデータセットアップ
 * POST /api/schedules/dev/setup-test-data
 */
router.post('/dev/setup-test-data', async (req, res) => {
  // 開発環境のみ
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ success: false, error: 'Development only' });
  }

  try {
    const { keepScheduleId } = req.body || {};

    // LINE連携済みの生徒を自動的に取得
    let testUserId = req.body?.testUserId || process.env.TEST_USER_ID;
    let testUserName = '横地';

    if (!testUserId) {
      // LINE連携済みの生徒を検索（インデックス不要なクエリ）
      const usersSnapshot = await db.collection('users').get();
      const lineLinkedStudent = usersSnapshot.docs.find(doc => {
        const data = doc.data();
        return data.role === 'student' && data.lineUserId;
      });

      if (lineLinkedStudent) {
        testUserId = lineLinkedStudent.id;
        const userData = lineLinkedStudent.data();
        testUserName = userData.displayName || userData.name || '生徒';
        console.log(`テスト用にLINE連携済み生徒を使用: ${testUserId} (${testUserName})`);
      } else {
        testUserId = 'test-student-001';
        console.log('LINE連携済み生徒が見つからないため、ダミーIDを使用');
      }
    }

    // 既存スケジュールを削除（keepScheduleId以外）
    const snapshot = await db.collection(COLLECTION).get();
    const batch = db.batch();
    let deleteCount = 0;

    snapshot.docs.forEach(doc => {
      if (doc.id !== keepScheduleId) {
        batch.delete(doc.ref);
        deleteCount++;
      }
    });

    await batch.commit();

    // テスト用スケジュールを作成
    const now = new Date();
    const testSchedules = [];

    // 1. 要フォロー用（過去の日付、scheduled状態）
    const overdueDate = new Date(now);
    overdueDate.setDate(overdueDate.getDate() - 3);
    overdueDate.setHours(10, 0, 0, 0);
    const overdueSchedule = {
      title: 'クローゼット整理',
      location: 'クローゼット',
      locationIcon: '🧥',
      startTime: overdueDate,
      endTime: new Date(overdueDate.getTime() + 2 * 60 * 60 * 1000),
      studentId: testUserId,
      studentName: testUserName,
      status: 'scheduled',
      createdAt: new Date()
    };
    const overdueRef = await db.collection(COLLECTION).add(overdueSchedule);
    testSchedules.push({ id: overdueRef.id, type: 'overdue', ...overdueSchedule });

    // 2. 1時間前リマインド用（約1時間後）
    const oneHourLater = new Date(now);
    oneHourLater.setMinutes(oneHourLater.getMinutes() + 65); // 65分後
    oneHourLater.setSeconds(0);
    const hourlySchedule = {
      title: '【テスト】1時間前リマインド確認',
      location: 'キッチン',
      locationIcon: '🍳',
      startTime: oneHourLater,
      endTime: new Date(oneHourLater.getTime() + 60 * 60 * 1000),
      studentId: testUserId,
      studentName: testUserName,
      status: 'scheduled',
      createdAt: new Date()
    };
    const hourlyRef = await db.collection(COLLECTION).add(hourlySchedule);
    testSchedules.push({ id: hourlyRef.id, type: 'hourly-reminder', ...hourlySchedule });

    // 3. 前日リマインド用（明日の朝）
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(10, 0, 0, 0);
    const dailySchedule = {
      title: '【テスト】前日リマインド確認',
      location: 'リビング',
      locationIcon: '🛋️',
      startTime: tomorrow,
      endTime: new Date(tomorrow.getTime() + 2 * 60 * 60 * 1000),
      studentId: testUserId,
      studentName: testUserName,
      status: 'scheduled',
      createdAt: new Date()
    };
    const dailyRef = await db.collection(COLLECTION).add(dailySchedule);
    testSchedules.push({ id: dailyRef.id, type: 'daily-reminder', ...dailySchedule });

    // 4. 写真承認テスト用（pending_approval状態）
    const approvalTestDate = new Date(now);
    approvalTestDate.setDate(approvalTestDate.getDate() - 1);
    approvalTestDate.setHours(14, 0, 0, 0);
    const approvalSchedule = {
      title: '洗面所整理',
      location: '洗面所',
      locationIcon: '🚿',
      startTime: approvalTestDate,
      endTime: new Date(approvalTestDate.getTime() + 2 * 60 * 60 * 1000),
      studentId: testUserId,
      studentName: testUserName,
      status: 'pending_approval',
      beforePhoto: {
        url: 'demo-before-photo.jpg',
        submittedAt: new Date(approvalTestDate.getTime() + 30 * 60 * 1000)
      },
      afterPhoto: {
        url: 'demo-after-photo.jpg',
        submittedAt: new Date(approvalTestDate.getTime() + 2 * 60 * 60 * 1000)
      },
      createdAt: new Date()
    };
    const approvalRef = await db.collection(COLLECTION).add(approvalSchedule);
    testSchedules.push({ id: approvalRef.id, type: 'pending-approval', ...approvalSchedule });

    res.json({
      success: true,
      message: `${deleteCount}件削除、${testSchedules.length}件作成`,
      deletedCount: deleteCount,
      createdSchedules: testSchedules.map(s => ({
        id: s.id,
        type: s.type,
        title: s.title,
        startTime: s.startTime
      }))
    });
  } catch (error) {
    console.error('テストデータセットアップエラー:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
