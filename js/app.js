import { load, save, activeProfile } from './store.js';
import * as auth from './auth.js';
import { call, callWith } from './api.js';
import { h, field, errText, closeAllSheets, fill } from './ui.js';
import * as S from './state.js';
import { paintHome, paintHistory } from './history.js';
import { openEntry } from './entry.js';
import { paintBudget } from './budget.js';
import { paintStats } from './stats.js';
import { paintAssets } from './assets.js';
import { paintGoals } from './goals.js';

const root = document.getElementById('app');
const render = (...nodes) => fill(root, ...nodes);

/* ---------- 画面の振り分け ---------- */
function route() {
  const p = activeProfile();
  if (!p) return viewSetup({ first: true });
  if (!auth.isUnlocked()) return viewLock(p);
  return viewMain(lastTab);
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
        S.resetBoot();
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
        if (await auth.unlock(profile, pass.value)) { viewMain(lastTab); return; }
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
  { id: 'history', label: '履歴', icon: '📒' },
  { id: 'budget', label: '予算', icon: '🎯' },
  { id: 'stats', label: '統計', icon: '📊' },
  { id: 'assets', label: '資産', icon: '💰' },
  { id: 'goals', label: '目標', icon: '🌱' },
  { id: 'settings', label: '設定', icon: '⚙️' }
  // M5: メモ
];
let lastTab = 'home';

function viewMain(tab) {
  lastTab = tab;
  const body = h('div', { class: 'content' });
  const refresh = () => paintTab(tab, body);
  const nav = h('nav', { class: 'nav', 'aria-label': 'メイン' }, TABS.map((t) =>
    h('button', { class: 'nav-item' + (t.id === tab ? ' active' : ''), type: 'button', 'aria-current': t.id === tab ? 'page' : false, onclick: () => viewMain(t.id) },
      h('span', { class: 'nav-icon', 'aria-hidden': 'true' }, t.icon), h('span', {}, t.label))));
  const fab = !['settings', 'assets', 'goals'].includes(tab) && h('button', {
    class: 'fab', type: 'button', 'aria-label': '収支を入力',
    onclick: async () => {
      try { await S.ensureBoot(); } catch (e) { return; }
      openEntry({ onSaved: refresh });
    }
  }, h('span', { class: 'fab-plus', 'aria-hidden': 'true' }, '＋'), h('span', {}, '入力'));
  render(h('div', { class: 'shell' }, nav, h('main', { class: 'main' }, body), fab));
  refresh();
}

function paintTab(tab, body) {
  if (tab === 'settings') return paintSettings(body);
  if (tab === 'history') return paintHistory(body);
  if (tab === 'budget') return paintBudget(body);
  if (tab === 'stats') return paintStats(body);
  if (tab === 'assets') return paintAssets(body);
  if (tab === 'goals') return paintGoals(body);
  return paintHome(body);
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
  S.ensureBoot().then((b) => {
    const cur = s.defaultUserId[s.activeId] || b.users[0]?.id;
    fill(userSel, ...b.users.map((u) => h('option', { value: u.id, selected: u.id === cur }, u.name)));
  }).catch(() => fill(userSel, h('option', {}, '（取得できません）')));

  fill(ody, 
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
auth.onLock(() => {
  S.resetBoot();
  closeAllSheets();   // 入力途中のシート・領収書表示を確実に閉じる
  route();
});
auth.startIdleLock();
route();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
