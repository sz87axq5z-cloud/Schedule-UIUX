(function(){
  function getUserStatus(userId){
    var users = (window.sharedUsers || []);
    for (var i=0; i<users.length; i++){
      if (users[i].id === userId) return users[i].status || 'done';
    }
    return 'done';
  }

  function isSameDay(a, b){
    return a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate();
  }
  function formatRange(ev){
    var start = new Date(ev.start);
    var end = new Date(ev.end);
    var datePart = start.toLocaleDateString('ja-JP', { month:'2-digit', day:'2-digit' });
    var timePart = start.toLocaleTimeString('ja-JP', { hour:'2-digit', minute:'2-digit' }) +
      ' - ' + end.toLocaleTimeString('ja-JP', { hour:'2-digit', minute:'2-digit' });
    return datePart + ' ' + timePart;
  }

  function groupByUser(events){
    var map = {};
    events.forEach(function(ev){
      var uid = ev.userId || 'unknown';
      if (!map[uid]){
        map[uid] = {
          userId: uid,
          userName: ev.userName || '不明なユーザー',
          events: []
        };
      }
      map[uid].events.push(ev);
    });
    return Object.keys(map)
      .map(function(k){ return map[k]; })
      .sort(function(a,b){ return a.userName.localeCompare(b.userName, 'ja'); });
  }

  function renderAdminEvents(){
    var allList = document.getElementById('adminAllList');
    var byCustomerContainer = document.getElementById('adminByCustomerList');
    var dayContainer = document.getElementById('adminDayList');
    var visualContainer = document.getElementById('adminVisual');
    var customerSearchInput = document.getElementById('customerSearchInput');
    var daySortSelect = document.getElementById('daySortSelect');
    var dayFromInput = document.getElementById('dayFrom');
    var dayToInput = document.getElementById('dayTo');
    var events = (window.sharedEvents || []).slice();

    var customerQuery = customerSearchInput ? customerSearchInput.value.trim() : '';
    var daySortOrder = daySortSelect ? daySortSelect.value : 'asc';
    var dayFrom = dayFromInput && dayFromInput.value ? new Date(dayFromInput.value) : null;
    var dayTo = dayToInput && dayToInput.value ? new Date(dayToInput.value) : null;

    if (allList) allList.innerHTML = '';
    if (byCustomerContainer) byCustomerContainer.innerHTML = '';
    if (dayContainer) dayContainer.innerHTML = '';
    if (visualContainer) visualContainer.innerHTML = '';

    // 終了時刻が過去 かつ ユーザーステータスが done の予定はダッシュボードから除外
    var now = new Date();
    events = events.filter(function(ev){
      var end = new Date(ev.end);
      var status = getUserStatus(ev.userId);
      if (end < now && status === 'done') return false;
      return true;
    });

    if (!events.length){
      if (allList){
        var empty = document.createElement('div');
        empty.className = 'task-empty';
        empty.textContent = '登録されているスケジュールがありません';
        allList.appendChild(empty);
      }
      return;
    }

    // 全スケジュール（日程順）リスト
    if (allList){
      events
        .slice()
        .sort(function(a,b){ return new Date(a.start) - new Date(b.start); })
        .forEach(function(ev){
          var item = document.createElement('div');
          item.className = 'task-item';

          var title = document.createElement('div');
          title.className = 'task-item-title';
          title.textContent = ev.title;

          var meta = document.createElement('div');
          meta.className = 'task-item-meta';
          meta.textContent = ev.userName + ' / ' + formatRange(ev);

          item.appendChild(title);
          item.appendChild(meta);
          allList.appendChild(item);
        });
    }

    // ステータスカード（顧客別・コンパクト）
    if (visualContainer){
      var users = (window.sharedUsers || []).slice();

      // ステータス順に並べる: before(片づけ前) -> done(片づけ完了)
      var order = { before: 0, done: 1 };
      users.sort(function(a,b){
        var sa = order[a.status || 'done'];
        var sb = order[b.status || 'done'];
        if (sa !== sb) return sa - sb;
        return a.name.localeCompare(b.name, 'ja');
      });

      var today = new Date();

      users.forEach(function(user){
        var userEvents = events.filter(function(ev){ return ev.userId === user.id; });
        var todayEvents = userEvents.filter(function(ev){ return isSameDay(new Date(ev.start), today); });

        // 要約テキスト（今日のスケジュール）。
        // 今日の予定がない場合は何も表示しない。
        var summary = '';
        if (todayEvents.length > 0){
          var first = todayEvents.slice().sort(function(a,b){ return new Date(a.start) - new Date(b.start); })[0];
          var d = new Date(first.start);
          var time = d.toLocaleTimeString('ja-JP', { hour:'2-digit', minute:'2-digit' });
          summary = time + ' ' + first.title;
        }

        // 色判定
        var now = new Date();
        var hasOverdue = userEvents.some(function(ev){
          var end = new Date(ev.end);
          return end < now;
        });
        var userStatus = user.status || 'done';
        var colorClass;
        if (hasOverdue && userStatus !== 'done'){
          // 予定時間が過ぎているのに「片づけ完了」になっていない
          colorClass = 'status-overdue';
        } else if (todayEvents.length > 0){
          // 今日片づけ予定が入っている顧客
          colorClass = 'status-before';
        } else {
          // それ以外は顧客ステータスに応じて
          colorClass = 'status-' + userStatus;
        }

        // ステータスカードには赤(status-overdue)と黄(status-before)のみ表示する
        if (colorClass !== 'status-overdue' && colorClass !== 'status-before'){
          return;
        }

        var card = document.createElement('div');
        card.className = 'admin-status-card ' + colorClass;

        var main = document.createElement('button');
        main.type = 'button';
        main.className = 'admin-status-main';

        var nameEl = document.createElement('div');
        nameEl.className = 'admin-status-name';
        nameEl.textContent = user.name;

        var summaryEl = document.createElement('div');
        summaryEl.className = 'admin-status-summary';
        summaryEl.textContent = summary;

        var dot = document.createElement('span');
        dot.className = 'admin-status-dot';

        main.appendChild(nameEl);
        main.appendChild(summaryEl);
        main.appendChild(dot);

        var detail = document.createElement('div');
        detail.className = 'admin-status-detail';

        if (userEvents.length === 0){
          var empty = document.createElement('div');
          empty.className = 'task-empty';
          empty.textContent = '登録されているスケジュールがありません';
          detail.appendChild(empty);
        } else {
          userEvents
            .slice()
            .sort(function(a,b){ return new Date(a.start) - new Date(b.start); })
            .forEach(function(ev){
              var item = document.createElement('div');
              item.className = 'task-item';

              var t = document.createElement('div');
              t.className = 'task-item-title';
              t.textContent = ev.title;

              var m = document.createElement('div');
              m.className = 'task-item-meta';
              m.textContent = formatRange(ev);

              item.appendChild(t);
              item.appendChild(m);
              detail.appendChild(item);
            });
        }

        main.addEventListener('click', function(){
          var isOpen = detail.getAttribute('data-open') === 'true';
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
    if (byCustomerContainer){
      var userGroups = groupByUser(events);

      if (customerQuery){
        var q = customerQuery.toLowerCase();
        userGroups = userGroups.filter(function(group){
          return (group.userName || '').toLowerCase().indexOf(q) !== -1;
        });
      }

      if (!userGroups.length){
        var emptyCustomer = document.createElement('div');
        emptyCustomer.className = 'task-empty';
        emptyCustomer.textContent = '該当する顧客がいません';
        byCustomerContainer.appendChild(emptyCustomer);
        return;
      }

      userGroups.forEach(function(group){
        var section = document.createElement('div');
        section.className = 'tasks-group';

        var header = document.createElement('div');
        header.className = 'tasks-group-title';
        header.textContent = group.userName;

        var list = document.createElement('div');
        list.className = 'tasks-list';

        group.events
          .slice()
          .sort(function(a,b){ return new Date(a.start) - new Date(b.start); })
          .forEach(function(ev){
            var item = document.createElement('div');
            item.className = 'task-item';

            var title = document.createElement('div');
            title.className = 'task-item-title';
            title.textContent = ev.title;

            var meta = document.createElement('div');
            meta.className = 'task-item-meta';
            meta.textContent = formatRange(ev);

            item.appendChild(title);
            item.appendChild(meta);
            list.appendChild(item);
          });

        section.appendChild(header);
        section.appendChild(list);
        byCustomerContainer.appendChild(section);
      });
    }

    // 日別（セクションごとに日付見出し+リスト）
    if (dayContainer){
      var byDateForDay = {};
      events.forEach(function(ev){
        var d = new Date(ev.start);
        var key = d.getFullYear() + '-' + (d.getMonth()+1) + '-' + d.getDate();
        if (!byDateForDay[key]) byDateForDay[key] = { date: d, events: [] };
        byDateForDay[key].events.push(ev);
      });

      var dayBlocks = Object.keys(byDateForDay)
        .map(function(k){ return byDateForDay[k]; })
        .filter(function(block){
          if (dayFrom && block.date < dayFrom) return false;
          if (dayTo){
            // dayTo の日付の 23:59 までを含める
            var endOfTo = new Date(dayTo.getFullYear(), dayTo.getMonth(), dayTo.getDate(), 23, 59, 59, 999);
            if (block.date > endOfTo) return false;
          }
          return true;
        })
        .sort(function(a,b){
          if (daySortOrder === 'desc'){
            return b.date - a.date;
          }
          return a.date - b.date;
        });

      dayBlocks.forEach(function(block){
        var section = document.createElement('div');
        section.className = 'tasks-group';

        var header = document.createElement('div');
        header.className = 'tasks-group-title';
        header.textContent = block.date.toLocaleDateString('ja-JP', { month:'2-digit', day:'2-digit', weekday:'short' });

        var list = document.createElement('div');
        list.className = 'tasks-list';

        block.events
          .slice()
          .sort(function(a,b){ return new Date(a.start) - new Date(b.start); })
          .forEach(function(ev){
            var item = document.createElement('div');
            item.className = 'task-item';

            var title = document.createElement('div');
            title.className = 'task-item-title';
            title.textContent = ev.title;

            var meta = document.createElement('div');
            meta.className = 'task-item-meta';
            meta.textContent = ev.userName + ' / ' + formatRange(ev);

            item.appendChild(title);
            item.appendChild(meta);
            list.appendChild(item);
          });

        section.appendChild(header);
        section.appendChild(list);
        dayContainer.appendChild(section);
      });
    }
  }

  function setupTabs(){
    var tabAll = document.getElementById('adminTabAll');
    var tabCustomer = document.getElementById('adminTabCustomer');
    var tabDay = document.getElementById('adminTabDay');
    var groupAll = document.querySelector('[data-tab="all"]');
    var groupCustomer = document.querySelector('[data-tab="customer"]');
    var groupDay = document.querySelector('[data-tab="day"]');
    var customerSearchInput = document.getElementById('customerSearchInput');
    var daySortSelect = document.getElementById('daySortSelect');
    var dayFromInput = document.getElementById('dayFrom');
    var dayToInput = document.getElementById('dayTo');

    function activate(target){
      var showAll = target === 'all';
      var showCustomer = target === 'customer';
      var showDay = target === 'day';

      if (groupAll) groupAll.style.display = showAll ? '' : 'none';
      if (groupCustomer) groupCustomer.style.display = showCustomer ? '' : 'none';
      if (groupDay) groupDay.style.display = showDay ? '' : 'none';

      if (tabAll){
        tabAll.classList.toggle('is-active', showAll);
        tabAll.setAttribute('aria-selected', showAll ? 'true' : 'false');
      }
      if (tabCustomer){
        tabCustomer.classList.toggle('is-active', showCustomer);
        tabCustomer.setAttribute('aria-selected', showCustomer ? 'true' : 'false');
      }
      if (tabDay){
        tabDay.classList.toggle('is-active', showDay);
        tabDay.setAttribute('aria-selected', showDay ? 'true' : 'false');
      }
    }

    if (tabAll){
      tabAll.addEventListener('click', function(){ activate('all'); });
    }
    if (tabCustomer){
      tabCustomer.addEventListener('click', function(){ activate('customer'); });
    }
    if (tabDay){
      tabDay.addEventListener('click', function(){ activate('day'); });
    }

    // 顧客検索: 入力するたびに顧客別リストを再描画
    if (customerSearchInput){
      customerSearchInput.addEventListener('input', function(){
        renderAdminEvents();
      });
    }

    // 日別ソート: セレクト変更時に日別リストを再描画
    if (daySortSelect){
      daySortSelect.addEventListener('change', function(){
        renderAdminEvents();
      });
    }

    if (dayFromInput){
      dayFromInput.addEventListener('change', function(){
        renderAdminEvents();
      });
    }

    if (dayToInput){
      dayToInput.addEventListener('change', function(){
        renderAdminEvents();
      });
    }
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', function(){
      renderAdminEvents();
      setupTabs();
    });
  } else {
    renderAdminEvents();
    setupTabs();
  }
})();
