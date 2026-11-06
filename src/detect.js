/**
 * Поиск событий в логе: разгоны по скорости и выходы параметров за пороги.
 * Значения в логе обновляются раз в ~2 с (круговой опрос), поэтому время
 * разгона оценивается интерполяцией между точками изменения: точность ±1–2 с.
 */
const SPRINTS = [
  [0, 100],
  [60, 100],
  [80, 120],
  [100, 200]
];

/** Точки, где значение реально изменилось (результат очередного опроса). */
function changePoints(time, values) {
  const pts = [];
  let prev;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v === null) continue;
    if (v !== prev) pts.push([time[i], v]);
    prev = v;
  }
  return pts;
}

function crossTime(a, b, level) {
  const [t0, v0] = a;
  const [t1, v1] = b;
  if (v1 === v0) return t1;
  return t0 + ((level - v0) / (v1 - v0)) * (t1 - t0);
}

function findSprints(time, speed) {
  const pts = changePoints(time, speed);
  const result = [];
  for (const [lo, hi] of SPRINTS) {
    let startT = null;
    let peak = -Infinity;
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1];
      const cur = pts[i];
      if (prev[1] <= lo && cur[1] > lo) {
        startT = lo === 0 ? prev[0] : crossTime(prev, cur, lo);
        peak = cur[1];
      } else if (startT !== null) {
        if (cur[1] < peak - 5) {
          startT = null; // сбросили газ — разгон прерван
          continue;
        }
        peak = Math.max(peak, cur[1]);
      }
      if (startT !== null && prev[1] < hi && cur[1] >= hi) {
        const endT = crossTime(prev, cur, hi);
        result.push({
          kind: 'sprint',
          label: `${lo}–${hi} км/ч`,
          from: startT,
          to: endT,
          value: Math.round((endT - startT) * 10) / 10
        });
        startT = null;
      }
    }
  }
  return result.sort((a, b) => a.from - b.from);
}

function findAlarms(time, channels, series) {
  const events = [];
  channels.forEach((ch) => {
    if (typeof ch.warn !== 'number') return;
    const values = series[ch.idx];
    let startT = null;
    let peak = -Infinity;
    for (let i = 0; i <= values.length; i++) {
      const v = i < values.length ? values[i] : null;
      if (v !== null && v > ch.warn) {
        if (startT === null) startT = time[i];
        peak = Math.max(peak, v);
      } else if (startT !== null) {
        events.push({
          kind: 'alarm',
          label: `${ch.name} > ${ch.warn} ${ch.unit}`,
          channel: ch.sourceName,
          from: startT,
          to: time[Math.min(i, time.length - 1)],
          value: peak
        });
        startT = null;
        peak = -Infinity;
      }
    }
  });
  return events;
}

function detectEvents(parsed) {
  const speedCh = parsed.channels.find((c) => /^vehicle speed$/i.test(c.sourceName));
  const sprints = speedCh ? findSprints(parsed.time, parsed.series[speedCh.idx]) : [];
  const alarms = findAlarms(parsed.time, parsed.channels, parsed.series);
  return [...sprints, ...alarms].sort((a, b) => a.from - b.from);
}

module.exports = { detectEvents, findSprints, findAlarms, changePoints };
