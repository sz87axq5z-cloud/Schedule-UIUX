// ユーザー画面と管理者画面で共有するダミースケジュール
// シンプルに Date / toISOString のみを使い、他のスクリプトに依存しない形で定義する

function createSharedEventsBaseDate() {
  var now = new Date();
  // 週の開始（ここでは月曜始まり想定で調整）
  var day = now.getDay(); // 0=日
  var diff = day === 0 ? -6 : 1 - day;
  var monday = new Date(now);
  monday.setDate(now.getDate() + diff);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

var baseMonday = createSharedEventsBaseDate();

function addDaysFromBase(base, offset) {
  var d = new Date(base);
  d.setDate(d.getDate() + offset);
  return d;
}

function buildDateTime(base, offsetDay, hour, minute) {
  var d = addDaysFromBase(base, offsetDay);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

function simpleUid() {
  return Math.random().toString(36).slice(2, 10);
}

// 簡易ユーザー定義（= 顧客名）
// status: 'before' | 'done' を想定
// before: 片づけ前, done: 片づけ完了
// u1〜u10 の10名分を用意し、ダッシュボードで全パターンの挙動を確認できるようにする
var sharedUsers = [
  { id: "u1",  name: "山田 太郎",   status: "before" }, // 今日+未来の予定
  { id: "u2",  name: "佐藤 花子",   status: "before" }, // 過去+今日の予定
  { id: "u3",  name: "鈴木 一郎",   status: "before" }, // 未来のみ
  { id: "u4",  name: "高橋 美咲",   status: "before" }, // 過去のみ（未完了）
  { id: "u5",  name: "田中 健",     status: "before" }, // 今日のみ
  { id: "u6",  name: "井上 彩",     status: "before" }, // 未来+今日
  { id: "u7",  name: "中村 直人",   status: "before" }, // 過去のみ（完了にすると非表示を確認）
  { id: "u8",  name: "小林 愛",     status: "before" }, // 未来のみ（完了=特に影響なし）
  { id: "u9",  name: "石井 誠",     status: "before" }, // イベントなし
  { id: "u10", name: "松本 友里",   status: "before" }  // 今日+過去
];

// localStorage に保存されているステータスで上書き（ユーザー/管理画面間で同期）
try {
  var overridesRaw = window.localStorage && window.localStorage.getItem('userStatusOverrides');
  if (overridesRaw) {
    var overrides = JSON.parse(overridesRaw);
    if (overrides && typeof overrides === 'object') {
      sharedUsers.forEach(function(u){
        var st = overrides[u.id];
        if (st === 'before' || st === 'done') {
          u.status = st;
        }
      });
    }
  }
} catch (e) {
  // localStorage が使えない環境では何もしない
}

var sharedEvents = [
  // u1: 今日+未来
  { id: simpleUid(), userId: "u1", userName: "山田 太郎", title: "リビングの床を片付ける", start: buildDateTime(baseMonday, 0, 9, 0), end: buildDateTime(baseMonday, 0, 9, 30), calendar: "team" }, // 今日
  { id: simpleUid(), userId: "u1", userName: "山田 太郎", title: "押入れの整理", start: buildDateTime(baseMonday, 3, 10, 0), end: buildDateTime(baseMonday, 3, 11, 0), calendar: "personal" },          // 数日後

  // u2: 過去+今日
  { id: simpleUid(), userId: "u2", userName: "佐藤 花子", title: "クローゼットの服を仕分け", start: buildDateTime(baseMonday, -2, 10, 0), end: buildDateTime(baseMonday, -2, 12, 0), calendar: "personal" }, // 過去
  { id: simpleUid(), userId: "u2", userName: "佐藤 花子", title: "本棚の本を手放す・整える", start: buildDateTime(baseMonday, 0, 14, 30), end: buildDateTime(baseMonday, 0, 15, 0), calendar: "team" },      // 今日

  // u3: 未来のみ
  { id: simpleUid(), userId: "u3", userName: "鈴木 一郎", title: "キッチンのシンク・作業台をリセット", start: buildDateTime(baseMonday, 2, 10, 30), end: buildDateTime(baseMonday, 2, 11, 30), calendar: "external" },
  { id: simpleUid(), userId: "u3", userName: "鈴木 一郎", title: "寝室のベッドまわりを整える", start: buildDateTime(baseMonday, 4, 14, 0), end: buildDateTime(baseMonday, 4, 14, 45), calendar: "team" },

  // u4: 過去のみ（未完了）
  { id: simpleUid(), userId: "u4", userName: "高橋 美咲", title: "玄関の靴・段ボール整理", start: buildDateTime(baseMonday, -3, 13, 0), end: buildDateTime(baseMonday, -3, 15, 0), calendar: "external" },

  // u5: 今日のみ
  { id: simpleUid(), userId: "u5", userName: "田中 健", title: "子供部屋のおもちゃを片付ける", start: buildDateTime(baseMonday, 0, 16, 0), end: buildDateTime(baseMonday, 0, 17, 0), calendar: "personal" },

  // u6: 未来+今日
  { id: simpleUid(), userId: "u6", userName: "井上 彩", title: "リビングの棚を整理", start: buildDateTime(baseMonday, 1, 9, 30), end: buildDateTime(baseMonday, 1, 10, 30), calendar: "team" },        // 明日
  { id: simpleUid(), userId: "u6", userName: "井上 彩", title: "キッチン収納の見直し", start: buildDateTime(baseMonday, 0, 11, 0), end: buildDateTime(baseMonday, 0, 12, 0), calendar: "external" },   // 今日

  // u7: 過去のみ（完了にすると完全に非表示になるパターン）
  { id: simpleUid(), userId: "u7", userName: "中村 直人", title: "書斎の書類を整理", start: buildDateTime(baseMonday, -1, 9, 0), end: buildDateTime(baseMonday, -1, 10, 0), calendar: "personal" },

  // u8: 未来のみ（完了にしてもフィルタにはかからない）
  { id: simpleUid(), userId: "u8", userName: "小林 愛", title: "クローゼットの入れ替え", start: buildDateTime(baseMonday, 5, 15, 0), end: buildDateTime(baseMonday, 5, 16, 0), calendar: "team" },

  // u9: イベントなし（カードも詳しいリストにも出てこないパターンを確認）

  // u10: 今日+過去
  { id: simpleUid(), userId: "u10", userName: "松本 友里", title: "洗面所まわりを片付ける", start: buildDateTime(baseMonday, -4, 10, 0), end: buildDateTime(baseMonday, -4, 11, 0), calendar: "external" },
  { id: simpleUid(), userId: "u10", userName: "松本 友里", title: "寝室のクローゼット整理", start: buildDateTime(baseMonday, 0, 19, 0), end: buildDateTime(baseMonday, 0, 20, 0), calendar: "personal" }
];

window.sharedEvents = sharedEvents;
window.sharedUsers = sharedUsers;
