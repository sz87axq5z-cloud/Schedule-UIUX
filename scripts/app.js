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

// ---------- ダミーデータ ----------
const events = [
  // ISO 文字列で格納
  { id: uid(), title: "朝会", start: setDateTimeISO(new Date(), 1, 9, 0), end: setDateTimeISO(new Date(), 1, 9, 30), calendar: "team" },
  { id: uid(), title: "資料作成", start: setDateTimeISO(new Date(), 2, 10, 0), end: setDateTimeISO(new Date(), 2, 12, 0), calendar: "personal" },
  { id: uid(), title: "顧客MTG", start: setDateTimeISO(new Date(), 2, 10, 30), end: setDateTimeISO(new Date(), 2, 11, 30), calendar: "external" },
  { id: uid(), title: "1on1", start: setDateTimeISO(new Date(), 4, 14, 0), end: setDateTimeISO(new Date(), 4, 14, 45), calendar: "team" },
  { id: uid(), title: "レビュー", start: setDateTimeISO(new Date(), 4, 14, 30), end: setDateTimeISO(new Date(), 4, 15, 0), calendar: "team" },
  // 2025/11/20 の 14:00-17:00 に固定で入れるダミー予定
  { id: uid(), title: "ダミーイベント(14-17)", start: new Date(2025, 10, 20, 14, 0).toISOString(), end: new Date(2025, 10, 20, 17, 0).toISOString(), calendar: "personal" },
];

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
const $startInput = byId("startInput");
const $endInput = byId("endInput");
const $calendarInput = byId("calendarInput");

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
window.addEventListener("DOMContentLoaded", () => {
  simulateLoading(() => {
    renderMiniCalendar();
    renderWeekView();
  });

  // 疑似ログイン
  if ($loginBtn) {
    $loginBtn.addEventListener("click", () => {
      $loginBtn.style.display = "none";
      if ($modeSelect) {
        $modeSelect.style.display = "flex";
        $modeSelect.setAttribute("aria-hidden", "false");
      } else {
        // フォールバックで直接アプリへ
        switchToApp();
      }
      pushScreenState('mode-select');
    });
  } else {
    console.warn("loginBtn not found");
  }

  // ログイン後モード選択: タスク一覧（ダミー）
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
  $eventForm.addEventListener("submit", (e) => {
    e.preventDefault();
    addEvent();
  });

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
  $titleInput.value = title || "";
  $startInput.value = toLocalInputValue(start);
  $endInput.value = toLocalInputValue(end);
  $calendarInput.value = "personal";
  $modal.setAttribute("aria-hidden","false");
  $overlay.setAttribute("aria-hidden","false");
  $titleInput.focus();
}

function closeModal(){
  $modal.setAttribute("aria-hidden","true");
  $overlay.setAttribute("aria-hidden","true");
}

function addEvent(){
  const title = $titleInput.value.trim();
  const start = new Date($startInput.value);
  const end = new Date($endInput.value);
  const calendar = $calendarInput.value;

  if(!title || !(start < end)) return;

  events.push({
    id: uid(),
    title,
    start: start.toISOString(),
    end: end.toISOString(),
    calendar
  });
  closeModal();
  renderWeekView();
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
    if ($headerWeekPrev) $headerWeekPrev.textContent = '前の日';
    if ($headerWeekNext) $headerWeekNext.textContent = '次の日';
  } else {
    document.body.classList.remove('day-view');
    // それ以外のビューではデフォルトの高さに戻す
    document.documentElement.style.setProperty('--cell-h', '40px');
    if (v === 'week') {
      if ($headerWeekPrev) $headerWeekPrev.textContent = '前の週';
      if ($headerWeekNext) $headerWeekNext.textContent = '次の週';
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

// ---------- ヘルパ ----------
function labelForCalendar(key){
  return key === "personal" ? "個人" : key === "team" ? "チーム" : "外部";
}
function escapeHtml(s){ return s.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
function isSameDate(a,b){ return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate(); }
function fmtTime(d){ return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
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
  } catch (e) {
    console.warn("pushState failed", e);
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

  renderTaskGroupInto($tasksTodayList, todayEvents);
  renderTaskGroupInto($tasksOverdueList, overdueEvents);
  renderTaskGroupInto($tasksUpcomingList, upcomingEvents);
}

function renderTaskGroupInto(container, list){
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
    item.className = 'task-item';

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
    const calLabel = labelForCalendar(ev.calendar);
    meta.textContent = `${dateLabel} ${timeLabel} ・ ${calLabel}`;

    item.appendChild(title);
    item.appendChild(meta);
    container.appendChild(item);
  });
}
