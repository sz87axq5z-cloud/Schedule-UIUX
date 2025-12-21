/**
 * 管理画面 - APIと連携して実際の生徒・スケジュールを管理
 */

// グローバル変数
let adminUser = null;
let allSchedules = [];
let allUsers = [];

// ログイン状態チェック（講師のみアクセス可能）
async function checkAdminAccess() {
  if (window.scheduleAPI) {
    const user = await window.scheduleAPI.checkLoginStatus();
    if (!user) {
      window.location.href = 'index.html';
      return false;
    }
    if (user.role !== 'teacher') {
      alert('この画面は講師専用です');
      window.location.href = 'index.html';
      return false;
    }
    adminUser = user;
    window.adminUser = user;
    return true;
  }
  return false;
}

// APIからデータを取得
async function fetchAllData() {
  console.log('[Admin] データ取得開始...');
  try {
    // スケジュールを取得
    const schedules = await window.scheduleAPI.getSchedules();
    console.log('[Admin] 取得したスケジュール:', schedules);
    allSchedules = schedules.map(s => ({
      id: s.id,
      title: s.title,
      start: s.startTime,
      end: s.endTime,
      userId: s.studentId,
      userName: s.studentName || '未設定',
      status: s.status
    }));

    // ユーザー一覧を取得
    const usersResponse = await fetch('http://localhost:3001/api/auth/users', {
      credentials: 'include'
    });
    const usersData = await usersResponse.json();
    if (usersData.success) {
      allUsers = usersData.data.filter(u => u.role === 'student');
    }

    console.log(`スケジュール: ${allSchedules.length}件, 生徒: ${allUsers.length}名`);
  } catch (error) {
    console.error('データ取得エラー:', error);
  }
}

// ユーティリティ関数
function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

function formatRange(ev) {
  const start = new Date(ev.start);
  const end = new Date(ev.end);
  const datePart = start.toLocaleDateString('ja-JP', { month: '2-digit', day: '2-digit' });
  const timePart = start.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }) +
    ' - ' + end.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
  return datePart + ' ' + timePart;
}

function formatDateTime(date) {
  return date.toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function groupByUser(events) {
  const map = {};
  events.forEach(ev => {
    const uid = ev.userId || 'unknown';
    if (!map[uid]) {
      map[uid] = {
        userId: uid,
        userName: ev.userName || '不明なユーザー',
        events: []
      };
    }
    map[uid].events.push(ev);
  });
  return Object.keys(map)
    .map(k => map[k])
    .sort((a, b) => a.userName.localeCompare(b.userName, 'ja'));
}

// メイン描画関数
function renderAdminEvents() {
  const allList = document.getElementById('adminAllList');
  const byCustomerContainer = document.getElementById('adminByCustomerList');
  const dayContainer = document.getElementById('adminDayList');
  const visualContainer = document.getElementById('adminVisual');
  const customerSearchInput = document.getElementById('customerSearchInput');
  const daySortSelect = document.getElementById('daySortSelect');
  const dayFromInput = document.getElementById('dayFrom');
  const dayToInput = document.getElementById('dayTo');

  const customerQuery = customerSearchInput ? customerSearchInput.value.trim() : '';
  const daySortOrder = daySortSelect ? daySortSelect.value : 'asc';
  const dayFrom = dayFromInput && dayFromInput.value ? new Date(dayFromInput.value) : null;
  const dayTo = dayToInput && dayToInput.value ? new Date(dayToInput.value) : null;

  if (allList) allList.innerHTML = '';
  if (byCustomerContainer) byCustomerContainer.innerHTML = '';
  if (dayContainer) dayContainer.innerHTML = '';
  if (visualContainer) visualContainer.innerHTML = '';

  const events = allSchedules.slice();

  if (!events.length) {
    if (allList) {
      const empty = document.createElement('div');
      empty.className = 'task-empty';
      empty.textContent = '登録されているスケジュールがありません';
      allList.appendChild(empty);
    }
    return;
  }

  // 全スケジュール（日程順）リスト
  if (allList) {
    events
      .slice()
      .sort((a, b) => new Date(a.start) - new Date(b.start))
      .forEach(ev => {
        const item = document.createElement('div');
        item.className = 'task-item';
        item.style.cursor = 'pointer';

        const title = document.createElement('div');
        title.className = 'task-item-title';
        title.textContent = ev.title;

        const meta = document.createElement('div');
        meta.className = 'task-item-meta';
        meta.textContent = ev.userName + ' / ' + formatRange(ev);

        item.appendChild(title);
        item.appendChild(meta);

        // クリックで詳細表示
        item.addEventListener('click', () => showScheduleDetail(ev));

        allList.appendChild(item);
      });
  }

  // ステータスカード（生徒別）
  if (visualContainer) {
    const today = new Date();

    // 生徒ごとにスケジュールをグループ化
    const userGroups = groupByUser(events);

    userGroups.forEach(group => {
      const userEvents = group.events;
      const todayEvents = userEvents.filter(ev => isSameDay(new Date(ev.start), today));
      const futureEvents = userEvents.filter(ev => new Date(ev.start) > today);

      // 今日または今後の予定がある生徒のみ表示
      if (todayEvents.length === 0 && futureEvents.length === 0) return;

      let summary = '';
      if (todayEvents.length > 0) {
        const first = todayEvents.slice().sort((a, b) => new Date(a.start) - new Date(b.start))[0];
        const d = new Date(first.start);
        const time = d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
        summary = '本日 ' + time + ' ' + first.title;
      } else if (futureEvents.length > 0) {
        const first = futureEvents.slice().sort((a, b) => new Date(a.start) - new Date(b.start))[0];
        const d = new Date(first.start);
        summary = d.toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' }) + ' ' + first.title;
      }

      // 色判定
      const now = new Date();
      const hasOverdue = userEvents.some(ev => new Date(ev.end) < now);
      let colorClass = todayEvents.length > 0 ? 'status-before' : 'status-done';
      if (hasOverdue) colorClass = 'status-overdue';

      const card = document.createElement('div');
      card.className = 'admin-status-card ' + colorClass;

      const main = document.createElement('button');
      main.type = 'button';
      main.className = 'admin-status-main';

      const nameEl = document.createElement('div');
      nameEl.className = 'admin-status-name';
      nameEl.textContent = group.userName;

      const summaryEl = document.createElement('div');
      summaryEl.className = 'admin-status-summary';
      summaryEl.textContent = summary;

      const dot = document.createElement('span');
      dot.className = 'admin-status-dot';

      main.appendChild(nameEl);
      main.appendChild(summaryEl);
      main.appendChild(dot);

      const detail = document.createElement('div');
      detail.className = 'admin-status-detail';

      userEvents
        .slice()
        .sort((a, b) => new Date(a.start) - new Date(b.start))
        .forEach(ev => {
          const item = document.createElement('div');
          item.className = 'task-item';
          item.style.cursor = 'pointer';

          const t = document.createElement('div');
          t.className = 'task-item-title';
          t.textContent = ev.title;

          const m = document.createElement('div');
          m.className = 'task-item-meta';
          m.textContent = formatRange(ev);

          item.appendChild(t);
          item.appendChild(m);
          item.addEventListener('click', (e) => {
            e.stopPropagation();
            showScheduleDetail(ev);
          });
          detail.appendChild(item);
        });

      main.addEventListener('click', () => {
        const isOpen = detail.getAttribute('data-open') === 'true';
        detail.setAttribute('data-open', isOpen ? 'false' : 'true');
        detail.style.display = isOpen ? 'none' : 'block';
      });

      detail.style.display = 'none';
      detail.setAttribute('data-open', 'false');

      card.appendChild(main);
      card.appendChild(detail);
      visualContainer.appendChild(card);
    });
  }

  // 顧客別
  if (byCustomerContainer) {
    let userGroups = groupByUser(events);

    if (customerQuery) {
      const q = customerQuery.toLowerCase();
      userGroups = userGroups.filter(group =>
        (group.userName || '').toLowerCase().includes(q)
      );
    }

    if (!userGroups.length) {
      const emptyCustomer = document.createElement('div');
      emptyCustomer.className = 'task-empty';
      emptyCustomer.textContent = '該当する生徒がいません';
      byCustomerContainer.appendChild(emptyCustomer);
      return;
    }

    userGroups.forEach(group => {
      const section = document.createElement('div');
      section.className = 'tasks-group';

      const header = document.createElement('div');
      header.className = 'tasks-group-title';
      header.textContent = group.userName;

      const list = document.createElement('div');
      list.className = 'tasks-list';

      group.events
        .slice()
        .sort((a, b) => new Date(a.start) - new Date(b.start))
        .forEach(ev => {
          const item = document.createElement('div');
          item.className = 'task-item';
          item.style.cursor = 'pointer';

          const title = document.createElement('div');
          title.className = 'task-item-title';
          title.textContent = ev.title;

          const meta = document.createElement('div');
          meta.className = 'task-item-meta';
          meta.textContent = formatRange(ev);

          item.appendChild(title);
          item.appendChild(meta);
          item.addEventListener('click', () => showScheduleDetail(ev));
          list.appendChild(item);
        });

      section.appendChild(header);
      section.appendChild(list);
      byCustomerContainer.appendChild(section);
    });
  }

  // 日別
  if (dayContainer) {
    const byDateForDay = {};
    events.forEach(ev => {
      const d = new Date(ev.start);
      const key = d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
      if (!byDateForDay[key]) byDateForDay[key] = { date: d, events: [] };
      byDateForDay[key].events.push(ev);
    });

    let dayBlocks = Object.keys(byDateForDay)
      .map(k => byDateForDay[k])
      .filter(block => {
        if (dayFrom && block.date < dayFrom) return false;
        if (dayTo) {
          const endOfTo = new Date(dayTo.getFullYear(), dayTo.getMonth(), dayTo.getDate(), 23, 59, 59, 999);
          if (block.date > endOfTo) return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (daySortOrder === 'desc') return b.date - a.date;
        return a.date - b.date;
      });

    dayBlocks.forEach(block => {
      const section = document.createElement('div');
      section.className = 'tasks-group';

      const header = document.createElement('div');
      header.className = 'tasks-group-title';
      header.textContent = block.date.toLocaleDateString('ja-JP', { month: '2-digit', day: '2-digit', weekday: 'short' });

      const list = document.createElement('div');
      list.className = 'tasks-list';

      block.events
        .slice()
        .sort((a, b) => new Date(a.start) - new Date(b.start))
        .forEach(ev => {
          const item = document.createElement('div');
          item.className = 'task-item';
          item.style.cursor = 'pointer';

          const title = document.createElement('div');
          title.className = 'task-item-title';
          title.textContent = ev.title;

          const meta = document.createElement('div');
          meta.className = 'task-item-meta';
          meta.textContent = ev.userName + ' / ' + formatRange(ev);

          item.appendChild(title);
          item.appendChild(meta);
          item.addEventListener('click', () => showScheduleDetail(ev));
          list.appendChild(item);
        });

      section.appendChild(header);
      section.appendChild(list);
      dayContainer.appendChild(section);
    });
  }
}

// スケジュール詳細表示
function showScheduleDetail(ev) {
  const popup = document.querySelector('.task-popup-ui');
  const overlay = document.querySelector('.task-popup-overlay-ui');
  const titleEl = popup.querySelector('.task-popup-title-ui');
  const metaEl = popup.querySelector('.task-popup-meta-ui');
  const bodyEl = popup.querySelector('.task-popup-body-ui');

  titleEl.textContent = ev.title;

  const start = new Date(ev.start);
  const end = new Date(ev.end);
  metaEl.textContent = `${ev.userName} / ${formatDateTime(start)} 〜 ${formatDateTime(end)}`;

  // 削除ボタンを追加（既存のものがあれば削除）
  let deleteBtn = bodyEl.querySelector('.delete-schedule-btn');
  if (!deleteBtn) {
    deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'delete-schedule-btn';
    deleteBtn.textContent = 'このスケジュールを削除';
    deleteBtn.style.cssText = 'margin-top: 16px; padding: 8px 16px; background: #e74c3c; color: white; border: none; border-radius: 4px; cursor: pointer;';
    bodyEl.appendChild(deleteBtn);
  }

  deleteBtn.onclick = async () => {
    if (confirm(`「${ev.title}」を削除しますか？`)) {
      try {
        await window.scheduleAPI.deleteSchedule(ev.id);
        alert('削除しました');
        closePopup();
        await fetchAllData();
        renderAdminEvents();
      } catch (error) {
        alert('削除に失敗しました');
      }
    }
  };

  popup.setAttribute('data-ui-open', 'true');
  overlay.setAttribute('data-ui-open', 'true');
}

function closePopup() {
  const popup = document.querySelector('.task-popup-ui');
  const overlay = document.querySelector('.task-popup-overlay-ui');
  popup.setAttribute('data-ui-open', 'false');
  overlay.setAttribute('data-ui-open', 'false');
}

// タブ設定
function setupTabs() {
  const tabAll = document.getElementById('adminTabAll');
  const tabCustomer = document.getElementById('adminTabCustomer');
  const tabDay = document.getElementById('adminTabDay');
  const groupAll = document.querySelector('[data-tab="all"]');
  const groupCustomer = document.querySelector('[data-tab="customer"]');
  const groupDay = document.querySelector('[data-tab="day"]');
  const customerSearchInput = document.getElementById('customerSearchInput');
  const daySortSelect = document.getElementById('daySortSelect');
  const dayFromInput = document.getElementById('dayFrom');
  const dayToInput = document.getElementById('dayTo');

  function activate(target) {
    const showAll = target === 'all';
    const showCustomer = target === 'customer';
    const showDay = target === 'day';

    if (groupAll) groupAll.style.display = showAll ? '' : 'none';
    if (groupCustomer) groupCustomer.style.display = showCustomer ? '' : 'none';
    if (groupDay) groupDay.style.display = showDay ? '' : 'none';

    if (tabAll) {
      tabAll.classList.toggle('is-active', showAll);
      tabAll.setAttribute('aria-selected', showAll ? 'true' : 'false');
    }
    if (tabCustomer) {
      tabCustomer.classList.toggle('is-active', showCustomer);
      tabCustomer.setAttribute('aria-selected', showCustomer ? 'true' : 'false');
    }
    if (tabDay) {
      tabDay.classList.toggle('is-active', showDay);
      tabDay.setAttribute('aria-selected', showDay ? 'true' : 'false');
    }
  }

  if (tabAll) tabAll.addEventListener('click', () => activate('all'));
  if (tabCustomer) tabCustomer.addEventListener('click', () => activate('customer'));
  if (tabDay) tabDay.addEventListener('click', () => activate('day'));

  if (customerSearchInput) {
    customerSearchInput.addEventListener('input', () => renderAdminEvents());
  }
  if (daySortSelect) {
    daySortSelect.addEventListener('change', () => renderAdminEvents());
  }
  if (dayFromInput) {
    dayFromInput.addEventListener('change', () => renderAdminEvents());
  }
  if (dayToInput) {
    dayToInput.addEventListener('change', () => renderAdminEvents());
  }

  // ポップアップ閉じるボタン
  const closeBtn = document.querySelector('.task-popup-close-ui');
  const overlay = document.querySelector('.task-popup-overlay-ui');
  if (closeBtn) closeBtn.addEventListener('click', closePopup);
  if (overlay) overlay.addEventListener('click', closePopup);
}

// 初期化
async function initAdmin() {
  const hasAccess = await checkAdminAccess();
  if (!hasAccess) return;

  await fetchAllData();
  renderAdminEvents();
  setupTabs();
}

// DOM読み込み後に初期化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAdmin);
} else {
  initAdmin();
}
