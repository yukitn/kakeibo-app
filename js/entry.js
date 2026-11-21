// 収支入力シート（新規/編集）。電卓テンキー＋ワンタップチップ中心。
import { call } from './api.js';
import { load, save } from './store.js';
import { today, shiftDay } from './period.js';
import { h, chip, field, errText, openSheet, toast, yen } from './ui.js';
import { createKeypad, evaluate } from './keypad.js';
import { compressImage, stripDataUrl } from './image.js';
import * as S from './state.js';

/**
 * @param {object} opts
 * @param {object} [opts.tx]      編集対象の取引（無ければ新規）
 * @param {function} opts.onSaved 保存/更新後に呼ばれる
 */
export function openEntry({ tx = null, onSaved = () => {} } = {}) {
  const s = load();
  const lastAcc = (s.lastAccount || {})[s.activeId] || '';
  const st = {
    type: tx?.type || 'expense',
    expr: tx ? String(tx.amount) : '',
    categoryId: tx?.category_id || '',
    subId: tx?.subcategory_id || '',
    accountId: tx?.account_id || lastAcc || S.accounts()[0]?.id || '',
    tags: tx?.tags ? String(tx.tags).split(';').filter(Boolean) : [],
    date: tx?.date || today(),
    memo: tx?.memo || '',
    receipt: tx?.receipt_file_id ? { file_id: tx.receipt_file_id, url: tx.receipt_url } : null,
    newImage: null,   // data URL（未アップロード）
    keepGoing: false,
    saving: false
  };

  const amountEl = h('div', { class: 'amount', 'aria-live': 'polite' });
  const exprEl = h('div', { class: 'expr muted' });
  const keypad = createKeypad(st.expr, (e) => { st.expr = e; paintAmount(); });
  const typeBar = h('div', { class: 'seg', role: 'group', 'aria-label': '収支の種類' });
  const catBox = h('div', { class: 'chips' });
  const subBox = h('div', { class: 'chips' });
  const accBox = h('div', { class: 'chips' });
  const tagBox = h('div', { class: 'chips' });
  const dateBox = h('div', { class: 'chips' });
  const imgBox = h('div', { class: 'imgbox' });
  const msg = h('p', { class: 'msg', role: 'alert' });
  const memo = h('input', { type: 'text', maxlength: 200, placeholder: '備考（任意）', value: st.memo, oninput: (e) => { st.memo = e.target.value; } });
  const saveBtn = h('button', { class: 'btn primary save', type: 'button', onclick: () => doSave() }, tx ? '更新する' : '保存する');

  function paintAmount() {
    const v = evaluate(st.expr);
    amountEl.textContent = v === null ? 'エラー' : yen(v);
    amountEl.className = 'amount ' + st.type;
    const hasOp = /[+\-×÷]/.test(st.expr);
    exprEl.textContent = hasOp ? st.expr : '';
  }

  function paintType() {
    typeBar.replaceChildren(
      ...[['expense', '支出'], ['income', '収入']].map(([k, label]) =>
        h('button', {
          type: 'button', class: 'seg-btn ' + k + (st.type === k ? ' on' : ''), 'aria-pressed': String(st.type === k),
          onclick: () => { if (st.type !== k) { st.type = k; st.categoryId = ''; st.subId = ''; paintAll(); } }
        }, label)));
  }

  function paintCats() {
    catBox.replaceChildren(...S.topCategories(st.type).map((c) =>
      chip(c.name, {
        icon: c.icon, selected: st.categoryId === c.id,
        onclick: () => { st.categoryId = c.id; st.subId = ''; paintCats(); }
      })));
    const subs = st.categoryId ? S.subCategories(st.categoryId) : [];
    subBox.replaceChildren(...subs.map((c) =>
      chip(c.name, {
        kind: 'sub', selected: st.subId === c.id,
        onclick: () => { st.subId = st.subId === c.id ? '' : c.id; paintCats(); }   // もう一度押すと解除
      })));
    subBox.hidden = subs.length === 0;
  }

  function paintAccounts() {
    accBox.replaceChildren(...S.accounts().map((a) =>
      chip(a.name, { selected: st.accountId === a.id, onclick: () => { st.accountId = a.id; paintAccounts(); } })));
  }

  function paintTags() {
    const addInput = h('input', { type: 'text', maxlength: 20, placeholder: '新しいタグ', class: 'tag-input', 'aria-label': '新しいタグ名' });
    const addBtn = h('button', { type: 'button', class: 'chip add', onclick: () => addTag(addInput) }, '＋追加');
    addInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(addInput); } });
    tagBox.replaceChildren(
      ...S.tags().map((t) => chip('#' + t.name, {
        selected: st.tags.includes(t.id),
        onclick: () => { st.tags = st.tags.includes(t.id) ? st.tags.filter((x) => x !== t.id) : [...st.tags, t.id]; paintTags(); }
      })),
      h('span', { class: 'tag-add' }, addInput, addBtn));
  }

  async function addTag(input) {
    const name = input.value.trim().replace(/^#/, '');
    if (!name) return;
    const exist = S.tags().find((t) => t.name === name);
    if (exist) { if (!st.tags.includes(exist.id)) st.tags.push(exist.id); paintTags(); return; }
    try {
      const row = await call('master.upsert', { entity: 'tag', item: { name, sort: S.tags().length + 1 } }, { user_id: S.currentUserId() });
      S.getBoot().tags.push(row);
      st.tags.push(row.id);
      paintTags();
    } catch (e) { msg.textContent = errText(e); }
  }

  function paintDate() {
    const t = today(), y = shiftDay(t, -1);
    const picker = h('input', {
      type: 'date', value: st.date, class: 'date-input', 'aria-label': '日付を選ぶ',
      onchange: (e) => { if (e.target.value) { st.date = e.target.value; paintDate(); } }
    });
    dateBox.replaceChildren(
      chip('今日', { selected: st.date === t, onclick: () => { st.date = t; paintDate(); } }),
      chip('昨日', { selected: st.date === y, onclick: () => { st.date = y; paintDate(); } }),
      picker);
  }

  function paintImage() {
    const src = st.newImage;
    const fileIn = (capture) => h('input', {
      type: 'file', accept: 'image/*', capture: capture ? 'environment' : false, class: 'sr-only', tabindex: -1,
      onchange: async (e) => {
        const f = e.target.files && e.target.files[0];
        e.target.value = '';
        if (!f) return;
        msg.textContent = '';
        try { st.newImage = await compressImage(f); st.receipt = null; paintImage(); }
        catch (err) { msg.textContent = err.message || '画像を処理できませんでした'; }
      }
    });
    const cam = fileIn(true), album = fileIn(false);
    imgBox.replaceChildren(
      h('div', { class: 'row-left' },
        h('button', { type: 'button', class: 'btn small', onclick: () => cam.click() }, '📷 撮影'),
        h('button', { type: 'button', class: 'btn small', onclick: () => album.click() }, '🖼 アルバム'),
        cam, album),
      src && h('div', { class: 'thumb' }, h('img', { src, alt: '添付する領収書のプレビュー' }),
        h('button', { type: 'button', class: 'btn small', onclick: () => { st.newImage = null; paintImage(); } }, '外す')),
      !src && st.receipt && h('div', { class: 'thumb' }, h('span', { class: 'muted' }, '📎 領収書あり'),
        h('button', { type: 'button', class: 'btn small', onclick: () => { st.receipt = null; paintImage(); } }, '外す')));
  }

  function paintAll() { paintType(); paintAmount(); paintCats(); paintAccounts(); paintTags(); paintDate(); paintImage(); }

  async function doSave() {
    if (st.saving) return;
    msg.textContent = '';
    const amount = evaluate(st.expr);
    if (amount === null || !(amount > 0)) { msg.textContent = '金額を入力してください'; return; }
    if (!st.categoryId) { msg.textContent = 'カテゴリを選んでください'; return; }
    if (!st.accountId) { msg.textContent = st.type === 'expense' ? '支払い方法を選んでください' : '入金先を選んでください'; return; }
    st.saving = true; saveBtn.disabled = true; saveBtn.textContent = '保存中…';
    try {
      const client = { user_id: S.currentUserId() };
      let receipt = st.receipt;
      if (st.newImage) {
        saveBtn.textContent = '画像を保存中…';
        receipt = await call('image.upload', { data_base64: stripDataUrl(st.newImage) }, client);
      }
      const payload = {
        type: st.type, amount, date: st.date,
        category_id: st.categoryId, subcategory_id: st.subId, account_id: st.accountId,
        tags: st.tags, memo: st.memo,
        receipt_url: receipt ? receipt.url : '', receipt_file_id: receipt ? receipt.file_id : '',
        user_id: tx?.user_id || S.currentUserId()
      };
      if (tx) await call('tx.update', { ...payload, id: tx.id, updated_at: tx.updated_at }, client);
      else await call('tx.create', payload, client);

      const sv = load();
      sv.lastAccount = { ...(sv.lastAccount || {}), [sv.activeId]: st.accountId };
      save();
      toast(tx ? '更新しました' : `${yen(amount)} を保存しました`);
      onSaved();
      if (st.keepGoing && !tx) {
        st.expr = ''; st.memo = ''; st.tags = []; st.newImage = null; st.receipt = null;
        memo.value = '';
        keypad.set('');
        paintAll();
      } else close();
    } catch (e) {
      msg.textContent = e.code === 'CONFLICT' ? '他の端末で更新されています。閉じて開き直してください' : errText(e);
    } finally {
      st.saving = false; saveBtn.disabled = false; saveBtn.textContent = tx ? '更新する' : '保存する';
    }
  }

  const keepToggle = !tx && h('label', { class: 'check' },
    h('input', { type: 'checkbox', onchange: (e) => { st.keepGoing = e.target.checked; } }), '続けて入力');

  const left = h('div', { class: 'entry-left' }, typeBar, exprEl, amountEl, keypad.el);
  const right = h('div', { class: 'entry-right' },
    h('h3', {}, 'カテゴリ'), catBox, subBox,
    h('h3', {}, '支払い方法 / 入金先'), accBox,
    h('h3', {}, 'タグ'), tagBox,
    h('h3', {}, '日付'), dateBox,
    field('備考', memo),
    h('h3', {}, '領収書'), imgBox);

  const header = h('div', { class: 'sheet-head' },
    h('h2', {}, tx ? '収支を編集' : '収支を入力'),
    h('button', { type: 'button', class: 'btn ghost small', onclick: () => close(), 'aria-label': '閉じる' }, '✕'));
  const footer = h('div', { class: 'sheet-foot' }, msg, h('div', { class: 'row' }, keepToggle || h('span'), saveBtn));

  const close = openSheet(h('div', { class: 'entry' }, header, h('div', { class: 'entry-body' }, left, right), footer), { label: '収支入力' });
  paintAll();
}
