// 軽量SVGグラフ（外部ライブラリなし）。色は CSS 変数/クラスで指定し、凡例は値のテキストを併記して色だけに頼らない。
const NS = 'http://www.w3.org/2000/svg';

export function svg(tag, attrs = {}, ...children) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) el.setAttribute(k, v);
  children.flat().forEach((c) => c != null && el.append(c.nodeType ? c : document.createTextNode(String(c))));
  return el;
}

/** 控えめなカテゴリカル配色（くすみカラー）。順序で割り当て、8色を超えたら循環 */
export const PALETTE = ['#8FA998', '#8FA7B8', '#D4B067', '#C97B6B', '#A58FB8', '#7FB3B0', '#B8A08F', '#9AA0A6'];
export const colorAt = (i) => PALETTE[i % PALETTE.length];

const rad = (deg) => (deg * Math.PI) / 180;

/** ドーナツの1セグメントのパス(角度は度、12時方向=0°から時計回り)。純粋関数 */
export function arcPath(cx, cy, r0, r1, a0, a1) {
  const p = (r, a) => [cx + r * Math.sin(rad(a)), cy - r * Math.cos(rad(a))];
  const large = a1 - a0 > 180 ? 1 : 0;
  const [x0, y0] = p(r1, a0), [x1, y1] = p(r1, a1), [x2, y2] = p(r0, a1), [x3, y3] = p(r0, a0);
  const f = (n) => n.toFixed(2);
  return `M${f(x0)} ${f(y0)} A${r1} ${r1} 0 ${large} 1 ${f(x1)} ${f(y1)} L${f(x2)} ${f(y2)} A${r0} ${r0} 0 ${large} 0 ${f(x3)} ${f(y3)} Z`;
}

/** セグメントの角度範囲を計算（純粋関数）。値0以下は除外。 */
export function segmentAngles(values) {
  const total = values.reduce((a, v) => a + Math.max(0, v), 0);
  if (!total) return [];
  let acc = 0;
  return values.map((v) => {
    if (!(v > 0)) return null;
    const a0 = (acc / total) * 360;
    acc += v;
    return { a0, a1: (acc / total) * 360, ratio: v / total };
  });
}

/**
 * ドーナツチャート
 * @param {{label:string,value:number,color:string}[]} segs
 * @param {{center?:string, sub?:string, label:string}} opt
 */
export function donut(segs, { center = '', sub = '', label = '円グラフ' } = {}) {
  const S = 200, c = S / 2, r1 = 90, r0 = 58;
  const ang = segmentAngles(segs.map((s) => s.value));
  const root = svg('svg', { viewBox: `0 0 ${S} ${S}`, class: 'chart donut', role: 'img', 'aria-label': label });
  if (!ang.length) {
    root.append(svg('circle', { cx: c, cy: c, r: (r0 + r1) / 2, fill: 'none', stroke: 'var(--beige)', 'stroke-width': r1 - r0 }));
  } else if (ang.filter(Boolean).length === 1) {
    const i = ang.findIndex(Boolean);
    root.append(svg('circle', { cx: c, cy: c, r: (r0 + r1) / 2, fill: 'none', stroke: segs[i].color, 'stroke-width': r1 - r0 }));
  } else {
    segs.forEach((s, i) => {
      const a = ang[i];
      if (!a) return;
      root.append(svg('path', { d: arcPath(c, c, r0, r1, a.a0, a.a1 - 0.4), fill: s.color }));
    });
  }
  root.append(
    svg('text', { x: c, y: c - 2, 'text-anchor': 'middle', class: 'donut-center' }, center),
    svg('text', { x: c, y: c + 18, 'text-anchor': 'middle', class: 'donut-sub' }, sub));
  return root;
}

/**
 * 月別の棒グラフ（収入/支出 2本）
 * @param {{label:string, income:number, expense:number}[]} data
 */
export function barChart(data, { label = '月別収支' } = {}) {
  const W = 360, H = 190, padL = 6, padB = 26, padT = 10;
  const max = Math.max(1, ...data.flatMap((d) => [d.income, d.expense]));
  const slot = (W - padL * 2) / Math.max(1, data.length);
  const bw = Math.min(22, slot / 2 - 3);
  const ch = H - padB - padT;
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart bars', role: 'img', 'aria-label': label });
  root.append(svg('line', { x1: padL, x2: W - padL, y1: H - padB, y2: H - padB, class: 'axis' }));
  data.forEach((d, i) => {
    const x = padL + slot * i + slot / 2;
    const hi = Math.round((d.income / max) * ch), he = Math.round((d.expense / max) * ch);
    root.append(
      svg('rect', { x: x - bw - 1, y: H - padB - hi, width: bw, height: hi, rx: 3, class: 'bar-income' }),
      svg('rect', { x: x + 1, y: H - padB - he, width: bw, height: he, rx: 3, class: 'bar-expense' }),
      svg('text', { x, y: H - 8, 'text-anchor': 'middle', class: 'axis-label' }, d.label));
  });
  return root;
}
