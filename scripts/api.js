/**
 * バックエンドAPI連携サービス
 */

// 同一オリジンで配信するため相対パスを使用
const API_BASE = '/api';

// 現在ログイン中のユーザー情報
let currentUser = null;

// セッション管理用のキー
const SESSION_KEY = 'schedule_app_session';
const SESSION_TIMEOUT = 30 * 60 * 1000; // 30分

/**
 * セッション情報を保存
 */
function saveSession(userId) {
  const session = {
    userId,
    lastActivity: Date.now()
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

/**
 * セッション情報を取得（30分以内なら有効）
 */
function getValidSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;

    const session = JSON.parse(raw);
    const elapsed = Date.now() - session.lastActivity;

    if (elapsed > SESSION_TIMEOUT) {
      // 30分以上経過 - セッション無効
      localStorage.removeItem(SESSION_KEY);
      return null;
    }

    return session;
  } catch (e) {
    return null;
  }
}

/**
 * 最終アクティビティ時間を更新
 */
function updateLastActivity() {
  const session = getValidSession();
  if (session) {
    session.lastActivity = Date.now();
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  }
}

/**
 * セッションをクリア
 */
function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

/**
 * APIリクエストを送信
 */
async function apiRequest(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;
  const config = {
    credentials: 'include', // セッションCookieを送信
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    },
    ...options
  };

  try {
    const response = await fetch(url, config);
    const data = await response.json();
    // APIリクエスト成功時にアクティビティ時間を更新
    updateLastActivity();
    return data;
  } catch (error) {
    console.error('API Error:', error);
    throw error;
  }
}

/**
 * Googleログイン（新しいウィンドウで開く）
 * @param {Function} onPopupClosed - ポップアップが閉じた時に呼ばれるコールバック
 */
function startGoogleLogin(onPopupClosed) {
  const width = 500;
  const height = 600;
  const left = (window.innerWidth - width) / 2;
  const top = (window.innerHeight - height) / 2;

  // ログイン成功フラグをクリア
  localStorage.removeItem('login_success');

  const authWindow = window.open(
    `${API_BASE}/auth/google`,
    'Google Login',
    `width=${width},height=${height},left=${left},top=${top}`
  );

  // ログイン完了を待つ
  return new Promise((resolve) => {
    const checkClosed = setInterval(async () => {
      if (authWindow.closed) {
        clearInterval(checkClosed);

        // ポップアップが閉じたことを通知
        if (onPopupClosed) {
          onPopupClosed();
        }

        // ポップアップが保存したログイン成功情報を確認
        const loginSuccess = localStorage.getItem('login_success');
        if (loginSuccess) {
          try {
            const { userId } = JSON.parse(loginSuccess);
            localStorage.removeItem('login_success');

            // ユーザー情報を取得
            const result = await apiRequest(`/auth/me?userId=${userId}`);
            if (result.success && result.user) {
              currentUser = result.user;
              saveSession(result.user.id);
              resolve(result.user);
              return;
            }
          } catch (e) {
            console.error('Login error:', e);
          }
        }
        resolve(null);
      }
    }, 500);
  });
}

/**
 * ログイン状態を確認（localStorageのセッションを使用）
 */
async function checkLoginStatus() {
  try {
    // まずlocalStorageのセッションをチェック
    const session = getValidSession();
    if (!session) {
      return null;
    }

    // セッションが有効ならユーザー情報を取得
    const result = await apiRequest(`/auth/me?userId=${session.userId}`);
    if (result.success && result.user) {
      currentUser = result.user;
      updateLastActivity(); // アクティビティ時間を更新
      return result.user;
    }

    // ユーザー情報取得に失敗したらセッションをクリア
    clearSession();
    return null;
  } catch (error) {
    return null;
  }
}

/**
 * ログアウト
 */
async function logout() {
  try {
    await apiRequest('/auth/logout', { method: 'POST' });
    currentUser = null;
    clearSession(); // localStorageのセッションもクリア
    return true;
  } catch (error) {
    clearSession();
    return false;
  }
}

/**
 * スケジュール一覧を取得
 * 生徒は自分のスケジュールのみ、講師は全スケジュールを取得
 */
async function getSchedules() {
  // 生徒の場合は自分のスケジュールのみ取得
  if (currentUser && currentUser.role === 'student') {
    // linkedStudentIdがある場合はそのIDでスケジュールを取得
    const studentId = currentUser.linkedStudentId || currentUser.id;
    const result = await apiRequest(`/schedules/user/${studentId}?role=student`);
    if (result.success) {
      return result.data;
    }
    return [];
  }

  // 講師の場合は全スケジュールを取得
  const result = await apiRequest('/schedules');
  if (result.success) {
    return result.data;
  }
  return [];
}

/**
 * スケジュールを作成
 */
async function createSchedule(schedule) {
  const result = await apiRequest('/schedules', {
    method: 'POST',
    body: JSON.stringify(schedule)
  });
  return result;
}

/**
 * スケジュールを更新
 */
async function updateSchedule(id, schedule) {
  const result = await apiRequest(`/schedules/${id}`, {
    method: 'PUT',
    body: JSON.stringify(schedule)
  });
  return result;
}

/**
 * スケジュールを削除
 */
async function deleteSchedule(id) {
  const result = await apiRequest(`/schedules/${id}`, {
    method: 'DELETE'
  });
  return result;
}

/**
 * Googleカレンダーからアプリに同期
 */
async function syncFromGoogleCalendar(userId) {
  const result = await apiRequest('/schedules/sync-from-google', {
    method: 'POST',
    body: JSON.stringify({ userId })
  });
  return result;
}

/**
 * 顧客（生徒）の表示名を更新
 * Googleカレンダーの【】内の名前も同期される
 */
async function updateCustomerName(studentId, displayName) {
  const result = await apiRequest(`/schedules/customer/${studentId}/name`, {
    method: 'PUT',
    body: JSON.stringify({ displayName })
  });
  return result;
}

/**
 * 現在のユーザーを取得
 */
function getCurrentUser() {
  return currentUser;
}

// グローバルに公開
window.scheduleAPI = {
  startGoogleLogin,
  checkLoginStatus,
  logout,
  getSchedules,
  createSchedule,
  updateSchedule,
  deleteSchedule,
  syncFromGoogleCalendar,
  updateCustomerName,
  getCurrentUser
};
