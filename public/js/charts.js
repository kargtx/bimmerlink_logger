import uPlot from '/vendor/uplot/uPlot.esm.js';
import { fmtNum, fmtTime, h } from './dom.js';

export const PALETTE = [
  '#ff7b1c',
  '#5cc8ff',
  '#7fd99a',
  '#f2c94c',
  '#c792ea',
  '#ff5c7a',
  '#4fd1c5',
  '#e6a0c4',
  '#b0bec5'
];

const AXIS = '#95a3b4';
const GRID = 'rgba(53, 68, 87, 0.9)';
const BG = '#18212c';
const stepped = uPlot.paths.stepped({ align: 1 });

function axisX() {
  return {
    stroke: AXIS,
    grid: { stroke: GRID, width: 1 },
    ticks: { stroke: GRID, width: 1 },
    values: (_u, splits) => splits.map((v) => fmtTime(v, false)),
    font: '12px "Golos Text", sans-serif'
  };
}

function axisY(scale, side, label, showGrid) {
  return {
    scale,
    side,
    label,
    labelSize: 18,
    labelFont: '12px "Golos Text", sans-serif',
    size: 58,
    stroke: AXIS,
    grid: { show: showGrid, stroke: GRID, width: 1 },
    ticks: { stroke: GRID, width: 1 },
    values: (_u, splits) => splits.map(fmtNum),
    font: '12px "Fira Sans Condensed", sans-serif'
  };
}

/** Строит таблицу uPlot: основной лог + (необязательно) сравниваемый, по общей оси времени. */
function buildTable(time, lines, compare) {
  const base = [time, ...lines.map((l) => l.values)];
  if (!compare || !compare.lines.length) return base;
  const other = [compare.time, ...compare.lines.map((l) => l.values)];
  return uPlot.join([base, other]);
}

function attachTouch(u, ctl) {
  const over = u.over;
  let start = null;
  const span = () => u.scales.x.max - u.scales.x.min;

  over.addEventListener(
    'touchstart',
    (e) => {
      const rect = over.getBoundingClientRect();
      const xs = [...e.touches].map((t) => t.clientX - rect.left);
      start = {
        xs,
        ys: [...e.touches].map((t) => t.clientY),
        min: u.scales.x.min,
        span: span(),
        w: rect.width
      };
    },
    { passive: true }
  );

  over.addEventListener(
    'touchmove',
    (e) => {
      if (!start) return;
      const rect = over.getBoundingClientRect();
      const xs = [...e.touches].map((t) => t.clientX - rect.left);
      const [fullMin, fullMax] = ctl.full;
      let min;
      let max;
      if (xs.length >= 2 && start.xs.length >= 2) {
        const d1 = start.min + (start.xs[0] / start.w) * start.span;
        const d2 = start.min + (start.xs[1] / start.w) * start.span;
        const dp = (xs[1] - xs[0]) / start.w;
        if (Math.abs(dp) < 0.02) return;
        const newSpan = Math.min(fullMax - fullMin, Math.max(0.5, (d2 - d1) / dp));
        min = d1 - (xs[0] / start.w) * newSpan;
        max = min + newSpan;
      } else if (xs.length === 1 && start.xs.length === 1) {
        const dx = xs[0] - start.xs[0];
        const dy = e.touches[0].clientY - start.ys[0];
        if (Math.abs(dx) < Math.abs(dy) || start.span >= fullMax - fullMin - 1e-9) return;
        min = start.min - (dx / start.w) * start.span;
        max = min + start.span;
      } else return;
      e.preventDefault();
      if (min < fullMin) [min, max] = [fullMin, fullMin + (max - min)];
      if (max > fullMax) [min, max] = [fullMax - (max - min), fullMax];
      u.setScale('x', { min: Math.max(fullMin, min), max });
    },
    { passive: false }
  );

  over.addEventListener('touchend', () => (start = null), { passive: true });
}

/**
 * @param {HTMLElement} container
 * @param {object} o
 *   mode: 'together' | 'separate' | 'normalized'
 *   time: number[]; lines: [{ ch, values, color }]
 *   compare: null | { label, time, lines: [{ ch, values, color }] }
 *   full: [min, max]  — границы всего заезда
 *   view: [from, to] | null
 *   onRange(from, to), onReset()
 */
export function createCharts(container, o) {
  container.replaceChildren();
  const plots = [];
  const ctl = { full: o.full };
  let silent = false;

  const syncKey = 'bl-' + Math.random().toString(36).slice(2);
  const isNarrow = () => container.clientWidth < 600;
  const width = () => Math.max(280, container.clientWidth - 14);

  function baseOpts(heightPx, legendTitle) {
    return {
      width: width(),
      height: heightPx,
      padding: [10, 8, 0, 0],
      cursor: {
        sync: { key: syncKey, setSeries: true },
        drag: { x: true, y: false, setScale: true },
        points: { size: 7 },
        bind: {
          dblclick: () => () => {
            o.onReset();
            return null;
          }
        }
      },
      legend: { live: true },
      scales: { x: { time: false } },
      hooks: {
        setScale: [
          (u, key) => {
            if (key !== 'x' || silent) return;
            const { min, max } = u.scales.x;
            silent = true;
            for (const p of plots) if (p !== u) p.setScale('x', { min, max });
            silent = false;
            o.onRange(min, max);
          }
        ]
      },
      series: [{ label: legendTitle || 'Время', value: (_u, v) => (v === null ? '—' : fmtTime(v)) }]
    };
  }

  function seriesOpts(line, { scale, compare = false, raw = null, unit = '' }) {
    const u = unit || line.ch.unit || '';
    return {
      label: compare ? `${line.ch.name} · ${o.compare.label}` : line.ch.name,
      scale,
      stroke: compare ? line.color + 'aa' : line.color,
      width: compare ? 1.25 : 1.75,
      dash: compare ? [6, 4] : undefined,
      paths: stepped,
      spanGaps: true,
      points: { show: false },
      value: (_u, v, _si, idx) => {
        const shown = raw && idx !== null && idx !== undefined ? raw[idx] : v;
        return shown === null || shown === undefined ? '—' : `${fmtNum(shown)} ${u}`.trim();
      }
    };
  }

  function addPlot(opts, data, title) {
    const card = h('div', { class: 'chart-card' }, title ? h('h3', {}, title) : null);
    container.append(card);
    const u = new uPlot(opts, data, card);
    attachTouch(u, ctl);
    plots.push(u);
    return u;
  }

  const { lines, compare } = o;
  const cmpLines = compare ? compare.lines : [];
  const table = buildTable(o.time, lines, compare);

  if (o.mode === 'separate') {
    lines.forEach((line) => {
      const cmp = cmpLines.find((c) => c.ch.sourceName === line.ch.sourceName);
      const t = buildTable(o.time, [line], cmp ? { ...compare, lines: [cmp] } : null);
      const opts = baseOpts(isNarrow() ? 150 : 180);
      opts.scales.y = {};
      opts.axes = [axisX(), axisY('y', 3, line.ch.unit, true)];
      opts.series.push(seriesOpts(line, { scale: 'y' }));
      if (cmp) opts.series.push(seriesOpts(cmp, { scale: 'y', compare: true }));
      addPlot(opts, t, null);
    });
  } else if (o.mode === 'normalized') {
    const all = [...lines, ...cmpLines];
    const raws = table.slice(1);
    const data = [table[0]];
    raws.forEach((col, k) => {
      const ch = all[k].ch;
      const lo = ch.min ?? 0;
      const range = (ch.max ?? 1) - lo || 1;
      data.push(col.map((v) => (v === null || v === undefined ? null : ((v - lo) / range) * 100)));
    });
    const opts = baseOpts(isNarrow() ? 300 : 380);
    opts.scales.pct = { range: [-2, 102] };
    opts.axes = [
      axisX(),
      { ...axisY('pct', 3, '% от диапазона', true), values: (_u, s) => s.map((v) => `${v}%`) }
    ];
    lines.forEach((l, k) => opts.series.push(seriesOpts(l, { scale: 'pct', raw: raws[k] })));
    cmpLines.forEach((l, k) =>
      opts.series.push(seriesOpts(l, { scale: 'pct', compare: true, raw: raws[lines.length + k] }))
    );
    addPlot(opts, data, null);
  } else {
    const units = [...new Set(lines.map((l) => l.ch.unit || '—'))];
    const opts = baseOpts(isNarrow() ? 300 : 380);
    opts.axes = [axisX()];
    units.forEach((unit, i) => {
      opts.scales[`u${i}`] = {};
      opts.axes.push(axisY(`u${i}`, i % 2 === 0 ? 3 : 1, unit === '—' ? '' : unit, i === 0));
    });
    const scaleOf = (l) => `u${units.indexOf(l.ch.unit || '—')}`;
    lines.forEach((l) => opts.series.push(seriesOpts(l, { scale: scaleOf(l) })));
    cmpLines.forEach((l) => opts.series.push(seriesOpts(l, { scale: scaleOf(l), compare: true })));
    addPlot(opts, table, null);
  }

  if (o.view) {
    silent = true;
    for (const p of plots) p.setScale('x', { min: o.view[0], max: o.view[1] });
    silent = false;
  }

  const ro = new ResizeObserver(() => {
    const w = width();
    for (const p of plots) if (Math.abs(p.width - w) > 2) p.setSize({ width: w, height: p.height });
  });
  ro.observe(container);

  return {
    plots,
    setView(from, to) {
      silent = true;
      for (const p of plots) p.setScale('x', { min: from, max: to });
      silent = false;
    },
    destroy() {
      ro.disconnect();
      for (const p of plots) p.destroy();
      container.replaceChildren();
    },
    /** Склеивает все графики в одну картинку с заголовком и легендой. */
    toCanvas(title, subtitle) {
      const r = window.devicePixelRatio || 1;
      const canvases = plots.map((p) => p.ctx.canvas);
      const legend = plots.flatMap((p) =>
        p.series.slice(1).map((s) => ({ label: s.label, color: s._stroke || s.stroke }))
      );
      const w = Math.max(...canvases.map((c) => c.width));
      const head = 64 * r;
      const legendH = Math.ceil(legend.length / 3) * 22 * r + 16 * r;
      const out = document.createElement('canvas');
      out.width = w;
      out.height = head + canvases.reduce((s, c) => s + c.height + 8 * r, 0) + legendH;
      const ctx = out.getContext('2d');
      ctx.fillStyle = BG;
      ctx.fillRect(0, 0, out.width, out.height);
      ctx.fillStyle = '#f1ede4';
      ctx.font = `600 ${22 * r}px "Fira Sans Condensed", sans-serif`;
      ctx.fillText(title, 16 * r, 30 * r);
      ctx.fillStyle = AXIS;
      ctx.font = `${13 * r}px "Golos Text", sans-serif`;
      ctx.fillText(subtitle, 16 * r, 52 * r);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#ff7b1c';
      ctx.fillText('BMW102 · Bimmerlink Logger', w - 16 * r, 30 * r);
      ctx.textAlign = 'left';
      let y = head;
      for (const c of canvases) {
        ctx.drawImage(c, 0, y);
        y += c.height + 8 * r;
      }
      legend.forEach((item, i) => {
        const col = i % 3;
        const row = Math.floor(i / 3);
        const x = 16 * r + col * (w / 3);
        const ly = y + 8 * r + row * 22 * r;
        ctx.fillStyle = typeof item.color === 'string' ? item.color : AXIS;
        ctx.fillRect(x, ly, 14 * r, 4 * r);
        ctx.fillStyle = '#f1ede4';
        ctx.fillText(String(item.label), x + 20 * r, ly + 6 * r);
      });
      return out;
    }
  };
}
