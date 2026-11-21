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

/** 折れ線（面付き）。X軸は日付に比例。points: [{date:'yyyy-MM-dd', value:number}] */
export function lineChart(points, { label = '推移', fmt = (v) => String(v), toDays } = {}) {
  const W = 360, H = 200, L = 8, R = 8, T = 22, B = 26;
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart line', role: 'img', 'aria-label': label });
  if (!points.length) return root;
  const xs = points.map((p) => toDays(p.date));
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const vs = points.map((p) => p.value);
  let lo = Math.min(...vs), hi = Math.max(...vs);
  if (lo === hi) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.1; lo -= pad; hi += pad;
  const X = (d) => (x1 === x0 ? (W - L - R) / 2 + L : L + ((d - x0) / (x1 - x0)) * (W - L - R));
  const Y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const pts = points.map((p, i) => [X(xs[i]), Y(p.value)]);
  const f = (n) => n.toFixed(1);
  root.append(svg('line', { x1: L, x2: W - R, y1: H - B, y2: H - B, class: 'axis' }));
  if (pts.length > 1) {
    root.append(
      svg('path', { d: `M${f(pts[0][0])} ${H - B} ` + pts.map((p) => `L${f(p[0])} ${f(p[1])}`).join(' ') + ` L${f(pts[pts.length - 1][0])} ${H - B} Z`, class: 'line-area' }),
      svg('polyline', { points: pts.map((p) => `${f(p[0])},${f(p[1])}`).join(' '), class: 'line-stroke', fill: 'none' }));
  }
  if (pts.length <= 24) pts.forEach((p) => root.append(svg('circle', { cx: f(p[0]), cy: f(p[1]), r: 3.5, class: 'line-dot' })));
  const iMax = vs.indexOf(Math.max(...vs)), iMin = vs.indexOf(Math.min(...vs));
  const tag = (i, dy) => svg('text', { x: Math.min(W - R - 2, Math.max(L + 2, pts[i][0])), y: pts[i][1] + dy, 'text-anchor': pts[i][0] > W * 0.7 ? 'end' : pts[i][0] < W * 0.3 ? 'start' : 'middle', class: 'axis-label strong' }, fmt(vs[i]));
  root.append(tag(iMax, -8));
  if (iMin !== iMax) root.append(tag(iMin, 16));
  const lbl = (s) => s.slice(2).replace(/-/g, '/');
  root.append(
    svg('text', { x: L, y: H - 8, class: 'axis-label' }, lbl(points[0].date)),
    svg('text', { x: W - R, y: H - 8, 'text-anchor': 'end', class: 'axis-label' }, lbl(points[points.length - 1].date)));
  return root;
}

/** リングゲージ（達成率）。pct は 0〜100 を超えてもよい（描画は100で頭打ち） */
export function ring(pct, { size = 84, label = '達成率', done = false } = {}) {
  const r = 34, C = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(100, pct));
  const root = svg('svg', { viewBox: '0 0 84 84', width: size, height: size, class: 'chart ring', role: 'img', 'aria-label': `${label} ${pct}%` });
  root.append(
    svg('circle', { cx: 42, cy: 42, r, fill: 'none', 'stroke-width': 9, class: 'ring-bg' }),
    svg('circle', { cx: 42, cy: 42, r, fill: 'none', 'stroke-width': 9, 'stroke-linecap': 'round', class: 'ring-fg' + (done ? ' done' : ''),
      'stroke-dasharray': `${(p / 100) * C} ${C}`, transform: 'rotate(-90 42 42)' }),
    svg('text', { x: 42, y: 47, 'text-anchor': 'middle', class: 'ring-text' }, `${pct}%`));
  return root;
}
