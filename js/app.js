import { load, save, activeProfile } from './store.js';
import * as auth from './auth.js';
import { call, callWith, ApiError } from './api.js';
import { getPeriod, today } from './period.js';

const root = document.getElementById('app');
let boot = null; // bootstrap データ（ロック時に破棄）

/* ---------- 小さな DOM ヘルパー（innerHTML は使わず XSS を避ける） ---------- */
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}
const render = (...nodes) => root.replaceChildren(...nodes);
const errText = (e) => (e instanceof ApiError ? e.message : '予期しないエラーが発生しました');

function field(label, input, hint) {
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), input, hint && h('span', { class: 'hint' }, hint));
}

/* ---------- 画面の振り分け ---------- */
function route() {
  const p = activeProfile();
  if (!p) return viewSetup({ first: true });
  if (!auth.isUnlocked()) return viewLock(p);
  return viewMain('home');
}

/* ---------- セットアップ（新規プロファイル登録 / 合言葉更新） ---------- */
function viewSetup({ first = false, updateProfile = null } = {}) {
  const isUpdate = !!updateProfile;
  const msg = h('p', { class: 'msg', role: 'alert' });
  const name = h('input', { type: 'text', name: 'username', autocomplete: 'username', maxlength: 30, value: updateProfile?.name || '', placeholder: '例: わが家' });
  const url = h('input', { type: 'url', inputmode: 'url', autocomplete: 'off', placeholder: 'https://script.google.com/macros/s/…/exec', value: updateProfile?.url || '' });
  const pass = h('input', { type: 'password', name: 'password', autocomplete: 'new-password', minlength: auth.MIN_LENGTH, placeholder: `${auth.MIN_LENGTH}文字以上の英数字` });
  const user = h('input', { type: 'text', autocomplete: 'off', maxlength: 20, placeholder: '例: ゆうき（あとで変更できます）' });
  const btn = h('button', { class: 'btn primary', type: 'submit' }, isUpdate ? '合言葉を更新' : '接続して始める');

  const form = h('form', {
    class: 'card form',
    onsubmit: async (ev) => {
      ev.preventDefault();
      msg.textContent = '';
      const problem = auth.validatePassphrase(pass.value);
      if (problem) { msg.textContent = problem; return; }
      if (!name.value.trim()) { msg.textContent = '名前を入力してください'; return; }
      btn.disabled = true; btn.textContent = '接続中…';
      try {
        const u = url.value.trim();
        const info = await callWith(u, pass.value, 'auth.check');
        if (!info.initialized) {
          await callWith(u, pass.value, 'setup.init', { user_name: user.value.trim() });
        }
        const verifier = await auth.makeVerifier(pass.value);
        const s = load();
        if (isUpdate) {
          Object.assign(updateProfile, { name: name.value.trim(), url: u, ...verifier });
        } else {
          const profile = { id: crypto.randomUUID(), name: name.value.trim(), url: u, ...verifier };
          s.profiles.push(profile);
          s.activeId = profile.id;
        }
        save();
        auth.setToken(pass.value);
        boot = null;
        viewMain('home');
      } catch (e) {
        msg.textContent = errText(e);
        btn.disabled = false; btn.textContent = isUpdate ? '合言葉を更新' : '接続して始める';
      }
    }
  },
    field('プロファイル名', name),
    field('GAS の Web アプリ URL', url, 'スプレッドシートの Apps Script をデプロイして発行された URL'),
    field('合言葉', pass, 'GAS のスクリプトプロパティ API_TOKEN と同じもの。パスワード管理アプリの自動入力が使えます'),
    !isUpdate && field('あなたの表示名（初回のみ）', user),
    msg, btn,
    !first && h('button', { class: 'btn ghost', type: 'button', onclick: () => (activeProfile() ? viewMain('settings') : route()) }, 'キャンセル')
  );

  render(h('main', { class: 'center' },
    h('h1', { class: 'logo' }, '🌿 家計簿'),
    h('p', { class: 'lead' }, isUpdate ? '新しい合言葉を入力してください' : 'はじめに、あなたのスプレッドシート（GAS）につなぎます'),
    form,
    h('p', { class: 'note' }, '銀行・証券のIDやパスワード、カード番号は入力しないでください。')
  ));
}

/* ---------- ロック画面 ---------- */
function viewLock(profile) {
  const msg = h('p', { class: 'msg', role: 'alert' });
  const pass = h('input', { type: 'password', name: 'password', autocomplete: 'current-password', placeholder: '合言葉', autofocus: true });
  const btn = h('button', { class: 'btn primary', type: 'submit' }, 'ひらく');
  const store = load();

  const form = h('form', {
    class: 'card form',
    onsubmit: async (ev) => {
      ev.preventDefault();
      msg.textContent = '';
      btn.disabled = true;
      try {
        if (await auth.unlock(profile, pass.value)) { viewMain('home'); return; }
        msg.textContent = '合言葉が違います';
      } finally { btn.disabled = false; pass.select(); }
    }
  },
    // パスワード管理アプリが保存/補完できるよう、ユーザー名欄を同梱
    h('input', { type: 'text', name: 'username', autocomplete: 'username', value: profile.name, class: 'sr-only', tabindex: -1, 'aria-hidden': 'true', readonly: true }),
    field(profile.name, pass), msg, btn,
    store.profiles.length > 1 && h('button', { class: 'btn ghost', type: 'button', onclick: () => switchMenu() }, 'プロファイルを切り替える')
  );

  const switchMenu = () => {
    const list = h('div', { class: 'card list' }, store.profiles.map((p) =>
      h('button', { class: 'btn ghost', type: 'button', onclick: () => { store.activeId = p.id; save(); route(); } }, p.name)));
    render(h('main', { class: 'center' }, h('h1', { class: 'logo' }, '🌿 家計簿'), list));
  };

  render(h('main', { class: 'center' }, h('h1', { class: 'logo' }, '🌿 家計簿'), h('p', { class: 'lead' }, 'ロック中'), form));
  pass.focus();
}

/* ---------- メイン（タブ） ---------- */
const TABS = [
  { id: 'home', label: 'ホーム', icon: '🏠' },
  { id: 'settings', label: '設定', icon: '⚙️' }
  // M2 以降: 履歴 / 統計 / 予算 / 資産 / 目標 / メモ
];

function viewMain(tab) {
  const body = h('div', { class: 'content' });
  const nav = h('nav', { class: 'nav', 'aria-label': 'メイン' }, TABS.map((t) =>
    h('button', { class: 'nav-item' + (t.id === tab ? ' active' : ''), type: 'button', 'aria-current': t.id === tab ? 'page' : false, onclick: () => viewMain(t.id) },
      h('span', { class: 'nav-icon', 'aria-hidden': 'true' }, t.icon), h('span', {}, t.label))));
  render(h('div', { class: 'shell' }, nav, h('main', { class: 'main' }, body)));
  (tab === 'settings' ? paintSettings : paintHome)(body);
}

async function ensureBoot() {
  if (boot) return boot;
  boot = await call('bootstrap', {}, { user_id: currentUserId() });
  return boot;
}

function currentUserId() {
  const s = load();
  return s.defaultUserId[s.activeId] || boot?.users?.[0]?.id || '';
}

async function paintHome(body) {
  body.replaceChildren(h('h2', {}, 'ホーム'), h('p', { class: 'muted' }, '読み込み中…'));
  try {
    const b = await ensureBoot();
    const startDay = Number(b.settings.month_start_day) || 1;
    const period = getPeriod(today(), startDay);
    const cats = b.categories.filter((c) => !c.parent_id && c.is_active !== false);
    body.replaceChildren(
      h('h2', {}, 'ホーム'),
      h('div', { class: 'card' },
        h('p', { class: 'ok' }, '✅ つながりました'),
        h('p', { class: 'muted' }, `今月の期間: ${period.from} 〜 ${period.to}`),
        h('p', { class: 'muted' }, `大カテゴリ ${cats.length} 件 / タグ ${b.tags.length} 件 / 支払い方法 ${b.accounts.length} 件 / ユーザー ${b.users.length} 人`)),
      h('div', { class: 'card' }, h('p', {}, '収支の入力・履歴・統計は次のステップ（M2以降）で追加します。'))
    );
  } catch (e) {
    body.replaceChildren(h('h2', {}, 'ホーム'), h('p', { class: 'msg' }, errText(e)));
  }
}

/* ---------- 設定 ---------- */
function paintSettings(body) {
  const s = load();
  const p = activeProfile();
  const status = h('p', { class: 'muted', role: 'status' });

  const profiles = h('div', { class: 'card' }, h('h3', {}, 'プロファイル（接続先）'),
    s.profiles.map((x) =>
      h('div', { class: 'row' },
        h('span', {}, (x.id === s.activeId ? '● ' : '○ ') + x.name),
        x.id !== s.activeId && h('button', { class: 'btn small', type: 'button', onclick: () => { s.activeId = x.id; save(); auth.lock(); } }, '切替')
      )),
    h('div', { class: 'row' },
      h('button', { class: 'btn small', type: 'button', onclick: () => viewSetup({}) }, '＋ 接続先を追加'),
      h('button', { class: 'btn small', type: 'button', onclick: () => viewSetup({ updateProfile: p }) }, '合言葉を更新')));

  const test = h('button', { class: 'btn small', type: 'button', onclick: async () => {
    status.textContent = '確認中…';
    try { const r = await call('auth.check'); status.textContent = `接続OK（schema v${r.schema_version}）`; }
    catch (e) { status.textContent = errText(e); }
  } }, '接続テスト');

  const mins = h('select', { onchange: (e) => { s.lockMinutes = Number(e.target.value); save(); } },
    [1, 5, 15, 30].map((m) => h('option', { value: m, selected: s.lockMinutes === m }, `${m} 分`)));

  const userSel = h('select', { onchange: (e) => { s.defaultUserId[s.activeId] = e.target.value; save(); } }, h('option', {}, '読み込み中…'));
  ensureBoot().then((b) => {
    const cur = s.defaultUserId[s.activeId] || b.users[0]?.id;
    userSel.replaceChildren(...b.users.map((u) => h('option', { value: u.id, selected: u.id === cur }, u.name)));
  }).catch(() => userSel.replaceChildren(h('option', {}, '（取得できません）')));

  body.replaceChildren(
    h('h2', {}, '設定'),
    profiles,
    h('div', { class: 'card' }, h('h3', {}, '接続'), p && h('p', { class: 'muted break' }, p.url), test, status),
    h('div', { class: 'card' }, h('h3', {}, 'ロック'),
      field('無操作で自動ロックするまで', mins),
      h('button', { class: 'btn small', type: 'button', onclick: () => auth.lock() }, '今すぐロック')),
    h('div', { class: 'card' }, h('h3', {}, 'この端末の入力者'), field('既定のユーザー', userSel, '端末ごとに保存されます')),
    h('div', { class: 'card' }, h('h3', {}, 'データについて'),
      h('p', { class: 'muted' }, 'データはあなたのGoogleスプレッドシートに保存されます。この端末には接続先URLと合言葉の検証用ハッシュのみ保存し、合言葉そのものは保存しません。'))
  );
}

/* ---------- 起動 ---------- */
auth.onLock(() => { boot = null; if (activeProfile()) viewLock(activeProfile()); else route(); });
auth.startIdleLock();
route();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
