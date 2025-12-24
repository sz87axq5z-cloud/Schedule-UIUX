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

// コレクション名
const COLLECTION = 'schedules';

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
router.get('/:id', async (req, res) => {
  try {
    const doc = await db.collection(COLLECTION).doc(req.params.id).get();

    if (!doc.exists) {
      return res.status(404).json({
        success: false,
        error: 'スケジュールが見つかりません'
      });
    }

    res.json({
      success: true,
      data: {
        id: doc.id,
        ...doc.data()
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
router.post('/', async (req, res) => {
  try {
    const {
      title,
      startTime,
      endTime,
      studentId,
      studentName,
      teacherId,
      teacherName
    } = req.body;

    // 必須項目のチェック
    if (!title || !startTime || !endTime) {
      return res.status(400).json({
        success: false,
        error: 'タイトル、開始時間、終了時間は必須です'
      });
    }

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
      studentId: studentId || null,
      studentName: effectiveStudentName,
      teacherId: teacherId || null,
      teacherName: teacherName || null,
      status: 'scheduled',
      googleEventId: null,
      reminderSent: false,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const docRef = await db.collection(COLLECTION).add(newSchedule);

    // Googleカレンダーに同期（生徒・講師）
    // 講師IDが指定されていない場合は、環境変数のデフォルト講師を使用
    const effectiveTeacherId = teacherId || process.env.TEACHER_USER_ID;

    let calendarSync = null;
    if (studentId || effectiveTeacherId) {
      try {
        calendarSync = await syncScheduleToCalendars({
          ...newSchedule,
          studentId,
          teacherId: effectiveTeacherId
        });

        // GoogleイベントIDを保存
        const googleEventIds = {};
        if (calendarSync.student?.success) {
          googleEventIds.studentGoogleEventId = calendarSync.student.googleEventId;
        }
        if (calendarSync.teacher?.success) {
          googleEventIds.teacherGoogleEventId = calendarSync.teacher.googleEventId;
        }
        if (Object.keys(googleEventIds).length > 0) {
          await docRef.update(googleEventIds);
        }
      } catch (syncError) {
        console.error('Googleカレンダー同期エラー:', syncError);
        // カレンダー同期に失敗してもスケジュール作成は成功とする
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

// スケジュールを更新
router.put('/:id', async (req, res) => {
  try {
    const docRef = db.collection(COLLECTION).doc(req.params.id);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({
        success: false,
        error: 'スケジュールが見つかりません'
      });
    }

    const existingData = doc.data();

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
router.delete('/:id', async (req, res) => {
  try {
    const docRef = db.collection(COLLECTION).doc(req.params.id);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({
        success: false,
        error: 'スケジュールが見つかりません'
      });
    }

    const existingData = doc.data();
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
router.put('/customer/:studentId/name', async (req, res) => {
  try {
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

module.exports = router;
