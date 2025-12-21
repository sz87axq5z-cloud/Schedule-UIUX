/**
 * Googleカレンダー連携サービス
 *
 * - カレンダーへの予定追加
 * - カレンダーの予定更新
 * - カレンダーの予定削除
 */

const { db } = require('../config/firebase');

// googleapis を遅延ロード（起動時間短縮のため）
let google = null;

function getGoogle() {
  if (!google) {
    google = require('googleapis').google;
  }
  return google;
}

/**
 * ユーザーのOAuth2クライアントを取得
 */
async function getOAuth2Client(userId) {
  const userDoc = await db.collection('users').doc(userId).get();

  if (!userDoc.exists) {
    throw new Error('ユーザーが見つかりません');
  }

  const userData = userDoc.data();

  if (!userData.googleRefreshToken) {
    throw new Error('Googleアカウントが連携されていません');
  }

  const oauth2Client = new (getGoogle()).auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    'http://localhost:3001/api/auth/google/callback'
  );

  // リフレッシュトークンを設定し、getAccessTokenで自動的にアクセストークンを取得
  oauth2Client.setCredentials({
    refresh_token: userData.googleRefreshToken
  });

  // アクセストークンを取得（自動的にリフレッシュされる）
  await oauth2Client.getAccessToken();

  return oauth2Client;
}

/**
 * Googleカレンダーに予定を追加
 * @param {string} userId - ユーザーID
 * @param {object} schedule - スケジュール情報
 * @param {object} options - オプション設定
 * @param {string} options.titlePrefix - タイトルの前に付ける文字列
 * @param {string} options.additionalDescription - 追加の説明文
 */
async function addEventToCalendar(userId, schedule, options = {}) {
  try {
    const auth = await getOAuth2Client(userId);
    const calendar = getGoogle().calendar({ version: 'v3', auth });

    // タイトルの組み立て
    let title = schedule.title;
    if (options.titlePrefix) {
      title = `${options.titlePrefix} ${title}`;
    }

    // 説明文の組み立て
    let description = 'スケジュール管理アプリから作成';
    if (options.additionalDescription) {
      description = `${options.additionalDescription}\n\n${description}`;
    }

    const event = {
      summary: title,
      description: description,
      start: {
        dateTime: new Date(schedule.startTime).toISOString(),
        timeZone: 'Asia/Tokyo'
      },
      end: {
        dateTime: new Date(schedule.endTime).toISOString(),
        timeZone: 'Asia/Tokyo'
      },
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'popup', minutes: 60 },    // 1時間前
          { method: 'popup', minutes: 1440 }   // 1日前
        ]
      }
    };

    const response = await calendar.events.insert({
      calendarId: 'primary',
      resource: event
    });

    console.log(`Googleカレンダーに追加: ${response.data.id}`);
    return response.data;

  } catch (error) {
    console.error('Googleカレンダー追加エラー:', error.message);
    throw error;
  }
}

/**
 * Googleカレンダーの予定を更新
 */
async function updateCalendarEvent(userId, googleEventId, schedule) {
  try {
    const auth = await getOAuth2Client(userId);
    const calendar = getGoogle().calendar({ version: 'v3', auth });

    const event = {
      summary: schedule.title,
      start: {
        dateTime: new Date(schedule.startTime).toISOString(),
        timeZone: 'Asia/Tokyo'
      },
      end: {
        dateTime: new Date(schedule.endTime).toISOString(),
        timeZone: 'Asia/Tokyo'
      }
    };

    const response = await calendar.events.update({
      calendarId: 'primary',
      eventId: googleEventId,
      resource: event
    });

    console.log(`Googleカレンダーを更新: ${response.data.id}`);
    return response.data;

  } catch (error) {
    console.error('Googleカレンダー更新エラー:', error.message);
    throw error;
  }
}

/**
 * Googleカレンダーの予定を削除
 */
async function deleteCalendarEvent(userId, googleEventId) {
  try {
    const auth = await getOAuth2Client(userId);
    const calendar = getGoogle().calendar({ version: 'v3', auth });

    await calendar.events.delete({
      calendarId: 'primary',
      eventId: googleEventId
    });

    console.log(`Googleカレンダーから削除: ${googleEventId}`);
    return true;

  } catch (error) {
    console.error('Googleカレンダー削除エラー:', error.message);
    throw error;
  }
}

/**
 * スケジュール作成時に生徒と講師のカレンダーに追加
 */
async function syncScheduleToCalendars(schedule) {
  const results = {
    student: null,
    teacher: null
  };

  // 生徒のカレンダーに追加
  if (schedule.studentId) {
    try {
      const studentEvent = await addEventToCalendar(schedule.studentId, schedule);
      results.student = {
        success: true,
        googleEventId: studentEvent.id
      };
    } catch (error) {
      results.student = {
        success: false,
        error: error.message
      };
    }
  }

  // 講師のカレンダーに追加（生徒名を表示）
  if (schedule.teacherId) {
    try {
      const teacherOptions = {};

      // 生徒名がある場合、タイトルの前に追加
      if (schedule.studentName) {
        teacherOptions.titlePrefix = `【${schedule.studentName}】`;
        teacherOptions.additionalDescription = `生徒: ${schedule.studentName}`;
      }

      const teacherEvent = await addEventToCalendar(schedule.teacherId, schedule, teacherOptions);
      results.teacher = {
        success: true,
        googleEventId: teacherEvent.id
      };
    } catch (error) {
      results.teacher = {
        success: false,
        error: error.message
      };
    }
  }

  return results;
}

/**
 * Googleカレンダーからイベント一覧を取得
 */
async function getCalendarEvents(userId, options = {}) {
  try {
    const auth = await getOAuth2Client(userId);
    const calendar = getGoogle().calendar({ version: 'v3', auth });

    // デフォルトで今日から30日分を取得
    const timeMin = options.timeMin || new Date().toISOString();
    const timeMax = options.timeMax || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: options.maxResults || 100
    });

    return response.data.items || [];
  } catch (error) {
    console.error('Googleカレンダー取得エラー:', error.message);
    throw error;
  }
}

/**
 * 特定のGoogleカレンダーイベントを取得
 */
async function getCalendarEvent(userId, googleEventId) {
  try {
    const auth = await getOAuth2Client(userId);
    const calendar = getGoogle().calendar({ version: 'v3', auth });

    const response = await calendar.events.get({
      calendarId: 'primary',
      eventId: googleEventId
    });

    return response.data;
  } catch (error) {
    // イベントが見つからない場合
    if (error.code === 404) {
      return null;
    }
    console.error('Googleカレンダーイベント取得エラー:', error.message);
    throw error;
  }
}

module.exports = {
  getOAuth2Client,
  addEventToCalendar,
  updateCalendarEvent,
  deleteCalendarEvent,
  syncScheduleToCalendars,
  getCalendarEvents,
  getCalendarEvent
};
