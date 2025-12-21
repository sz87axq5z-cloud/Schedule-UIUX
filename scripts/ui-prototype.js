/**
 * 管理画面UIプロトタイプ - APIと連携
 */
(function(){
  // グローバルデータ（APIから取得）
  let uiCustomers = [];
  let uiTasks = [];

  // APIからデータを取得
  async function uiFetchData() {
    console.log('[UI-Prototype] データ取得開始...');
    console.log('[UI-Prototype] scheduleAPI:', window.scheduleAPI);
    try {
      // スケジュールを取得
      const schedules = await window.scheduleAPI.getSchedules();
      console.log('[UI-Prototype] 取得したスケジュール:', schedules);

      // スケジュールをタスク形式に変換
      uiTasks = schedules.map(s => {
        const startDate = new Date(s.startTime);
        const endDate = new Date(s.endTime);
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // 今日からの日数差を計算
        const startDiff = Math.floor((startDate - today) / (1000 * 60 * 60 * 24));
        const endDiff = Math.floor((endDate - today) / (1000 * 60 * 60 * 24));

        return {
          id: s.id,
          customerId: s.studentId,
          customerName: s.studentName || '未設定',
          title: s.title,
          status: s.status === 'scheduled' ? 'before' : s.status,
          startDay: startDiff,
          endDay: endDiff,
          startTime: s.startTime,
          endTime: s.endTime
        };
      });

      // 顧客（生徒）をスケジュールから抽出
      const customerMap = {};
      uiTasks.forEach(task => {
        if (task.customerId && !customerMap[task.customerId]) {
          customerMap[task.customerId] = {
            id: task.customerId,
            name: task.customerName,
            status: 'before'
          };
        }
      });
      uiCustomers = Object.values(customerMap);

      console.log(`UI: ${uiTasks.length}件のスケジュール, ${uiCustomers.length}名の生徒`);
    } catch (error) {
      console.error('UIデータ取得エラー:', error);
      uiCustomers = [];
      uiTasks = [];
    }
  }

  async function uiInitPrototype() {
    var root = document.querySelector('.ui-admin-prototype-root');
    if (!root) return;

    // APIからデータを取得
    await uiFetchData();

    uiInitTabs(root);
    uiRenderStatusColumn(root);
    uiRenderTimeline(root);
    uiRenderCalendarView(root);
    uiRenderCustomerDetailView(root);
    uiRenderAlertList(root);
    uiInitFabAndModal(root);
  }

  // ==========================
  // ビュータブ切り替え
  // ==========================
  function uiInitTabs(root) {
    var tabs = root.querySelectorAll('.ui-tab-item');
    var views = root.querySelectorAll('[data-ui-view]');

    tabs.forEach(function(tab){
      tab.addEventListener('click', function(){
        var target = tab.getAttribute('data-ui-target');

        tabs.forEach(function(t){ t.classList.remove('tab--active'); });
        tab.classList.add('tab--active');

        views.forEach(function(view){
          if (view.getAttribute('data-ui-view') === target) {
            view.style.display = '';
          } else {
            view.style.display = 'none';
          }
        });
      });
    });
  }

  // ==========================
  // 左カラム: ステータスアコーディオン
  // ==========================
  function uiRenderStatusColumn(root) {
    var container = root.querySelector('.status-column-ui');
    if (!container) return;
    container.innerHTML = '';

    // 本日の予定のみ表示
    var section = document.createElement('section');
    section.className = 'status-section-ui';

    var header = document.createElement('button');
    header.type = 'button';
    header.className = 'status-section-header-ui';
    header.textContent = '本日の予定';

    var body = document.createElement('div');
    body.className = 'status-section-body-ui';

    // 本日の予定をフィルタリング
    const todayTasks = uiTasks.filter(function(t){
      return t.startDay === 0;
    });

    if (todayTasks.length === 0) {
      var empty = document.createElement('div');
      empty.className = 'status-customer-item-ui';
      empty.textContent = '該当なし';
      empty.style.color = '#999';
      body.appendChild(empty);
    } else {
      todayTasks.forEach(function(task){
        var item = document.createElement('button');
        item.type = 'button';
        item.className = 'status-customer-item-ui';
        item.textContent = task.customerName + ' - ' + task.title;

        item.addEventListener('click', function(){
          uiOpenDetailPopup(root, task);
        });

        body.appendChild(item);
      });
    }

    header.addEventListener('click', function(){
      var expanded = section.getAttribute('data-ui-open') === 'true';
      section.setAttribute('data-ui-open', expanded ? 'false' : 'true');
    });

    section.setAttribute('data-ui-open', 'true');
    section.appendChild(header);
    section.appendChild(body);
    container.appendChild(section);
  }

  // ==========================
  // 右カラム: タイムライン（一覧タブ用カレンダー）
  // ==========================
  function uiRenderTimeline(root) {
    var column = root.querySelector('.timeline-column-ui');
    if (!column) return;

    column.textContent = '';

    var card = document.createElement('div');
    card.className = 'ui-calendar-card';

    // 表示日数の設定（-7日から+13日 = 21日間）
    var startDay = -7;
    var endDay = 13;
    var totalDays = endDay - startDay + 1;
    card.style.setProperty('--calendar-days', totalDays);

    // ヘッダー行（顧客名 + 日数分）
    var headerRow = document.createElement('div');
    headerRow.className = 'ui-calendar-header-row';

    var emptyHead = document.createElement('div');
    emptyHead.className = 'ui-calendar-header-cell ui-calendar-header-cell--empty';
    emptyHead.textContent = '生徒 / 日程';
    headerRow.appendChild(emptyHead);

    for (var d = startDay; d <= endDay; d++) {
      var headCell = document.createElement('div');
      headCell.className = 'ui-calendar-header-cell';
      headCell.textContent = uiFormatRelativeDay(d);
      headerRow.appendChild(headCell);
    }
    card.appendChild(headerRow);

    // 現在時刻（アラート判定用）
    var now = new Date();

    // 各生徒行
    uiCustomers.forEach(function(cust){
      var row = document.createElement('div');
      row.className = 'ui-calendar-row';

      var label = document.createElement('div');
      label.className = 'ui-calendar-name-cell';
      label.textContent = cust.name;
      row.appendChild(label);

      for (var d = startDay; d <= endDay; d++) {
        var cell = document.createElement('div');
        cell.className = 'ui-calendar-cell';

        var tasksForDay = uiTasks.filter(function(t){
          return t.customerId === cust.id && t.startDay === d;
        });

        if (tasksForDay.length) {
          var dot = document.createElement('div');
          var cls = 'ui-calendar-dot ';

          // 1つでもアラート対象（終了時刻が現在より前かつ未完了）があれば赤
          var hasAlert = tasksForDay.some(function(t){
            var endTime = new Date(t.endTime);
            return endTime < now && t.status !== 'done';
          });

          if (hasAlert) {
            cls += 'ui-calendar-dot-red';
          } else {
            cls += 'ui-calendar-dot-gray';
          }
          dot.className = cls;

          // ドットクリックでその日の全予定を表示
          dot.addEventListener('click', (function(tasks, dayOffset, customerName){
            return function(){ uiOpenDaySchedulePopup(root, tasks, dayOffset, customerName); };
          })(tasksForDay, d, cust.name));

          cell.appendChild(dot);
        }

        row.appendChild(cell);
      }

      card.appendChild(row);
    });

    if (uiCustomers.length === 0) {
      var empty = document.createElement('div');
      empty.style.padding = '20px';
      empty.style.color = '#999';
      empty.textContent = 'スケジュールが登録されていません';
      card.appendChild(empty);
    }

    column.appendChild(card);
  }

  function uiOpenDetailPopup(root, task) {
    var popup = root.querySelector('.task-popup-ui');
    var overlay = root.querySelector('.task-popup-overlay-ui');
    if (!popup || !overlay) return;

    popup.querySelector('.task-popup-title-ui').textContent = task.title;
    popup.querySelector('.task-popup-meta-ui').textContent = task.customerName + ' / ステータス: ' + uiStatusLabel(task.status);

    // 日時表示
    var dateLine = popup.querySelector('.task-popup-date-ui');
    if (!dateLine) {
      dateLine = document.createElement('div');
      dateLine.className = 'task-popup-date-ui';
      popup.querySelector('.task-popup-body-ui').appendChild(dateLine);
    }

    if (task.startTime && task.endTime) {
      const start = new Date(task.startTime);
      const end = new Date(task.endTime);
      dateLine.textContent = start.toLocaleString('ja-JP') + ' 〜 ' + end.toLocaleString('ja-JP');
    } else {
      dateLine.textContent = uiFormatRelativeDay(task.startDay);
    }

    // 削除ボタン
    let deleteBtn = popup.querySelector('.ui-delete-btn');
    if (!deleteBtn) {
      deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'ui-delete-btn';
      deleteBtn.textContent = '削除';
      deleteBtn.style.cssText = 'margin-top: 16px; padding: 8px 16px; background: #e74c3c; color: white; border: none; border-radius: 4px; cursor: pointer;';
      popup.querySelector('.task-popup-body-ui').appendChild(deleteBtn);
    }

    deleteBtn.onclick = async function() {
      if (confirm('「' + task.title + '」を削除しますか？')) {
        try {
          await window.scheduleAPI.deleteSchedule(task.id);
          alert('削除しました');
          uiCloseDetailPopup(root);
          await uiFetchData();
          uiRenderStatusColumn(root);
          uiRenderTimeline(root);
          uiRenderCalendarView(root);
        } catch (error) {
          alert('削除に失敗しました');
        }
      }
    };

    overlay.setAttribute('data-ui-open', 'true');
    popup.setAttribute('data-ui-open', 'true');
  }

  function uiCloseDetailPopup(root) {
    var popup = root.querySelector('.task-popup-ui');
    var overlay = root.querySelector('.task-popup-overlay-ui');
    if (!popup || !overlay) return;
    overlay.setAttribute('data-ui-open', 'false');
    popup.setAttribute('data-ui-open', 'false');
  }

  function uiStatusLabel(key) {
    switch (key) {
      case 'before': return '予定';
      case 'scheduled': return '予定';
      case 'progress': return '進行中';
      case 'done': return '完了';
      case 'alert': return 'アラート';
      default: return key;
    }
  }

  // ==========================
  // カレンダービュー
  // ==========================
  function uiRenderCalendarView(root) {
    var view = root.querySelector('.ui-layout[data-ui-view="calendar"]');
    if (!view) return;

    view.textContent = '';

    var card = document.createElement('div');
    card.className = 'ui-calendar-card';

    // 表示日数の設定（-7日から+13日 = 21日間）
    var startDay = -7;
    var endDay = 13;
    var totalDays = endDay - startDay + 1;
    card.style.setProperty('--calendar-days', totalDays);

    // ヘッダー行
    var headerRow = document.createElement('div');
    headerRow.className = 'ui-calendar-header-row';

    var emptyHead = document.createElement('div');
    emptyHead.className = 'ui-calendar-header-cell ui-calendar-header-cell--empty';
    emptyHead.textContent = '生徒 / 日程';
    headerRow.appendChild(emptyHead);

    for (var d = startDay; d <= endDay; d++) {
      var cell = document.createElement('div');
      cell.className = 'ui-calendar-header-cell';
      cell.textContent = uiFormatRelativeDay(d);
      headerRow.appendChild(cell);
    }
    card.appendChild(headerRow);

    // 現在時刻（アラート判定用）
    var now = new Date();

    // 各生徒行
    uiCustomers.forEach(function(cust){
      var row = document.createElement('div');
      row.className = 'ui-calendar-row';

      var label = document.createElement('div');
      label.className = 'ui-calendar-name-cell';
      label.textContent = cust.name;
      row.appendChild(label);

      for (var d = startDay; d <= endDay; d++) {
        var cell = document.createElement('div');
        cell.className = 'ui-calendar-cell';

        var tasksForDay = uiTasks.filter(function(t){
          return t.customerId === cust.id && t.startDay === d;
        });

        if (tasksForDay.length) {
          var dot = document.createElement('div');
          var cls = 'ui-calendar-dot ';

          // 1つでもアラート対象（終了時刻が現在より前かつ未完了）があれば赤
          var hasAlert = tasksForDay.some(function(t){
            var endTime = new Date(t.endTime);
            return endTime < now && t.status !== 'done';
          });

          if (hasAlert) {
            cls += 'ui-calendar-dot-red';
          } else {
            cls += 'ui-calendar-dot-gray';
          }
          dot.className = cls;

          // ドットクリックでその日の全予定を表示
          dot.addEventListener('click', (function(tasks, dayOffset, customerName){
            return function(){ uiOpenDaySchedulePopup(root, tasks, dayOffset, customerName); };
          })(tasksForDay, d, cust.name));

          cell.appendChild(dot);
        }

        row.appendChild(cell);
      }
      card.appendChild(row);
    });

    view.appendChild(card);
  }

  // その日の予定一覧ポップアップを表示
  function uiOpenDaySchedulePopup(root, tasks, dayOffset, customerName) {
    var popup = root.querySelector('.task-popup-ui');
    var overlay = root.querySelector('.task-popup-overlay-ui');
    if (!popup || !overlay) return;

    // 日付を計算
    var base = new Date();
    var targetDate = new Date(base.getFullYear(), base.getMonth(), base.getDate() + dayOffset);
    var dateStr = targetDate.toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric', weekday: 'short' });

    popup.querySelector('.task-popup-title-ui').textContent = customerName + ' - ' + dateStr + ' の予定';
    popup.querySelector('.task-popup-meta-ui').textContent = tasks.length + '件のスケジュール';

    // 既存のリストをクリア
    var body = popup.querySelector('.task-popup-body-ui');
    var existingList = body.querySelector('.day-schedule-list');
    if (existingList) existingList.remove();
    var existingDate = body.querySelector('.task-popup-date-ui');
    if (existingDate) existingDate.remove();
    var existingDelete = body.querySelector('.ui-delete-btn');
    if (existingDelete) existingDelete.remove();

    // 予定リストを作成
    var list = document.createElement('div');
    list.className = 'day-schedule-list';
    list.style.cssText = 'margin-top: 12px; display: flex; flex-direction: column; gap: 8px;';

    tasks.forEach(function(task){
      var item = document.createElement('div');
      item.style.cssText = 'padding: 10px 12px; background: #f5f5f5; border-radius: 8px; cursor: pointer; transition: background 0.15s;';

      var start = new Date(task.startTime);
      var end = new Date(task.endTime);
      var timeStr = start.toLocaleTimeString('ja-JP', {hour: '2-digit', minute: '2-digit'}) +
                    ' - ' + end.toLocaleTimeString('ja-JP', {hour: '2-digit', minute: '2-digit'});

      var title = document.createElement('div');
      title.style.cssText = 'font-weight: 500; font-size: 13px;';
      title.textContent = task.title;

      var meta = document.createElement('div');
      meta.style.cssText = 'font-size: 11px; color: #666; margin-top: 2px;';
      meta.textContent = timeStr + ' / ' + uiStatusLabel(task.status);

      // アラート対象なら赤いインジケーターを追加
      var now = new Date();
      var endTime = new Date(task.endTime);
      if (endTime < now && task.status !== 'done') {
        item.style.borderLeft = '3px solid #c62828';
        meta.textContent += ' ⚠️ 期日超過';
      }

      item.appendChild(title);
      item.appendChild(meta);

      item.addEventListener('mouseenter', function(){ item.style.background = '#e0e0e0'; });
      item.addEventListener('mouseleave', function(){ item.style.background = '#f5f5f5'; });
      item.addEventListener('click', function(){
        uiCloseDetailPopup(root);
        setTimeout(function(){ uiOpenDetailPopup(root, task); }, 200);
      });

      list.appendChild(item);
    });

    body.appendChild(list);

    overlay.setAttribute('data-ui-open', 'true');
    popup.setAttribute('data-ui-open', 'true');
  }

  function uiFormatRelativeDay(offset) {
    var base = new Date();
    var d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + offset);
    return d.toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' });
  }

  // ==========================
  // 顧客詳細ビュー
  // ==========================
  function uiRenderCustomerDetailView(root) {
    var view = root.querySelector('.ui-layout[data-ui-view="detail"]');
    if (!view) return;
    view.textContent = '';

    var layout = document.createElement('div');
    layout.className = 'ui-detail-layout';

    var searchWrap = document.createElement('div');
    searchWrap.className = 'ui-detail-search';
    var searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'ui-detail-search-input';
    searchInput.placeholder = '生徒名で検索';
    searchWrap.appendChild(searchInput);

    var listCol = document.createElement('div');
    listCol.className = 'ui-detail-customers';

    function renderCustomerList(keyword) {
      listCol.textContent = '';
      var kw = (keyword || '').trim().toLowerCase();

      uiCustomers
        .filter(function(c){
          if (!kw) return true;
          return c.name.toLowerCase().indexOf(kw) !== -1;
        })
        .forEach(function(cust, index){
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'ui-detail-customer-btn';
          if (!kw && index === 0) btn.classList.add('is-active');
          btn.textContent = cust.name;
          btn.addEventListener('click', function(){
            var all = listCol.querySelectorAll('.ui-detail-customer-btn');
            all.forEach(function(b){ b.classList.remove('is-active'); });
            btn.classList.add('is-active');
            uiOpenCustomerDetailPopup(root, cust, function(newName){
              // 名前が変更されたらボタンのテキストを更新
              btn.textContent = newName;
              cust.name = newName;
            });
          });
          listCol.appendChild(btn);
        });

      if (uiCustomers.length === 0) {
        var empty = document.createElement('div');
        empty.style.padding = '20px';
        empty.style.color = '#999';
        empty.textContent = '生徒が登録されていません';
        listCol.appendChild(empty);
      }
    }

    searchInput.addEventListener('input', function(){
      renderCustomerList(searchInput.value);
    });

    renderCustomerList('');

    layout.appendChild(searchWrap);
    layout.appendChild(listCol);
    view.appendChild(layout);
  }

  function uiOpenCustomerDetailPopup(root, customer, onNameChange) {
    var overlay = root.querySelector('.customer-detail-popup-overlay');
    var popup = root.querySelector('.customer-detail-popup');

    if (!overlay || !popup) {
      var host = root.querySelector('.ui-container') || root;

      overlay = document.createElement('div');
      overlay.className = 'customer-detail-popup-overlay';
      host.appendChild(overlay);

      popup = document.createElement('div');
      popup.className = 'customer-detail-popup';
      popup.innerHTML =
        '<div class="customer-detail-popup-header">' +
        '  <div class="customer-detail-popup-title">生徒のスケジュール詳細</div>' +
        '  <button type="button" class="customer-detail-popup-close">×</button>' +
        '</div>' +
        '<div class="customer-detail-popup-body"></div>';
      host.appendChild(popup);

      var closeBtn = popup.querySelector('.customer-detail-popup-close');
      var close = function(){
        overlay.setAttribute('data-ui-open', 'false');
        popup.setAttribute('data-ui-open', 'false');
      };
      overlay.addEventListener('click', close);
      closeBtn.addEventListener('click', close);
    }

    var body = popup.querySelector('.customer-detail-popup-body');
    if (!body) return;
    body.textContent = '';

    // 編集可能な名前セクション
    var nameSection = document.createElement('div');
    nameSection.className = 'ui-detail-name-section';
    nameSection.style.cssText = 'display: flex; align-items: center; gap: 12px; margin-bottom: 16px;';

    var nameDisplay = document.createElement('div');
    nameDisplay.className = 'ui-detail-customer-name';
    nameDisplay.style.cssText = 'cursor: pointer; padding: 8px 12px; background: #f5f5f5; border-radius: 8px; flex: 1; display: flex; align-items: center; justify-content: space-between;';

    var nameText = document.createElement('span');
    nameText.textContent = customer.name;

    var editIcon = document.createElement('span');
    editIcon.textContent = '✎';
    editIcon.style.cssText = 'color: #666; font-size: 14px;';

    nameDisplay.appendChild(nameText);
    nameDisplay.appendChild(editIcon);

    // 名前編集モード
    var nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.value = customer.name;
    nameInput.className = 'ui-detail-name-input';
    nameInput.style.cssText = 'display: none; flex: 1; padding: 8px 12px; border: 2px solid #000; border-radius: 8px; font-size: 14px;';

    var saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.textContent = '保存';
    saveBtn.style.cssText = 'display: none; padding: 8px 16px; background: #000; color: #fff; border: none; border-radius: 8px; cursor: pointer; font-size: 14px;';

    var cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'キャンセル';
    cancelBtn.style.cssText = 'display: none; padding: 8px 16px; background: #fff; color: #000; border: 1px solid #ccc; border-radius: 8px; cursor: pointer; font-size: 14px;';

    // 編集モードに切り替え
    nameDisplay.addEventListener('click', function() {
      nameDisplay.style.display = 'none';
      nameInput.style.display = 'block';
      saveBtn.style.display = 'block';
      cancelBtn.style.display = 'block';
      nameInput.focus();
      nameInput.select();
    });

    // キャンセル
    cancelBtn.addEventListener('click', function() {
      nameDisplay.style.display = 'flex';
      nameInput.style.display = 'none';
      saveBtn.style.display = 'none';
      cancelBtn.style.display = 'none';
      nameInput.value = customer.name;
    });

    // 保存
    saveBtn.addEventListener('click', async function() {
      var newName = nameInput.value.trim();
      if (!newName) {
        alert('名前を入力してください');
        return;
      }

      if (newName === customer.name) {
        cancelBtn.click();
        return;
      }

      saveBtn.disabled = true;
      saveBtn.textContent = '保存中...';

      try {
        var result = await window.scheduleAPI.updateCustomerName(customer.id, newName);
        if (result.success) {
          nameText.textContent = newName;
          customer.name = newName;

          // 親コンポーネントに通知
          if (onNameChange) {
            onNameChange(newName);
          }

          // uiTasksの顧客名も更新
          uiTasks.forEach(function(t) {
            if (t.customerId === customer.id) {
              t.customerName = newName;
            }
          });

          alert('名前を更新しました（Googleカレンダーにも反映されます）');
        } else {
          alert('更新に失敗しました: ' + (result.error || '不明なエラー'));
        }
      } catch (error) {
        alert('エラーが発生しました: ' + error.message);
      }

      saveBtn.disabled = false;
      saveBtn.textContent = '保存';
      nameDisplay.style.display = 'flex';
      nameInput.style.display = 'none';
      saveBtn.style.display = 'none';
      cancelBtn.style.display = 'none';
    });

    // Enterキーで保存
    nameInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') {
        saveBtn.click();
      } else if (e.key === 'Escape') {
        cancelBtn.click();
      }
    });

    nameSection.appendChild(nameDisplay);
    nameSection.appendChild(nameInput);
    nameSection.appendChild(saveBtn);
    nameSection.appendChild(cancelBtn);
    body.appendChild(nameSection);

    // ヘルプテキスト
    var helpText = document.createElement('div');
    helpText.style.cssText = 'font-size: 11px; color: #999; margin-bottom: 16px;';
    helpText.textContent = '※ 名前をタップして編集できます。変更は講師のGoogleカレンダーにも反映されます。';
    body.appendChild(helpText);

    var list = document.createElement('div');
    list.className = 'ui-detail-task-list';

    var customerTasks = uiTasks.filter(function(t){ return t.customerId === customer.id; });

    customerTasks.forEach(function(task){
      var row = document.createElement('div');
      row.className = 'ui-detail-task-row';
      row.style.cursor = 'pointer';

      const start = new Date(task.startTime);
      row.textContent = start.toLocaleDateString('ja-JP') + ' ' +
        start.toLocaleTimeString('ja-JP', {hour: '2-digit', minute: '2-digit'}) +
        ' / ' + task.title;

      row.addEventListener('click', function(){
        uiOpenDetailPopup(root, task);
      });

      list.appendChild(row);
    });

    if (customerTasks.length === 0) {
      var empty = document.createElement('div');
      empty.className = 'ui-detail-task-empty';
      empty.textContent = '登録されているスケジュールはありません。';
      list.appendChild(empty);
    }

    body.appendChild(list);

    overlay.setAttribute('data-ui-open', 'true');
    popup.setAttribute('data-ui-open', 'true');
  }

  // ==========================
  // アラート一覧
  // ==========================
  function uiRenderAlertList(root) {
    var view = root.querySelector('.ui-layout[data-ui-view="alerts"]');
    if (!view) return;
    view.textContent = '';

    var wrapper = document.createElement('div');
    wrapper.className = 'ui-alerts-wrapper';

    var header = document.createElement('div');
    header.className = 'ui-alerts-header';
    header.textContent = '期日超過（未完了）';
    wrapper.appendChild(header);

    var list = document.createElement('div');
    list.className = 'ui-alerts-list';

    // 期日超過（終了時刻が現在時刻より前）かつ完了していないスケジュール
    const now = new Date();
    const alertTasks = uiTasks.filter(function(t){
      const endTime = new Date(t.endTime);
      return endTime < now && t.status !== 'done';
    });

    alertTasks.forEach(function(task){
      var row = document.createElement('div');
      row.className = 'ui-alerts-row';
      row.style.cursor = 'pointer';

      const start = new Date(task.startTime);
      row.textContent = start.toLocaleDateString('ja-JP') + ' / ' +
        task.customerName + ' / ' + task.title;

      row.addEventListener('click', function(){
        uiOpenDetailPopup(root, task);
      });

      list.appendChild(row);
    });

    if (alertTasks.length === 0) {
      var empty = document.createElement('div');
      empty.className = 'ui-alerts-empty';
      empty.textContent = '現在アラート対象のスケジュールはありません。';
      list.appendChild(empty);
    }

    wrapper.appendChild(list);
    view.appendChild(wrapper);
  }

  // ==========================
  // FAB & モーダル（新規スケジュール追加）
  // ==========================
  function uiInitFabAndModal(root) {
    var fab = root.querySelector('.fab-ui');
    var modal = root.querySelector('.modal-ui');
    var overlay = root.querySelector('.modal-ui-overlay');
    var closeBtn = root.querySelector('.modal-ui-close');
    var saveBtn = root.querySelector('.modal-ui-save');

    if (!fab || !modal || !overlay || !closeBtn || !saveBtn) return;

    // 顧客セレクトを更新
    var customerSelect = root.querySelector('.modal-ui-input-customer');
    if (customerSelect) {
      customerSelect.innerHTML = '';
      uiCustomers.forEach(function(c){
        var opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.name;
        customerSelect.appendChild(opt);
      });
    }

    fab.addEventListener('click', function(){
      overlay.setAttribute('data-ui-open', 'true');
      modal.setAttribute('data-ui-open', 'true');
    });

    function closeModal(){
      overlay.setAttribute('data-ui-open', 'false');
      modal.setAttribute('data-ui-open', 'false');
    }

    overlay.addEventListener('click', closeModal);
    closeBtn.addEventListener('click', closeModal);

    saveBtn.addEventListener('click', async function(){
      var titleInput = root.querySelector('.modal-ui-input-title');
      var customerSelect = root.querySelector('.modal-ui-input-customer');
      var startSelect = root.querySelector('.modal-ui-input-start');
      var endSelect = root.querySelector('.modal-ui-input-end');

      if (!titleInput || !customerSelect || !startSelect || !endSelect) {
        closeModal();
        return;
      }

      var title = titleInput.value.trim() || '新規スケジュール';
      var customerId = customerSelect.value;
      var startDay = parseInt(startSelect.value, 10) || 0;
      var endDay = parseInt(endSelect.value, 10) || startDay;

      // 日付を計算
      var today = new Date();
      var startDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() + startDay, 10, 0);
      var endDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() + endDay, 12, 0);

      // 顧客名を取得
      var customer = uiCustomers.find(function(c){ return c.id === customerId; });
      var customerName = customer ? customer.name : '';

      try {
        await window.scheduleAPI.createSchedule({
          title: title,
          startTime: startDate.toISOString(),
          endTime: endDate.toISOString(),
          studentId: customerId,
          studentName: customerName
        });

        alert('スケジュールを追加しました');
        titleInput.value = '';
        closeModal();

        // 再読み込み
        await uiFetchData();
        uiRenderStatusColumn(root);
        uiRenderTimeline(root);
        uiRenderCalendarView(root);
      } catch (error) {
        alert('追加に失敗しました');
      }
    });

    var popupOverlay = root.querySelector('.task-popup-overlay-ui');
    var popupClose = root.querySelector('.task-popup-close-ui');
    if (popupOverlay) {
      popupOverlay.addEventListener('click', function(){ uiCloseDetailPopup(root); });
    }
    if (popupClose) {
      popupClose.addEventListener('click', function(){ uiCloseDetailPopup(root); });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', uiInitPrototype);
  } else {
    uiInitPrototype();
  }
})();
