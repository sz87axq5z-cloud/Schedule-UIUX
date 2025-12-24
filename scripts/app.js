/* ===========================================================
  Monotone Schedule App (Vanilla JS)
  - 疑似ログイン
  - 週ビュー
  - 前後移動 / 今週
  - ミニカレンダーから週ジャンプ
  - ダミーイベント表示 + カレンダーフィルタ
  - グリッドドラッグで新規予定作成（モーダル経由）
=========================================================== */

// ---------- 状態 ----------
const state = {
  current: startOfDay(new Date()),
  miniMonthCursor: startOfMonth(new Date()),
  filters: new Set(["personal", "team", "external"]),
  dragging: null, // {startY, endY, dayIndex, rect, el}
  view: 'week', // 'month' | 'week' | 'day'
};

let editingEventId = null;
let editingUserId = null;

// ---------- データ（APIから取得） ----------
// APIから取得したスケジュールを格納
let events = [];
const userStore = window.sharedUsers || [];
let currentUserId = null;
let loggedInUser = null;

// APIモード（trueの場合はバックエンドAPIを使用）
const USE_API = true;

// ---------- 要素 ----------
const $login = byId("login");
const $loginBtn = byId("loginBtn");
const $modeSelect = byId("modeSelect");
const $goTasks = byId("goTasks");
const $goCalendar = byId("goCalendar");
const $app = byId("app");
const $appHeaderRight = document.querySelector('.app-header-right');
const $headerGoCalendar = byId("headerGoCalendar");
const $headerMonthPrev = byId("headerMonthPrev");
const $headerMonthNext = byId("headerMonthNext");
const $headerWeekPrev = byId("headerWeekPrev");
const $headerWeekNext = byId("headerWeekNext");
const $headerUndo = byId("headerUndo");
const $calendarMain = byId("calendarMain");
const $tasksMain = byId("tasksMain");
const $tasksTodayList = byId("tasksTodayList");
const $tasksOverdueList = byId("tasksOverdueList");
const $tasksUpcomingList = byId("tasksUpcomingList");
const $tasksStatusButtons = Array.from(document.querySelectorAll('.tasks-status-btn'));
const $weekHeader = byId("weekHeader");
const $weekGrid = byId("weekGrid");
const $loading = byId("loading");
const $currentRange = byId("currentRange");

const $prevWeek = byId("prevWeek");
const $nextWeek = byId("nextWeek");
const $today = byId("today");

const $miniPrev = byId("miniPrev");
const $miniNext = byId("miniNext");
const $miniMonthLabel = byId("miniMonthLabel");
const $miniGrid = byId("miniGrid");

const $modal = byId("eventModal");
const $overlay = byId("modalOverlay");
const $modalClose = byId("modalClose");
const $modalCancel = byId("modalCancel");
const $eventForm = byId("eventForm");
const $titleInput = byId("titleInput");
const $startDateInput = byId("startDateInput");
const $startTimeInput = byId("startTimeInput");
const $endDateInput = byId("endDateInput");
const $endTimeInput = byId("endTimeInput");
const $calendarInput = byId("calendarInput");
const $statusInput = byId("statusInput");
const $calendarFab = byId("calendarFab");
const $tasksFab = byId("tasksFab");
const $modalDelete = byId("modalDelete");
const $modalLoading = byId("modalLoading");
const $modalLoadingText = byId("modalLoadingText");

// 名前入力モーダル
const $nameModal = byId("nameModal");
const $nameModalOverlay = byId("nameModalOverlay");
const $nameForm = byId("nameForm");
const $displayNameInput = byId("displayNameInput");

// LINE連携モーダル
const $lineModal = byId("lineModal");
const $lineModalOverlay = byId("lineModalOverlay");
const $lineLinkCode = byId("lineLinkCode");
const $lineSkipBtn = byId("lineSkipBtn");
const $lineCheckBtn = byId("lineCheckBtn");

// ブラウザ履歴制御用フラグ
let suppressHistory = false;

const $filterInputs = Array.from(document.querySelectorAll(".cal-list input[type=checkbox]"));

// ヘッダー・メニュー
const $menuBtn = byId("menuBtn");
const $sidebarOverlay = byId("sidebarOverlay");
const $todayIconBtn = document.querySelector('.icon-view');
const $headerMonthLabel = byId("headerMonthLabel");
const $navViewItems = Array.from(document.querySelectorAll('.nav-view-item'));

// ビュー切替ボタン
const $viewMonth = byId('viewMonth');
const $viewWeek = byId('viewWeek');
const $viewDay = byId('viewDay');

// ---------- 初期化 ----------
window.addEventListener("DOMContentLoaded", async () => {
  // APIモードの場合、ログイン状態を確認
  let isLoggedIn = false;
  let savedState = null;

  if (USE_API) {
    // ログイン済みかつ保存された画面状態がある場合、先にログイン画面を非表示にする
    savedState = restoreScreenState();
    const session = localStorage.getItem('schedule_app_session');
    if (session && savedState && (savedState.screen === 'calendar' || savedState.screen === 'tasks')) {
      // 先にアプリ画面を表示（ログイン画面を見せない）
      if ($login) {
        $login.style.display = "none";
        $login.setAttribute("aria-hidden", "true");
      }
      if ($app) {
        $app.style.display = "block";
        $app.setAttribute("aria-hidden", "false");
      }
      document.body.classList.add("logged-in");
    }

    const user = await window.scheduleAPI.checkLoginStatus();
    if (user) {
      loggedInUser = user;
      currentUserId = user.id;
      isLoggedIn = true;
      // スケジュールを取得（Googleカレンダーから同期）
      await loadSchedulesFromAPI(true);
    } else {
      // ログインに失敗した場合、ログイン画面に戻す
      savedState = null;
      if ($login) {
        $login.style.display = "block";
        $login.setAttribute("aria-hidden", "false");
      }
      if ($app) {
        $app.style.display = "none";
        $app.setAttribute("aria-hidden", "true");
      }
      document.body.classList.remove("logged-in");
    }
  } else {
    // ダミーデータを使用
    events = (window.sharedEvents || []).map(ev => ({ ...ev }));
    currentUserId = userStore.length ? userStore[0].id : (events[0] && events[0].userId) || null;
  }

  simulateLoading(() => {
    renderMiniCalendar();
    renderWeekView();

    // ログイン済みの場合、保存された画面状態を復元
    if (isLoggedIn) {
      if (savedState && (savedState.screen === 'calendar' || savedState.screen === 'tasks')) {
        // 保存された画面を直接表示
        if (savedState.current) {
          state.current = new Date(savedState.current);
        }
        switchToApp();
        if (savedState.view) setView(savedState.view);
        if (savedState.screen === 'tasks') {
          showMainMode('tasks');
          renderTasksFromEvents();
        } else {
          showMainMode('calendar');
        }
      } else {
        // 保存された状態がない場合はモード選択画面へ
        if ($loginBtn) $loginBtn.style.display = "none";
        if ($modeSelect) {
          $modeSelect.style.display = "flex";
          $modeSelect.setAttribute("aria-hidden", "false");
        }
      }
    }
  });

  // Googleログイン
  const $loginOverlay = byId("loginOverlay");
  const $loginCard = document.querySelector('.login-card');

  if ($loginBtn) {
    $loginBtn.addEventListener("click", async () => {
      if (USE_API) {
        // 本物のGoogleログイン
        $loginBtn.textContent = 'ログイン中...';
        $loginBtn.disabled = true;

        // ポップアップが閉じたらオーバーレイを表示するコールバック
        const showOverlay = () => {
          // ログインカードを非表示にしてオーバーレイを表示
          if ($loginCard) {
            $loginCard.style.display = 'none';
          }
          if ($loginOverlay) {
            $loginOverlay.style.display = 'flex';
          }
        };

        const user = await window.scheduleAPI.startGoogleLogin(showOverlay);

        if (user) {
          loggedInUser = user;
          currentUserId = user.id;
          // スケジュールを取得（Googleカレンダーから同期）
          await loadSchedulesFromAPI(true);

          // オーバーレイを非表示
          if ($loginOverlay) {
            $loginOverlay.style.display = 'none';
          }

          // 初回ログイン時（displayNameがない場合）は名前入力モーダルを表示
          if (!user.displayName) {
            if ($loginCard) {
              $loginCard.style.display = 'block';
            }
            showNameModal();
          } else {
            // モード選択へ
            if ($loginCard) {
              $loginCard.style.display = 'block';
            }
            $loginBtn.style.display = "none";
            if ($modeSelect) {
              $modeSelect.style.display = "flex";
              $modeSelect.setAttribute("aria-hidden", "false");
            } else {
              switchToApp();
            }
            pushScreenState('mode-select');
          }
        } else {
          // ログイン失敗時
          if ($loginOverlay) {
            $loginOverlay.style.display = 'none';
          }
          if ($loginCard) {
            $loginCard.style.display = 'block';
          }
          $loginBtn.textContent = 'Googleでログイン';
          $loginBtn.disabled = false;
          alert('ログインに失敗しました');
        }
      } else {
        // 疑似ログイン
        $loginBtn.style.display = "none";
        if ($modeSelect) {
          $modeSelect.style.display = "flex";
          $modeSelect.setAttribute("aria-hidden", "false");
        } else {
          switchToApp();
        }
        pushScreenState('mode-select');
      }
    });
  } else {
    console.warn("loginBtn not found");
  }

  // 名前入力モーダルを表示
  function showNameModal() {
    if ($nameModal && $nameModalOverlay) {
      $nameModalOverlay.classList.add('open');
      $nameModal.classList.add('open');
      $nameModal.setAttribute('aria-hidden', 'false');
      $nameModalOverlay.setAttribute('aria-hidden', 'false');
      if ($displayNameInput) {
        $displayNameInput.value = '';
        $displayNameInput.focus();
      }
    }
  }

  // 名前入力モーダルを閉じる
  function hideNameModal() {
    if ($nameModal && $nameModalOverlay) {
      $nameModalOverlay.classList.remove('open');
      $nameModal.classList.remove('open');
      $nameModal.setAttribute('aria-hidden', 'true');
      $nameModalOverlay.setAttribute('aria-hidden', 'true');
    }
  }

  // 名前入力後にモード選択へ進む
  function proceedToModeSelect() {
    if ($loginBtn) $loginBtn.style.display = "none";
    if ($modeSelect) {
      $modeSelect.style.display = "flex";
      $modeSelect.setAttribute("aria-hidden", "false");
    } else {
      switchToApp();
    }
    pushScreenState('mode-select');
  }

  // LINE連携モーダルを表示
  async function showLineModal() {
    if ($lineModal && $lineModalOverlay) {
      $lineModalOverlay.classList.add('open');
      $lineModal.classList.add('open');
      $lineModal.setAttribute('aria-hidden', 'false');
      $lineModalOverlay.setAttribute('aria-hidden', 'false');

      // 連携コードを取得
      if ($lineLinkCode) {
        $lineLinkCode.textContent = '------';
      }
      try {
        const result = await window.scheduleAPI.getLineLinkCode();
        if (result.success && result.linkCode) {
          if ($lineLinkCode) {
            $lineLinkCode.textContent = result.linkCode;
          }
        }
      } catch (error) {
        console.error('連携コード取得エラー:', error);
      }
    }
  }

  // LINE連携モーダルを閉じる
  function hideLineModal() {
    if ($lineModal && $lineModalOverlay) {
      $lineModalOverlay.classList.remove('open');
      $lineModal.classList.remove('open');
      $lineModal.setAttribute('aria-hidden', 'true');
      $lineModalOverlay.setAttribute('aria-hidden', 'true');
    }
  }

  // LINE連携スキップボタンのハンドラー
  if ($lineSkipBtn) {
    $lineSkipBtn.addEventListener('click', () => {
      hideLineModal();
      proceedToModeSelect();
    });
  }

  // LINE連携確認ボタンのハンドラー
  if ($lineCheckBtn) {
    $lineCheckBtn.addEventListener('click', async () => {
      if ($lineCheckBtn) {
        $lineCheckBtn.disabled = true;
        $lineCheckBtn.textContent = '確認中...';
      }

      try {
        const result = await window.scheduleAPI.checkLineStatus();
        if (result.success && result.linked) {
          alert('LINE連携が完了しました！');
          hideLineModal();
          proceedToModeSelect();
        } else {
          alert('まだLINE連携が完了していません。\nLINEで連携コードを送信してください。');
        }
      } catch (error) {
        console.error('LINE連携確認エラー:', error);
        alert('連携状態の確認に失敗しました');
      } finally {
        if ($lineCheckBtn) {
          $lineCheckBtn.disabled = false;
          $lineCheckBtn.textContent = '連携を確認';
        }
      }
    });
  }

  // 名前入力フォームのハンドラー
  if ($nameForm) {
    $nameForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const displayName = $displayNameInput?.value?.trim();
      if (!displayName) {
        alert('名前を入力してください');
        return;
      }

      // ボタンを無効化
      const submitBtn = $nameForm.querySelector('button[type="submit"]');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = '登録中...';
      }

      try {
        const result = await window.scheduleAPI.updateDisplayName(displayName);
        if (result.success) {
          hideNameModal();
          // LINE連携モーダルを表示
          showLineModal();
        } else {
          alert(result.error || '登録に失敗しました');
        }
      } catch (error) {
        console.error('名前登録エラー:', error);
        alert('登録に失敗しました');
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = '登録';
        }
      }
    });
  }

  // ログイン後モード選択: タスク一覧
  if ($goTasks) {
    $goTasks.addEventListener("click", () => {
      switchToApp();
      showMainMode('tasks');
      renderTasksFromEvents();
      pushScreenState('tasks');
    });
  }

  // ログイン後モード選択: カレンダーへ
  if ($goCalendar) {
    $goCalendar.addEventListener("click", () => {
      switchToApp();
      showMainMode('calendar');
      pushScreenState('calendar');
    });
  }

  // タスク一覧表示中ヘッダーからカレンダーへ戻る
  if ($headerGoCalendar) {
    $headerGoCalendar.addEventListener('click', () => {
      // 今どちらを表示しているかでトグル
      if ($tasksMain && $tasksMain.style.display === 'block') {
        // タスク一覧 → カレンダーへ
        showMainMode('calendar');
        pushScreenState('calendar');
      } else {
        // カレンダー → タスク一覧へ
        showMainMode('tasks');
        renderTasksFromEvents();
        pushScreenState('tasks');
      }
    });
  }

  // 月ビュー用ヘッダーの＜ ＞ナビ
  if ($headerMonthPrev) {
    $headerMonthPrev.addEventListener('click', () => {
      state.current = addMonths(startOfMonth(state.current), -1);
      setView('month');
      pushScreenState('calendar');
    });
  }
  if ($headerMonthNext) {
    $headerMonthNext.addEventListener('click', () => {
      state.current = addMonths(startOfMonth(state.current), 1);
      setView('month');
      pushScreenState('calendar');
    });
  }

  // 週ビュー用ヘッダーの「前の週」「次の週」
  if ($headerWeekPrev) {
    $headerWeekPrev.addEventListener('click', () => {
      navigate(-1);
      pushScreenState('calendar');
    });
  }
  if ($headerWeekNext) {
    $headerWeekNext.addEventListener('click', () => {
      navigate(1);
      pushScreenState('calendar');
    });
  }

  // 共通の「戻る」ボタン（1つ前の状態へ）
  if ($headerUndo) {
    $headerUndo.addEventListener('click', () => {
      history.back();
    });
  }

  // ナビ（ビューに応じて移動幅を変更）
  $prevWeek.addEventListener("click", () => { navigate(-1); pushScreenState('calendar'); });
  $nextWeek.addEventListener("click", () => { navigate(1); pushScreenState('calendar'); });
  $today.addEventListener("click", () => {
    state.current = startOfDay(new Date());
    renderView();
    pushScreenState('calendar');
  });

  // ビュー切替（ヘッダーの月/週/日ボタン）
  if ($viewMonth) $viewMonth.addEventListener('click', () => { setView('month'); pushScreenState('calendar'); });
  if ($viewWeek) $viewWeek.addEventListener('click', () => { setView('week'); pushScreenState('calendar'); });
  if ($viewDay)  $viewDay.addEventListener('click', () => { setView('day');  pushScreenState('calendar'); });

  // ミニカレンダー
  $miniPrev.addEventListener("click", () => { state.miniMonthCursor = addMonths(state.miniMonthCursor, -1); renderMiniCalendar(); });
  $miniNext.addEventListener("click", () => { state.miniMonthCursor = addMonths(state.miniMonthCursor, 1); renderMiniCalendar(); });

  // フィルタ
  $filterInputs.forEach(inp => {
    inp.addEventListener("change", () => {
      if (inp.checked) state.filters.add(inp.value); else state.filters.delete(inp.value);
      renderView();
    });
  });

  // モーダル
  $modalClose.addEventListener("click", closeModal);
  $modalCancel.addEventListener("click", closeModal);
  $overlay.addEventListener("click", closeModal);
  $eventForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    await addEvent();
  });

  // 削除ボタン
  if ($modalDelete) {
    $modalDelete.addEventListener("click", async () => {
      if (!editingEventId) return;
      if (!confirm('この予定を削除しますか？')) return;
      await deleteEvent(editingEventId);
    });
  }

  // 編集ボタンは廃止（イベントタップ時に直接編集モードで開く）

  // ヘッダー右側の「19」ボタンで今日に戻る
  if ($todayIconBtn) {
    $todayIconBtn.addEventListener('click', () => {
      state.current = startOfDay(new Date());
      renderView();
    });
  }

  // ハンバーガーメニュー（モバイル用サイドバー）
  if ($menuBtn) {
    $menuBtn.addEventListener("click", () => {
      document.body.classList.add("sidebar-open");
    });
  }
  if ($sidebarOverlay) {
    $sidebarOverlay.addEventListener("click", () => {
      document.body.classList.remove("sidebar-open");
    });
  }

  // ハンバーガーメニュー内の表示期間切替（日・週・月）
  if ($navViewItems.length) {
    $navViewItems.forEach(btn => {
      btn.addEventListener('click', () => {
        const v = btn.dataset.view;
        if (v === 'day' || v === 'week' || v === 'month') {
          setView(v);
          pushScreenState('calendar');
        }
        // 見た目の選択状態を更新
        $navViewItems.forEach(b => b.classList.toggle('is-active', b === btn));
        // メニューを閉じる
        document.body.classList.remove('sidebar-open');
      });
    });
  }

  // 初期画面（ログイン）を履歴に追加
  pushScreenState('login');

  setupTasksStatusControl();

  // 時刻セレクト(15分刻み)を生成
  populateTimeSelect($startTimeInput);
  populateTimeSelect($endTimeInput);

  // カレンダー画面右下の「＋」ボタンから新規予定を追加
  if ($calendarFab) {
    $calendarFab.addEventListener('click', () => {
      const now = new Date();
      const start = new Date(now);
      const end = new Date(now);
      end.setHours(end.getHours() + 1);
      openModal({ title: "", start, end });
    });
  }

  // タスク一覧画面右下の「＋」ボタンから新規予定を追加
  if ($tasksFab) {
    $tasksFab.addEventListener('click', () => {
      const now = new Date();
      const start = new Date(now);
      const end = new Date(now);
      end.setHours(end.getHours() + 1);
      openModal({ title: "", start, end });
    });
  }

  // タスク一覧画面内の「タスクを追加」ボタン
  const $tasksAddBtn = byId('tasksAddBtn');
  if ($tasksAddBtn) {
    $tasksAddBtn.addEventListener('click', () => {
      const now = new Date();
      const start = new Date(now);
      const end = new Date(now);
      end.setHours(end.getHours() + 1);
      openModal({ title: "", start, end });
    });
  }

  // ブラウザバック対応
  window.addEventListener('popstate', (e) => {
    const st = e.state;
    if (!st || !st.screen) return;
    suppressHistory = true;
    try {
      if (st.screen === 'login') {
        switchToLogin();
      } else if (st.screen === 'mode-select') {
        switchToLogin();
        if ($loginBtn) $loginBtn.style.display = "none";
        if ($modeSelect) {
          $modeSelect.style.display = "flex";
          $modeSelect.setAttribute("aria-hidden", "false");
        }
      } else {
        // アプリ画面系
        if (st.current) {
          state.current = new Date(st.current);
        }
        switchToApp();
        if (st.view) setView(st.view);
        if (st.screen === 'tasks') {
          showMainMode('tasks');
          renderTasksFromEvents();
        } else {
          showMainMode('calendar');
        }
      }
    } finally {
      suppressHistory = false;
    }
  });
});

// ---------- 日付ユーティリティ ----------
function getStartOfWeek(date) {
  // 月曜始まり
  const d = new Date(date);
  const day = d.getDay(); // 0=日
  const diff = (day === 0 ? -6 : 1 - day);
  d.setDate(d.getDate() + diff);
  d.setHours(0,0,0,0);
  return d;
}

function getWeekDates(date) {
  const start = getStartOfWeek(date);
  return Array.from({length:7}, (_,i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

function startOfDay(d){ const x = new Date(d); x.setHours(0,0,0,0); return x; }
function startOfMonth(d){ const x = new Date(d); x.setDate(1); x.setHours(0,0,0,0); return x; }
function addDays(d, n){ const x = new Date(d); x.setDate(x.getDate()+n); return x; }
function addMonths(d, n){ const x = new Date(d); x.setMonth(x.getMonth()+n); return x; }
function formatYMD(d){ return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function pad(n){ return String(n).padStart(2,"0"); }
function uid(){ return Math.random().toString(36).slice(2,10); }
function clamp(v,min,max){ return Math.max(min, Math.min(max, v)); }
function minutesSinceStart(d){ return d.getHours()*60 + d.getMinutes(); }
function setDateTimeISO(base, weekdayIdx, h, m){
  // weekdayIdx: 0=Mon, 6=Sun のつもりで扱う
  const start = getStartOfWeek(base);
  const d = addDays(start, weekdayIdx);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
}

// ---------- レンダリング ----------
function renderWeekView() {
  const days = getWeekDates(state.current);
  updateHeaderMonth();
  renderWeekHeader(days);
  renderWeekGrid(days);
  $currentRange.textContent = `${formatHeaderRange(days[0], days[6])}`;
}

function renderDayView(){
  // 1日分の週ビュー縮小版
  const day = startOfDay(state.current);
  updateHeaderMonth();
  const days = [day];
  renderDayHeader(days);
  renderDayGrid(days);
  $currentRange.textContent = `${day.getFullYear()}年 ${day.getMonth()+1}月 ${day.getDate()}日 (${['日','月','火','水','木','金','土'][day.getDay()]})`;
}

function renderMonthView(){
  // 月全体 7x6 グリッド
  const cur = startOfMonth(state.current);
  const first = getFirstVisibleCell(cur);
  updateHeaderMonth(cur);
  $weekHeader.innerHTML = '';
  // 月ビューでは時間列を持たない7列ヘッダー
  $weekHeader.style.display = 'grid';
  $weekHeader.style.gridTemplateColumns = 'repeat(7, 1fr)';
  // 曜日行
  const header = document.createElement('div');
  header.className = 'month-header-row';
  header.style.gridColumn = '1 / span 7';
  const dows = ['月','火','水','木','金','土','日'];
  dows.forEach(label=>{
    const c = document.createElement('div');
    c.className = 'mh-cell';
    c.textContent = label;
    header.appendChild(c);
  });
  $weekHeader.appendChild(header);

  // 月グリッド
  const grid = document.createElement('div');
  grid.className = 'month-grid';
  grid.style.gridColumn = '1 / span 7';
  // 月ビューでは7カラムのみ
  $weekGrid.style.display = 'grid';
  $weekGrid.style.gridTemplateColumns = 'repeat(7,1fr)';
  for(let i=0;i<42;i++){
    const d = addDays(first, i);
    const cell = document.createElement('div');
    cell.className = 'month-cell' + (d.getMonth()===cur.getMonth()? '' : ' muted') + (isSameDate(d, new Date())? ' today': '');
    cell.innerHTML = `<div class="mc-date">${d.getDate()}</div><div class="mc-evlist"></div>`;
    // 当日のイベント（フィルタ適用、終日扱いはなしなので当日範囲にかかるもの）
    const dayStart = startOfDay(d), dayEnd = addDays(dayStart,1);
    const list = events.filter(ev => state.filters.has(ev.calendar)).filter(ev=> new Date(ev.start) < dayEnd && new Date(ev.end) > dayStart);
    const ul = cell.querySelector('.mc-evlist');
    list.slice(0,3).forEach(ev=>{
      const li = document.createElement('div');
      li.className = 'mc-ev';
      li.textContent = `${fmtTime(new Date(ev.start))} ${ev.title}`;
      ul.appendChild(li);
    });
    if(list.length>3){
      const more = document.createElement('div');
      more.className = 'mc-more';
      more.textContent = `+${list.length-3}`;
      ul.appendChild(more);
    }
    cell.addEventListener('click', ()=>{
      state.current = d;
      setView('day');
      pushScreenState('calendar');
    });
    grid.appendChild(cell);
  }
  $weekGrid.innerHTML = '';
  $weekGrid.appendChild(grid);
  $currentRange.textContent = `${cur.getFullYear()}年 ${cur.getMonth()+1}月`;
}

function updateHeaderMonth(baseDate){
  if (!$headerMonthLabel) return;
  const d = baseDate ? new Date(baseDate) : new Date(state.current);
  if (state.view === 'month') {
    $headerMonthLabel.textContent = `${d.getMonth()+1}月`;
  } else {
    $headerMonthLabel.textContent = `${d.getFullYear()}年 ${d.getMonth()+1}月`;
  }
}

function renderWeekHeader(days){
  $weekHeader.innerHTML = "";
  // 8カラム: 時間 + 7日
  $weekHeader.style.display = 'grid';
  $weekHeader.style.gridTemplateColumns = 'var(--time-col-w) repeat(7, 1fr)';
  const timeCell = document.createElement("div");
  timeCell.className = "cell";
  timeCell.innerHTML = `<div class="dow">時間</div>`;
  $weekHeader.appendChild(timeCell);

  const dow = ["月","火","水","木","金","土","日"];
  days.forEach((d, i) => {
    const cell = document.createElement("div");
    cell.className = "cell";
    const isToday = isSameDate(d, new Date());
    cell.innerHTML = `
      <div class="dow">${dow[i]}</div>
      <div class="date" style="${isToday?'font-weight:700;color:#000;':''}">${d.getMonth()+1}/${d.getDate()}</div>
    `;
    $weekHeader.appendChild(cell);
  });
}

function renderDayHeader(days){
  $weekHeader.innerHTML = "";
  // 2カラム: 時間 + 1日
  $weekHeader.style.display = 'grid';
  $weekHeader.style.gridTemplateColumns = 'var(--time-col-w) 1fr';
  const timeCell = document.createElement("div");
  timeCell.className = "cell";
  timeCell.innerHTML = `<div class="dow">時間</div>`;
  $weekHeader.appendChild(timeCell);

  const dow = ["日","月","火","水","木","金","土"];
  days.forEach((d, i) => {
    const cell = document.createElement("div");
    cell.className = "cell";
    const isToday = isSameDate(d, new Date());
    cell.innerHTML = `
      <div class="dow">${dow[d.getDay()]}</div>
      <div class="date" style="${isToday?'font-weight:700;color:#000;':''}">${d.getMonth()+1}/${d.getDate()}</div>
    `;
    $weekHeader.appendChild(cell);
  });
}

function renderWeekGrid(days){
  // グリッド骨格
  $weekGrid.innerHTML = "";
  // 8カラム: 時間 + 7日
  $weekGrid.style.display = 'grid';
  $weekGrid.style.gridTemplateColumns = 'var(--time-col-w) repeat(7,1fr)';
  // 時間列
  const timeCol = document.createElement("div");
  timeCol.className = "time-col";
  for(let h=0; h<24; h++){
    const t = document.createElement("div");
    t.className = "time";
    t.textContent = `${pad(h)}:00`;
    timeCol.appendChild(t);
  }
  $weekGrid.appendChild(timeCol);

  // 日列
  days.forEach((d, dayIndex) => {
    const col = document.createElement("div");
    col.className = "day-col";
    col.dataset.dayIndex = String(dayIndex);

    for(let h=0; h<24; h++){
      const hour = document.createElement("div");
      hour.className = "hour";
      // 30分線
      const half = document.createElement("div");
      half.className = "hour half";
      hour.appendChild(half);
      col.appendChild(hour);
    }

    // ドラッグ選択
    attachDragHandlers(col, dayIndex);
    $weekGrid.appendChild(col);
  });

  // イベント描画
  drawEvents(days);
}

function renderDayGrid(days){
  // 日ビュー専用: 左に時間列 + 右に1日分だけをフル幅で表示
  const day = days[0];
  $weekGrid.innerHTML = "";
  // 2カラム: 時間 + 1日
  $weekGrid.style.display = 'grid';
  $weekGrid.style.gridTemplateColumns = 'var(--time-col-w) 1fr';

  // 時間列
  const timeCol = document.createElement("div");
  timeCol.className = "time-col";
  for(let h=0; h<24; h++){
    const t = document.createElement("div");
    t.className = "time";
    t.textContent = `${pad(h)}:00`;
    timeCol.appendChild(t);
  }
  $weekGrid.appendChild(timeCol);

  // 1日分の列
  const col = document.createElement("div");
  col.className = "day-col";
  col.dataset.dayIndex = "0";

  for(let h=0; h<24; h++){
    const hour = document.createElement("div");
    hour.className = "hour";
    const half = document.createElement("div");
    half.className = "hour half";
    hour.appendChild(half);
    col.appendChild(hour);
  }

  attachDragHandlers(col, 0);
  $weekGrid.appendChild(col);

  // イベント描画（days は1要素だが共通ロジックを再利用）
  drawEvents(days);
}

function drawEvents(days){
  const dayEvents = days.map(() => []);

  // フィルタ後に当週分だけ
  events.forEach(ev => {
    if (!state.filters.has(ev.calendar)) return;
    const s = new Date(ev.start);
    const e = new Date(ev.end);
    days.forEach((d, i) => {
      const d0 = startOfDay(d);
      const d1 = addDays(d0, 1);
      if (s < d1 && e > d0) {
        // 当日内の切り出し
        const start = new Date(Math.max(s, d0));
        const end = new Date(Math.min(e, d1));
        dayEvents[i].push({...ev, _start:start, _end:end});
      }
    });
  });

  // 重なり処理: 各日のイベントをグループ化してカラム割り当て
  dayEvents.forEach((list, dayIndex) => {
    list.sort((a,b)=> new Date(a._start) - new Date(b._start));
    const groups = buildOverlapGroups(list);
    groups.forEach(group => {
      const lanes = [];
      group.forEach(ev => {
        let lane = 0;
        while(lanes[lane] && isOverlap(lanes[lane], ev)){ lane++; }
        if(!lanes[lane]) lanes[lane] = [];
        lanes[lane].push(ev);
        ev._lane = lane;
        ev._laneCount = 0; // 後で設定
      });
      const laneCount = lanes.length;
      group.forEach(ev => ev._laneCount = laneCount);
    });

    // DOM配置
    const col = $weekGrid.querySelector(`.day-col[data-day-index="${dayIndex}"]`);
    list.forEach(ev => {
      const el = document.createElement("div");
      el.className = "event";
      const top = minutesSinceStart(ev._start) / (60) * varNum("--cell-h"); // px
      const endTop = minutesSinceStart(ev._end) / (60) * varNum("--cell-h");
      const height = Math.max(18, endTop - top);
      const widthPct = 100 / ev._laneCount;
      const leftPct = ev._lane * widthPct;

      el.style.top = `${top}px`;
      el.style.left = `${leftPct}%`;
      el.style.width = `calc(${widthPct}% - 4px)`;
      el.style.height = `${height}px`;
      el.innerHTML = `
        <div class="title">${escapeHtml(ev.title)}</div>
        <div class="meta">${fmtTime(ev._start)} - ${fmtTime(ev._end)}・${labelForCalendar(ev.calendar)}</div>
      `;
      // 既存イベント上ではドラッグ選択を開始しない
      el.addEventListener('mousedown', (e) => {
        e.stopPropagation();
      });
      el.addEventListener('click', () => {
        openEventDetail(ev);
      });
      $weekGrid.querySelector(`.day-col[data-day-index="${dayIndex}"]`).appendChild(el);
    });
  });
}

// ---------- ドラッグ選択 ----------
function attachDragHandlers(col, dayIndex){
  col.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    startDrag(e, col, dayIndex);
  });
  col.addEventListener("mousemove", (e) => moveDrag(e));
  document.addEventListener("mouseup", (e) => endDrag(e));
}

function startDrag(e, col, dayIndex){
  document.body.classList.add("noselect");
  const rect = col.getBoundingClientRect();
  const startY = clamp(e.clientY - rect.top + col.scrollTop, 0, col.scrollHeight);
  const el = document.createElement("div");
  el.className = "selection";
  col.appendChild(el);

  state.dragging = { startY, endY:startY, dayIndex, rect, el, col };

  updateSelection();
}

function moveDrag(e){
  if(!state.dragging) return;
  const { rect, col } = state.dragging;
  const y = clamp(e.clientY - rect.top + col.scrollTop, 0, col.scrollHeight);
  state.dragging.endY = y;
  updateSelection();
}

function endDrag(){
  if(!state.dragging) return;
  const { startY, endY, dayIndex, el, col } = state.dragging;
  const minY = Math.min(startY, endY);
  const maxY = Math.max(startY, endY);
  el.remove();
  state.dragging = null;
  document.body.classList.remove("noselect");

  // 15分刻みに丸め
  const day = getWeekDates(state.current)[dayIndex];
  const startMin = quantize(minY / varNum("--cell-h") * 60, 15);
  const endMin = quantize(maxY / varNum("--cell-h") * 60, 15);
  if (endMin - startMin < 15) return; // 最小15分

  const start = new Date(day);
  start.setMinutes(startMin);
  const end = new Date(day);
  end.setMinutes(endMin);

  openModal({
    title: "",
    start,
    end
  });
}

function updateSelection(){
  const { startY, endY, el } = state.dragging;
  const top = Math.min(startY, endY);
  const height = Math.max(8, Math.abs(endY - startY));
  el.style.top = `${top}px`;
  el.style.left = `4px`;
  el.style.right = `4px`;
  el.style.height = `${height}px`;
}

// ---------- モーダル ----------
function openModal({title, start, end}){
  // 新規作成モードとして初期化
  editingEventId = null;
  editingUserId = currentUserId;
  $titleInput.removeAttribute('disabled');
  $startDateInput.removeAttribute('disabled');
  $startTimeInput.removeAttribute('disabled');
  $endDateInput.removeAttribute('disabled');
  $endTimeInput.removeAttribute('disabled');
  $calendarInput.removeAttribute('disabled');
  if ($statusInput) $statusInput.removeAttribute('disabled');

  const submitBtn = $eventForm.querySelector('button[type="submit"]');
  if (submitBtn) {
    submitBtn.style.display = '';
    submitBtn.textContent = '追加';
    submitBtn.disabled = false;
  }

  // 新規作成時は削除ボタンを非表示
  if ($modalDelete) $modalDelete.style.display = 'none';
  // ローディングを非表示
  if ($modalLoading) $modalLoading.style.display = 'none';

  const modalTitleEl = document.getElementById('modalTitle');
  if (modalTitleEl) modalTitleEl.textContent = '新規予定';

  $titleInput.value = title || "";
  setDateTimeInputs(start, $startDateInput, $startTimeInput);
  setDateTimeInputs(end, $endDateInput, $endTimeInput);
  $calendarInput.value = "personal";
  if ($statusInput) $statusInput.value = 'before';
  $modal.setAttribute("aria-hidden","false");
  $overlay.setAttribute("aria-hidden","false");
  $titleInput.focus();
}

function closeModal(){
  $modal.setAttribute("aria-hidden","true");
  $overlay.setAttribute("aria-hidden","true");
}

async function addEvent(){
  const title = $titleInput.value.trim();
  const start = buildDateFromInputs($startDateInput, $startTimeInput);
  const end = buildDateFromInputs($endDateInput, $endTimeInput);
  const calendar = $calendarInput.value;
  const status = $statusInput ? $statusInput.value : null;

  if(!title || !(start < end)) return;

  // ローディング表示と二重タップ防止
  const submitBtn = $eventForm.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.disabled = true;
  if ($modalDelete) $modalDelete.disabled = true;
  if ($modalLoading) {
    $modalLoading.style.display = 'flex';
    if ($modalLoadingText) {
      $modalLoadingText.textContent = editingEventId ? '更新中...' : '登録中...';
    }
  }

  if (USE_API) {
    // APIを使用してスケジュールを保存
    try {
      if (editingEventId) {
        // 更新
        const result = await window.scheduleAPI.updateSchedule(editingEventId, {
          title,
          startTime: start.toISOString(),
          endTime: end.toISOString()
        });
        if (result.success) {
          await loadSchedulesFromAPI();
        }
      } else {
        // 新規作成
        const scheduleData = {
          title,
          startTime: start.toISOString(),
          endTime: end.toISOString(),
          studentId: currentUserId,
          studentName: loggedInUser ? (loggedInUser.displayName || loggedInUser.name) : null
        };
        const result = await window.scheduleAPI.createSchedule(scheduleData);
        if (result.success) {
          await loadSchedulesFromAPI();
          // カレンダー同期結果を表示
          if (result.calendarSync) {
            const syncInfo = [];
            if (result.calendarSync.student?.success) {
              syncInfo.push('生徒カレンダー');
            }
            if (result.calendarSync.teacher?.success) {
              syncInfo.push('講師カレンダー');
            }
            if (syncInfo.length > 0) {
              console.log(`Googleカレンダーに同期: ${syncInfo.join(', ')}`);
            }
          }
        }
      }
    } catch (error) {
      console.error('スケジュール保存エラー:', error);
      alert('スケジュールの保存に失敗しました');
      // エラー時はローディングを非表示にしてボタンを有効化
      if ($modalLoading) $modalLoading.style.display = 'none';
      if (submitBtn) submitBtn.disabled = false;
      if ($modalDelete) $modalDelete.disabled = false;
      return;
    }
  } else {
    // ローカルモード
    if (editingEventId) {
      const target = events.find(ev => ev.id === editingEventId);
      if (target) {
        target.title = title;
        target.start = start.toISOString();
        target.end = end.toISOString();
        target.calendar = calendar;
      }
      if (editingUserId && status) {
        setUserStatus(editingUserId, status);
      }
    } else {
      events.push({
        id: uid(),
        title,
        start: start.toISOString(),
        end: end.toISOString(),
        calendar
      });
      if (currentUserId && status) {
        setUserStatus(currentUserId, status);
      }
    }
  }

  // ローディング非表示
  if ($modalLoading) $modalLoading.style.display = 'none';
  if (submitBtn) submitBtn.disabled = false;
  if ($modalDelete) $modalDelete.disabled = false;

  closeModal();
  editingEventId = null;
  renderWeekView();
  // タスク一覧表示中の場合は再描画
  if ($tasksMain && $tasksMain.style.display === 'block') {
    renderTasksFromEvents();
  }
}

/**
 * スケジュールを削除
 */
async function deleteEvent(eventId) {
  if (!eventId) return;

  // ローディング表示と二重タップ防止
  const submitBtn = $eventForm.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.disabled = true;
  if ($modalDelete) $modalDelete.disabled = true;
  if ($modalLoading) {
    $modalLoading.style.display = 'flex';
    if ($modalLoadingText) {
      $modalLoadingText.textContent = '削除中...';
    }
  }

  if (USE_API) {
    try {
      const result = await window.scheduleAPI.deleteSchedule(eventId);
      if (result.success) {
        await loadSchedulesFromAPI();
      } else {
        alert('削除に失敗しました');
        // エラー時はローディングを非表示にしてボタンを有効化
        if ($modalLoading) $modalLoading.style.display = 'none';
        if (submitBtn) submitBtn.disabled = false;
        if ($modalDelete) $modalDelete.disabled = false;
        return;
      }
    } catch (error) {
      console.error('スケジュール削除エラー:', error);
      alert('削除に失敗しました');
      // エラー時はローディングを非表示にしてボタンを有効化
      if ($modalLoading) $modalLoading.style.display = 'none';
      if (submitBtn) submitBtn.disabled = false;
      if ($modalDelete) $modalDelete.disabled = false;
      return;
    }
  } else {
    // ローカルモード
    const idx = events.findIndex(ev => ev.id === eventId);
    if (idx >= 0) {
      events.splice(idx, 1);
    }
  }

  // ローディング非表示
  if ($modalLoading) $modalLoading.style.display = 'none';
  if (submitBtn) submitBtn.disabled = false;
  if ($modalDelete) $modalDelete.disabled = false;

  closeModal();
  editingEventId = null;
  renderWeekView();
  // タスク一覧表示中の場合は再描画
  if ($tasksMain && $tasksMain.style.display === 'block') {
    renderTasksFromEvents();
  }
}

/**
 * APIからスケジュールを取得してevents配列を更新
 * @param {boolean} syncFirst - trueの場合、先にGoogleカレンダーから同期する
 */
async function loadSchedulesFromAPI(syncFirst = false) {
  try {
    // Googleカレンダーから同期（ログイン済みの場合のみ）
    if (syncFirst && currentUserId) {
      try {
        console.log('Googleカレンダーから同期中...');
        const syncResult = await window.scheduleAPI.syncFromGoogleCalendar(currentUserId);
        if (syncResult.success) {
          console.log('同期完了:', syncResult.results);
        }
      } catch (syncError) {
        console.error('Googleカレンダー同期エラー:', syncError);
        // 同期に失敗しても続行
      }
    }

    const schedules = await window.scheduleAPI.getSchedules();
    // APIのフォーマットをフロントエンドのフォーマットに変換
    events = schedules.map(s => ({
      id: s.id,
      userId: s.studentId,
      userName: s.studentName,
      title: s.title,
      start: s.startTime,
      end: s.endTime,
      calendar: 'personal', // デフォルト
      status: s.status
    }));
    console.log(`${events.length}件のスケジュールを読み込みました`);
  } catch (error) {
    console.error('スケジュール取得エラー:', error);
    events = [];
  }
}

// ---------- ミニカレンダー ----------
function renderMiniCalendar(){
  const cur = state.miniMonthCursor;
  $miniMonthLabel.textContent = `${cur.getFullYear()}年 ${cur.getMonth()+1}月`;

  // グリッド作成（6週表示）
  const first = getFirstVisibleCell(cur);
  $miniGrid.innerHTML = "";
  for(let i=0;i<42;i++){
    const d = addDays(first, i);
    const cell = document.createElement("div");
    const inMonth = d.getMonth() === cur.getMonth();
    const isToday = isSameDate(d, new Date());
    cell.className = "mini-cell" + (inMonth? "": " muted") + (isToday? " today": "");
    cell.textContent = d.getDate();
    cell.setAttribute("role","button");
    cell.setAttribute("tabindex","0");
    cell.addEventListener("click", () => {
      // 対象日の含まれる週/日へジャンプ（現在のビューに合わせる）
      state.current = d;
      renderView();
      // 日付選択後はメニューを閉じる
      document.body.classList.remove('sidebar-open');
    });
    cell.addEventListener("keydown", (e) => {
      if(e.key === "Enter" || e.key === " "){
        e.preventDefault();
        state.current = d;
        renderView();
        document.body.classList.remove('sidebar-open');
      }
    });
    $miniGrid.appendChild(cell);
  }
}

// ---------- ナビ ----------
function changeWeek(delta){
  state.current = addDays(state.current, delta*7);
  renderWeekView();
}

function navigate(delta){
  if(state.view==='week'){
    state.current = addDays(state.current, delta*7);
    renderWeekView();
  }else if(state.view==='month'){
    state.current = addMonths(state.current, delta);
    renderMonthView();
  }else{
    state.current = addDays(state.current, delta);
    renderDayView();
  }
}

function setView(v){
  state.view = v;
  // aria-selected 更新
  if ($viewMonth) $viewMonth.setAttribute('aria-selected', v==='month'?'true':'false');
  if ($viewWeek) $viewWeek.setAttribute('aria-selected', v==='week'?'true':'false');
  if ($viewDay) $viewDay.setAttribute('aria-selected', v==='day'?'true':'false');
  if (v === 'month') {
    document.body.classList.add('month-view');
  } else {
    document.body.classList.remove('month-view');
  }
  if (v === 'week') {
    document.body.classList.add('week-view');
  } else {
    document.body.classList.remove('week-view');
  }
  if (v === 'day') {
    document.body.classList.add('day-view');
    // 日ビューでは1時間あたりの高さを大きめにして1日分を強調
    document.documentElement.style.setProperty('--cell-h', '96px');
    if ($headerWeekPrev) $headerWeekPrev.textContent = '＜';
    if ($headerWeekNext) $headerWeekNext.textContent = '＞';
  } else {
    document.body.classList.remove('day-view');
    // それ以外のビューではデフォルトの高さに戻す
    document.documentElement.style.setProperty('--cell-h', '40px');
    if (v === 'week') {
      if ($headerWeekPrev) $headerWeekPrev.textContent = '＜';
      if ($headerWeekNext) $headerWeekNext.textContent = '＞';
    }
  }
  // ビュー切替時にはハンバーガーメニューを必ず閉じる
  document.body.classList.remove('sidebar-open');
  renderView();
}

function renderView(){
  if(state.view==='month') return renderMonthView();
  if(state.view==='day') return renderDayView();
  return renderWeekView();
}

// ---------- ローディング ----------
function simulateLoading(cb){
  $loading.style.display = "block";
  setTimeout(() => {
    $loading.style.display = "none";
    cb();
  }, 400);
}

// ---------- タスク一覧: ステータス同期 ----------
function getUserById(id){
  if (!id) return null;
  return userStore.find(u => u.id === id) || null;
}

function getCurrentUserStatus(){
  const user = getUserById(currentUserId);
  return (user && user.status) || 'before';
}

function setCurrentUserStatus(status){
  setUserStatus(currentUserId, status);
}

function setupTasksStatusControl(){
  if (!$tasksStatusButtons.length || !currentUserId) return;

  const applyActive = () => {
    const cur = getCurrentUserStatus();
    $tasksStatusButtons.forEach(btn => {
      const st = btn.dataset.status;
      btn.classList.toggle('is-active', st === cur);
    });
  };

  applyActive();

  $tasksStatusButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const st = btn.dataset.status;
      if (!st) return;
      setCurrentUserStatus(st);
      applyActive();
    });
  });
}

function setUserStatus(userId, status){
  const user = getUserById(userId);
  if (!user) return;
  user.status = status;

  // ユーザーステータスを localStorage に保存して、管理画面と共有
  try {
    const key = 'userStatusOverrides';
    const raw = window.localStorage && window.localStorage.getItem(key);
    const map = raw ? JSON.parse(raw) : {};
    map[userId] = status;
    window.localStorage && window.localStorage.setItem(key, JSON.stringify(map));
  } catch (e) {
    // 保存に失敗してもアプリ本体の動作は続行
  }
}

// ---------- ヘルパ ----------
// date+time input 用ヘルパー
function setDateTimeInputs(d, $date, $time){
  const local = new Date(d);
  if ($date) {
    const y = local.getFullYear();
    const m = String(local.getMonth()+1).padStart(2,'0');
    const day = String(local.getDate()).padStart(2,'0');
    $date.value = `${y}-${m}-${day}`;
  }
  if ($time) {
    const h = String(local.getHours()).padStart(2,'0');
    const mm = String(local.getMinutes()).padStart(2,'0');
    $time.value = `${h}:${mm}`;
  }
}

function buildDateFromInputs($date, $time){
  if (!$date || !$time || !$date.value || !$time.value) return new Date(NaN);
  const [y,m,d] = $date.value.split('-').map(v => parseInt(v,10));
  const [hh,mm] = $time.value.split(':').map(v => parseInt(v,10));
  const dt = new Date(y, (m||1)-1, d||1, hh||0, mm||0, 0, 0);
  // 念のため15分刻みに丸め
  const mins = dt.getHours()*60 + dt.getMinutes();
  const snapped = quantize(mins, 15);
  dt.setHours(Math.floor(snapped/60), snapped%60, 0, 0);
  return dt;
}

function populateTimeSelect($sel){
  if (!$sel) return;
  $sel.innerHTML = '';
  for (let h = 0; h < 24; h++){
    for (let m = 0; m < 60; m += 15){
      const hh = String(h).padStart(2,'0');
      const mm = String(m).padStart(2,'0');
      const opt = document.createElement('option');
      opt.value = `${hh}:${mm}`;
      opt.textContent = `${hh}:${mm}`;
      $sel.appendChild(opt);
    }
  }
}

function labelForCalendar(key){
  return key === "personal" ? "個人" : key === "team" ? "チーム" : "外部";
}
function escapeHtml(s){ return s.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
function isSameDate(a,b){ return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate(); }
function fmtTime(d){ return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
function openEventDetail(ev){
  try {
    const start = new Date(ev._start || ev.start);
    const end = new Date(ev._end || ev.end);

    editingEventId = ev.id;
    editingUserId = ev.userId || currentUserId;

    // 詳細モード用の値セット
    $titleInput.value = ev.title || '';
    setDateTimeInputs(start, $startDateInput, $startTimeInput);
    setDateTimeInputs(end, $endDateInput, $endTimeInput);
    if (ev.calendar) {
      $calendarInput.value = ev.calendar;
    }
    if ($statusInput) {
      const st = getUserById(editingUserId)?.status || 'before';
      $statusInput.value = st;
    }

    // 最初から編集モードで開く
    $titleInput.removeAttribute('disabled');
    $startDateInput.removeAttribute('disabled');
    $startTimeInput.removeAttribute('disabled');
    $endDateInput.removeAttribute('disabled');
    $endTimeInput.removeAttribute('disabled');
    $calendarInput.removeAttribute('disabled');
    if ($statusInput) $statusInput.removeAttribute('disabled');

    const submitBtn = $eventForm.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.style.display = '';
      submitBtn.textContent = '更新';
      submitBtn.disabled = false;
    }

    // 編集時は削除ボタンを表示
    if ($modalDelete) $modalDelete.style.display = 'block';
    // ローディングを非表示
    if ($modalLoading) $modalLoading.style.display = 'none';

    const modalTitleEl = document.getElementById('modalTitle');
    if (modalTitleEl) modalTitleEl.textContent = '予定を編集';

    $modal.setAttribute('aria-hidden','false');
    $overlay.setAttribute('aria-hidden','false');
  } catch (e) {
    console.error('openEventDetail failed', e);
  }
}
function varNum(name){
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  // 例: "48px" -> 48
  return parseFloat(v);
}
function quantize(mins, step){
  return Math.round(mins/step)*step;
}
function toLocalInputValue(d){
  const t = new Date(d.getTime() - d.getTimezoneOffset()*60000);
  return t.toISOString().slice(0,16);
}
function formatHeaderRange(a,b){
  const sameMonth = a.getMonth()===b.getMonth() && a.getFullYear()===b.getFullYear();
  if(sameMonth){
    return `${a.getFullYear()}年 ${a.getMonth()+1}月 ${a.getDate()}日 - ${b.getDate()}日`;
  }else{
    return `${a.getFullYear()}年 ${a.getMonth()+1}月 ${a.getDate()}日 - ${b.getFullYear()}年 ${b.getMonth()+1}月 ${b.getDate()}日`;
  }
}
function getFirstVisibleCell(monthDate){
  const first = startOfMonth(monthDate);
  const w = getStartOfWeek(first); // 月曜始まり
  return w;
}

// 重なり判定とグルーピング
function isOverlap(a,b){ return a._start < b._end && b._start < a._end; }
function buildOverlapGroups(list){
  const groups = [];
  let cur = [];
  for(let i=0;i<list.length;i++){
    const ev = list[i];
    if(cur.length === 0){
      cur.push(ev);
      continue;
    }
    const conflict = cur.some(e => isOverlap(e, ev));
    if(conflict){
      cur.push(ev);
    }else{
      groups.push(cur);
      cur = [ev];
    }
  }
  if(cur.length) groups.push(cur);
  return groups;
}

// ---------- 必須関数エクスポート ----------
window.getStartOfWeek = getStartOfWeek;
window.getWeekDates = getWeekDates;
window.renderWeekView = renderWeekView;
window.renderMiniCalendar = renderMiniCalendar;
window.addEvent = addEvent;
window.openModal = openModal;
window.closeModal = closeModal;

// ---------- DOMユーティリティ ----------
function byId(id){ return document.getElementById(id); }

// ---------- 表示切替フォールバック ----------
function switchToApp(){
  try {
    if ($login) {
      $login.setAttribute("aria-hidden", "true");
      $login.style.display = "none";
    }
    if ($app) {
      $app.setAttribute("aria-hidden", "false");
      $app.style.display = "block";
    }
    document.body.classList.add("logged-in");
    state.current = startOfDay(new Date());
    setView('week');
  } catch (e) {
    console.error("switchToApp failed", e);
  }
}

// ログイン画面に戻す（履歴用）
function switchToLogin(){
  if ($login) {
    $login.style.display = "block";
    $login.setAttribute("aria-hidden", "false");
  }
  if ($app) {
    $app.style.display = "none";
    $app.setAttribute("aria-hidden", "true");
  }
  // ログイン画面のボタン状態を初期化
  if ($loginBtn) $loginBtn.style.display = "block";
  if ($modeSelect) {
    $modeSelect.style.display = "none";
    $modeSelect.setAttribute("aria-hidden", "true");
  }
  document.body.classList.remove("logged-in", "tasks-mode", "week-view", "day-view", "month-view", "sidebar-open");
}

// 履歴に現在の画面状態を積む
function pushScreenState(screen){
  if (suppressHistory) return;
  try {
    const stateForHistory = {
      screen,
      view: state.view,
      current: state.current ? state.current.toISOString() : null,
    };
    history.pushState(stateForHistory, "");
    // localStorageにも保存（リロード時の復元用）
    saveScreenState(screen);
  } catch (e) {
    console.warn("pushState failed", e);
  }
}

// 画面状態をlocalStorageに保存
function saveScreenState(screen) {
  try {
    const screenState = {
      screen,
      view: state.view,
      current: state.current ? state.current.toISOString() : null,
      timestamp: Date.now()
    };
    localStorage.setItem('schedule_app_screen_state', JSON.stringify(screenState));
  } catch (e) {
    // 保存失敗は無視
  }
}

// 画面状態をlocalStorageから復元
function restoreScreenState() {
  try {
    const raw = localStorage.getItem('schedule_app_screen_state');
    if (!raw) return null;
    const screenState = JSON.parse(raw);
    // 24時間以上古い場合は無視
    if (Date.now() - screenState.timestamp > 24 * 60 * 60 * 1000) {
      localStorage.removeItem('schedule_app_screen_state');
      return null;
    }
    return screenState;
  } catch (e) {
    return null;
  }
}

// ---------- メインエリア切り替え（カレンダー / タスク一覧） ----------
function showMainMode(mode){
  if (!$calendarMain || !$tasksMain) return;
  if (mode === 'tasks') {
    $calendarMain.style.display = 'none';
    $tasksMain.style.display = 'block';
    if ($appHeaderRight) $appHeaderRight.classList.add('mode-tasks');
    document.body.classList.add('tasks-mode');
    if ($headerGoCalendar) $headerGoCalendar.textContent = 'カレンダーへ';
  } else {
    $calendarMain.style.display = 'block';
    $tasksMain.style.display = 'none';
    if ($appHeaderRight) $appHeaderRight.classList.remove('mode-tasks');
    document.body.classList.remove('tasks-mode');
    if ($headerGoCalendar) $headerGoCalendar.textContent = 'タスク一覧へ';
  }
}

// カレンダーの events 配列を元に、予定ベースのタスク一覧を描画
function renderTasksFromEvents(){
  if (!$tasksTodayList || !$tasksOverdueList || !$tasksUpcomingList) return;
  $tasksTodayList.innerHTML = '';
  $tasksOverdueList.innerHTML = '';
  $tasksUpcomingList.innerHTML = '';

  if (!events.length){
    const empty = document.createElement('div');
    empty.className = 'task-empty';
    empty.textContent = '予定がありません';
    $tasksTodayList.appendChild(empty.cloneNode(true));
    $tasksOverdueList.appendChild(empty.cloneNode(true));
    $tasksUpcomingList.appendChild(empty.cloneNode(true));
    return;
  }

  const today = startOfDay(new Date());

  const todayEvents = [];
  const overdueEvents = [];
  const upcomingEvents = [];

  const sorted = [...events].sort((a,b)=> new Date(a.start) - new Date(b.start));

  sorted.forEach(ev => {
    const start = new Date(ev.start);
    const day = startOfDay(start);

    if (day.getTime() === today.getTime()) {
      todayEvents.push(ev);
    } else if (day < today) {
      overdueEvents.push(ev);
    } else {
      upcomingEvents.push(ev);
    }
  });

  renderTaskGroupInto($tasksTodayList, todayEvents, false);
  renderTaskGroupInto($tasksOverdueList, overdueEvents, true);
  renderTaskGroupInto($tasksUpcomingList, upcomingEvents, false);
}

function renderTaskGroupInto(container, list, isOverdue = false){
  container.innerHTML = '';
  if (!list.length){
    const empty = document.createElement('div');
    empty.className = 'task-empty';
    empty.textContent = 'タスクはありません';
    container.appendChild(empty);
    return;
  }

  list.forEach(ev => {
    const start = new Date(ev.start);
    const end = new Date(ev.end);

    const item = document.createElement('div');
    item.className = 'task-item' + (isOverdue ? ' task-overdue' : '');

    const title = document.createElement('div');
    title.className = 'task-item-title';
    title.textContent = ev.title;

    const meta = document.createElement('div');
    meta.className = 'task-item-meta';
    const y = start.getFullYear();
    const m = String(start.getMonth()+1).padStart(2,'0');
    const d = String(start.getDate()).padStart(2,'0');
    const dateLabel = `${y}/${m}/${d}`;
    const timeLabel = `${fmtTime(start)} - ${fmtTime(end)}`;
    // タスク一覧ではカレンダー種別（個人・チーム・外部）は表示しない
    meta.textContent = `${dateLabel} ${timeLabel}`;

    item.appendChild(title);
    item.appendChild(meta);
    item.addEventListener('click', () => {
      openEventDetail(ev);
    });
    container.appendChild(item);
  });
}
