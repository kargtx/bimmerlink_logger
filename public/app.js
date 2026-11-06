import { api } from './js/api.js';
import { createCharts, PALETTE } from './js/charts.js';
import { $, h, clear, fmtNum, fmtTime, fmtDuration, fmtDate, toast, debounce } from './js/dom.js';

const GROUPS = {
  engine: 'Двигатель',
  pressure: 'Давления',
  temp: 'Температуры',
  motion: 'Движение',
  mixture: 'Смесь',
  misfire: 'Пропуски зажигания',
  other: 'Прочее'
};
const DEFAULT_CHANNELS = ['Engine speed', 'Boost pressure', 'Vehicle speed'];
const POINTS = 4000;

const state = {
  logs: [],
  presets: [],
  log: null,
  selected: [], // sourceName в порядке выбора
  mode: 'together',
  view: null, // [from, to] или null — весь заезд
  compareId: null,
  compareLog: null,
  data: null, // { key, time, byIdx: Map }
  compareData: null,
  charts: null,
  eventsExpanded: false
};

// ---------------- URL ----------------
function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  const num = (k) => (p.has(k) && p.get(k) !== '' ? Number(p.get(k)) : null);
  return {
    log: num('log'),
    ch: p.get('ch') ? p.get('ch').split(',').map(Number) : null,
    mode: p.get('mode'),
    from: num('from'),
    to: num('to'),
    cmp: num('cmp')
  };
}

function writeHash() {
  if (!state.log) {
    history.replaceState(null, '', location.pathname);
    return;
  }
  const p = new URLSearchParams({ log: String(state.log.id) });
  const idx = selectedChannels().map((c) => c.idx);
  if (idx.length) p.set('ch', idx.join(','));
  if (state.mode !== 'together') p.set('mode', state.mode);
  if (state.view) {
    p.set('from', state.view[0].toFixed(2));
    p.set('to', state.view[1].toFixed(2));
  }
  if (state.compareId) p.set('cmp', String(state.compareId));
  history.replaceState(null, '', `#${p}`);
}

// ---------------- Архив ----------------
async function loadArchive() {
  state.logs = await api.listLogs();
  renderArchive();
  renderCompareSelect();
}

function renderArchive() {
  const q = $('archiveSearch').value.trim().toLowerCase();
  const sort = $('archiveSort').value;
  const list = state.logs.filter(
    (l) => !q || l.name.toLowerCase().includes(q) || l.filename.toLowerCase().includes(q)
  );
  const key = {
    recorded: (l) => l.recordedAt || l.uploadedAt,
    uploaded: (l) => l.uploadedAt
  }[sort];
  list.sort((a, b) => {
    if (sort === 'name') return a.name.localeCompare(b.name, 'ru');
    if (sort === 'duration') return b.duration - a.duration;
    return String(key(b)).localeCompare(String(key(a)));
  });

  $('archiveCount').textContent = state.logs.length
    ? `Заездов: ${state.logs.length}${q ? `, найдено: ${list.length}` : ''}`
    : 'Архив пуст — загрузите первый лог.';

  clear($('archiveList')).append(
    ...list.map((l) =>
      h(
        'li',
        {},
        h(
          'button',
          {
            class: 'archive-item',
            type: 'button',
            'aria-current': state.log && state.log.id === l.id ? 'true' : 'false',
            onclick: () => {
              closeArchive();
              openLog(l.id);
            }
          },
          h('strong', {}, l.name),
          h('span', {}, `${fmtDate(l.recordedAt || l.uploadedAt)}, ${fmtDuration(l.duration)}`)
        )
      )
    )
  );
}

function openArchive() {
  $('archive').classList.add('is-open');
  $('scrim').hidden = false;
  $('archiveToggle').setAttribute('aria-expanded', 'true');
}
function closeArchive() {
  $('archive').classList.remove('is-open');
  $('scrim').hidden = true;
  $('archiveToggle').setAttribute('aria-expanded', 'false');
}

// ---------------- Загрузка ----------------
async function uploadFile(file) {
  if (!file) return;
  if (!/\.csv$/i.test(file.name) && file.type !== 'text/csv') {
    toast('Нужен CSV-файл, записанный в BimmerLink.', true);
    return;
  }
  toast(`Загружаю ${file.name}…`);
  try {
    const log = await api.uploadLog(file, $('uploadName').value);
    $('uploadName').value = '';
    toast(`Загружено: ${log.name}`);
    await loadArchive();
    closeArchive();
    await openLog(log.id);
  } catch (err) {
    toast(err.message, true);
  }
}

// ---------------- Открытие лога ----------------
function channelBySource(log, name) {
  return log.channels.find((c) => c.sourceName === name);
}

function selectedChannels() {
  if (!state.log) return [];
  return state.selected.map((n) => channelBySource(state.log, n)).filter(Boolean);
}

function colorOf(sourceName) {
  const i = state.selected.indexOf(sourceName);
  return PALETTE[(i < 0 ? 0 : i) % PALETTE.length];
}

async function openLog(id, fromHash = null) {
  try {
    const log = await api.getLog(id);
    const previous = state.selected;
    state.log = log;
    state.data = null;
    state.view = null;
    state.eventsExpanded = false;

    if (fromHash && fromHash.ch) {
      state.selected = fromHash.ch
        .map((i) => log.channels[i])
        .filter(Boolean)
        .map((c) => c.sourceName);
    } else {
      const keep = previous.filter((n) => channelBySource(log, n));
      state.selected = keep.length
        ? keep
        : DEFAULT_CHANNELS.filter((n) => channelBySource(log, n) && !channelBySource(log, n).allZero);
      if (!state.selected.length) {
        state.selected = log.channels
          .filter((c) => !c.allZero)
          .slice(0, 2)
          .map((c) => c.sourceName);
      }
    }
    if (fromHash) {
      if (['together', 'separate', 'normalized'].includes(fromHash.mode)) state.mode = fromHash.mode;
      if (fromHash.from !== null && fromHash.to !== null && fromHash.to > fromHash.from) {
        state.view = [fromHash.from, fromHash.to];
      }
    }
    document.querySelector(`input[name="mode"][value="${state.mode}"]`).checked = true;

    const cmp = fromHash ? fromHash.cmp : state.compareId;
    state.compareId = cmp && cmp !== id ? cmp : null;
    state.compareLog = null;
    state.compareData = null;
    if (state.compareId) {
      try {
        state.compareLog = await api.getLog(state.compareId);
      } catch {
        state.compareId = null;
      }
    }

    $('emptyState').hidden = true;
    $('logView').hidden = false;
    renderHead();
    renderArchive();
    renderCompareSelect();
    renderChannels();
    renderStats();
    renderEvents();
    await refreshChart();
  } catch (err) {
    toast(err.message, true);
  }
}

function renderHead() {
  const log = state.log;
  $('logTitle').textContent = log.name;
  document.title = `${log.name} · Bimmerlink Logger · BMW102`;
  const meta = $('logMeta');
  clear(meta).append(
    log.recordedAt ? h('span', {}, 'Записан ', h('b', {}, fmtDate(log.recordedAt)), ', ') : '',
    'длительность ',
    h('b', {}, fmtDuration(log.duration)),
    `, ${log.rowCount} строк, ${log.channels.length} параметров, файл ${log.filename}`
  );
  $('logNotes').value = log.notes || '';
  $('rawLink').href = api.rawUrl(log.id);
  $('rawLink').setAttribute('download', log.filename);
  const w = $('logWarnings');
  w.hidden = !log.warnings.length;
  w.textContent = log.warnings.join(' ');
}

// ---------------- Параметры ----------------
function renderChannels() {
  const log = state.log;
  const byGroup = new Map();
  for (const ch of log.channels) {
    if (!byGroup.has(ch.group)) byGroup.set(ch.group, []);
    byGroup.get(ch.group).push(ch);
  }
  const order = Object.keys(GROUPS);
  const groups = [...byGroup.keys()].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  $('channelsCount').textContent = `· выбрано ${state.selected.length} из ${log.channels.length}`;

  clear($('channelGroups')).append(
    ...groups.map((g) =>
      h(
        'div',
        { class: 'channel-group' },
        h('h3', {}, GROUPS[g] || g),
        h(
          'div',
          { class: 'chips' },
          ...byGroup.get(g).map((ch) => {
            const on = state.selected.includes(ch.sourceName);
            return h(
              'button',
              {
                class: `chip${ch.allZero || ch.validCount === 0 ? ' is-dull' : ''}`,
                type: 'button',
                'aria-pressed': on ? 'true' : 'false',
                '--c': on ? colorOf(ch.sourceName) : undefined,
                title: ch.sourceName,
                onclick: () => toggleChannel(ch.sourceName)
              },
              ch.name,
              ch.allZero && ch.validCount ? h('small', {}, 'всегда 0') : null,
              ch.validCount === 0 ? h('small', {}, 'нет данных') : null
            );
          })
        )
      )
    )
  );
}

function toggleChannel(name) {
  const i = state.selected.indexOf(name);
  if (i >= 0) state.selected.splice(i, 1);
  else state.selected.push(name);
  $('presetSelect').value = '';
  $('presetDeleteBtn').hidden = true;
  renderChannels();
  refreshChart();
}

// ---------------- Пики ----------------
function renderPeaks() {
  const chs = selectedChannels();
  clear($('peaks')).append(
    ...chs.map((ch) =>
      h(
        'button',
        {
          class: 'peak',
          type: 'button',
          '--c': colorOf(ch.sourceName),
          title: 'Показать момент максимума на графике',
          onclick: () => ch.maxT !== null && focusAround(ch.maxT)
        },
        h(
          'span',
          {},
          h('span', { class: 'peak-value' }, fmtNum(ch.max)),
          h('span', { class: 'peak-unit' }, ch.unit)
        ),
        h('span', { class: 'peak-name' }, `${ch.name}, максимум`),
        h('span', { class: 'peak-time' }, ch.maxT !== null ? `на ${fmtTime(ch.maxT)}` : 'нет данных')
      )
    )
  );
  $('peaks').hidden = !chs.length;
}

// ---------------- График ----------------
function fullRange() {
  return [0, Math.max(state.log.duration, 0.1)];
}

async function fetchMain(chs) {
  const log = state.log;
  const idx = chs.map((c) => c.idx);
  // Если лог длиннее POINTS строк, при приближении догружаем отрезок в полном разрешении
  const needRange = log.rowCount > POINTS && state.view;
  const key = `${log.id}|${idx.join(',')}|${needRange ? state.view.map((v) => v.toFixed(1)).join('-') : 'all'}`;
  if (state.data && state.data.key === key) return state.data;
  const opts = needRange ? { from: state.view[0], to: state.view[1], points: POINTS } : { points: POINTS };
  const res = await api.getData(log.id, idx, opts);
  const byIdx = new Map(res.channels.map((c, k) => [c, res.series[k]]));
  state.data = { key, time: res.time, byIdx, downsampled: res.downsampled };
  return state.data;
}

async function fetchCompare(chs) {
  if (!state.compareLog) return null;
  const pairs = chs
    .map((ch) => ({ ch, other: channelBySource(state.compareLog, ch.sourceName) }))
    .filter((p) => p.other);
  if (!pairs.length) return null;
  const idx = pairs.map((p) => p.other.idx);
  const key = `${state.compareLog.id}|${idx.join(',')}`;
  if (!state.compareData || state.compareData.key !== key) {
    const res = await api.getData(state.compareLog.id, idx, { points: POINTS });
    state.compareData = { key, res };
  }
  const { res } = state.compareData;
  return {
    label: state.compareLog.name,
    time: res.time,
    lines: pairs.map((p) => ({
      ch: p.other,
      values: res.series[res.channels.indexOf(p.other.idx)],
      color: colorOf(p.ch.sourceName)
    }))
  };
}

let chartToken = 0;
async function refreshChart() {
  if (!state.log) return;
  renderPeaks();
  writeHash();
  const chs = selectedChannels();
  const box = $('charts');
  if (!chs.length) {
    state.charts?.destroy();
    state.charts = null;
    clear(box).append(h('p', { class: 'muted' }, 'Выберите хотя бы один параметр выше.'));
    $('chartStatus').textContent = '';
    return;
  }
  const token = ++chartToken;
  $('chartStatus').textContent = 'Загружаю данные…';
  try {
    const [data, compare] = await Promise.all([fetchMain(chs), fetchCompare(chs)]);
    if (token !== chartToken) return;
    state.charts?.destroy();
    state.charts = createCharts(box, {
      mode: state.mode,
      time: data.time,
      lines: chs.map((ch) => ({ ch, values: data.byIdx.get(ch.idx), color: colorOf(ch.sourceName) })),
      compare,
      full: fullRange(),
      view: state.view,
      onRange: (from, to) => onChartRange(from, to),
      onReset: () => setView(null)
    });
    const notes = [];
    if (data.downsampled)
      notes.push('Показана упрощённая кривая: приблизьте участок, чтобы увидеть все точки.');
    if (state.compareLog && !compare) notes.push('В сравниваемом заезде нет выбранных параметров.');
    $('chartStatus').textContent = notes.join(' ');
  } catch (err) {
    if (token === chartToken) $('chartStatus').textContent = err.message;
  }
  updateRangeControls();
}

const refetchForView = debounce(() => {
  if (state.log && state.log.rowCount > POINTS) refreshChart();
}, 400);

function onChartRange(from, to) {
  const [lo, hi] = fullRange();
  const isFull = from <= lo + 1e-6 && to >= hi - 1e-6;
  state.view = isFull ? null : [Math.max(lo, from), Math.min(hi, to)];
  updateRangeControls();
  writeHash();
  refetchForView();
}

function setView(view) {
  const [lo, hi] = fullRange();
  if (view) {
    let [a, b] = view;
    if (b - a < 1) [a, b] = [a - 0.5, b + 0.5];
    view = [Math.max(lo, a), Math.min(hi, b)];
  }
  state.view = view;
  if (state.charts) state.charts.setView(...(view || [lo, hi]));
  updateRangeControls();
  writeHash();
  refetchForView();
}

function focusAround(t, pad = 8) {
  setView([t - pad, t + pad]);
  $('charts').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function updateRangeControls() {
  if (!state.log) return;
  const [lo, hi] = fullRange();
  const [a, b] = state.view || [lo, hi];
  const toPos = (t) => Math.round(((t - lo) / (hi - lo)) * 1000);
  $('rangeFrom').value = String(toPos(a));
  $('rangeTo').value = String(toPos(b));
  $('rangeLabel').textContent = `${fmtTime(a)} — ${fmtTime(b)} (${fmtDuration(b - a)})`;
  $('rangeReset').hidden = !state.view;
}

function onSlider() {
  const [lo, hi] = fullRange();
  let a = Number($('rangeFrom').value);
  let b = Number($('rangeTo').value);
  if (a > b - 5) {
    if (this === $('rangeFrom')) a = b - 5;
    else b = a + 5;
  }
  const t = (p) => lo + (p / 1000) * (hi - lo);
  setView(a <= 0 && b >= 1000 ? null : [t(a), t(b)]);
}

// ---------------- Статистика и события ----------------
function renderStats() {
  const body = $('statsTable').tBodies[0];
  clear(body).append(
    ...state.log.channels.map((ch) =>
      h(
        'tr',
        { class: ch.allZero || ch.validCount === 0 ? 'is-dull' : '' },
        h('td', {}, ch.name, ch.unit ? h('span', { class: 'unit' }, ` ${ch.unit}`) : null),
        h('td', {}, fmtNum(ch.min)),
        h('td', {}, fmtNum(ch.avg)),
        h('td', {}, fmtNum(ch.max)),
        h(
          'td',
          {},
          ch.maxT !== null && !ch.constant
            ? h(
                'button',
                {
                  type: 'button',
                  title: 'Показать на графике',
                  onclick: () => {
                    if (!state.selected.includes(ch.sourceName)) {
                      state.selected.push(ch.sourceName);
                      renderChannels();
                      refreshChart().then(() => focusAround(ch.maxT));
                    } else focusAround(ch.maxT);
                  }
                },
                fmtTime(ch.maxT)
              )
            : '—'
        )
      )
    )
  );
}

function renderEvents() {
  const events = state.log.events;
  const list = clear($('eventsList'));
  if (!events.length) {
    list.append(
      h(
        'li',
        { class: 'muted' },
        'Разгонов и выходов за пороги не найдено. Разгоны ищутся по каналу «Скорость»: 0–100, 60–100, 80–120 и 100–200 км/ч.'
      )
    );
    return;
  }
  const LIMIT = 8;
  const shown = state.eventsExpanded ? events : events.slice(0, LIMIT);
  list.append(
    ...shown.map((e) =>
      h(
        'li',
        {},
        h(
          'button',
          {
            class: `event${e.kind === 'alarm' ? ' is-alarm' : ''}`,
            type: 'button',
            onclick: () => setView([e.from - 3, e.to + 3])
          },
          h('b', {}, e.kind === 'sprint' ? `Разгон ${e.label}` : e.label),
          h('span', { class: 'event-value' }, e.kind === 'sprint' ? `${fmtNum(e.value)} с` : fmtNum(e.value)),
          h(
            'small',
            {},
            `${fmtTime(e.from)} — ${fmtTime(e.to)}${e.kind === 'sprint' ? ', точность ±1–2 с' : ', пик'}`
          )
        )
      )
    )
  );
  if (events.length > LIMIT) {
    list.append(
      h(
        'li',
        {},
        h(
          'button',
          {
            class: 'btn btn-quiet events-more',
            type: 'button',
            onclick: () => {
              state.eventsExpanded = !state.eventsExpanded;
              renderEvents();
            }
          },
          state.eventsExpanded ? 'Свернуть' : `Показать все (${events.length})`
        )
      )
    );
  }
}

// ---------------- Пресеты ----------------
async function loadPresets() {
  await migrateLocalPresets();
  state.presets = await api.listPresets();
  renderPresetSelect();
}

/** Перенос пресетов из localStorage (старая версия) на сервер — один раз. */
async function migrateLocalPresets() {
  let local;
  try {
    local = JSON.parse(localStorage.getItem('bimmerlink_presets') || 'null');
  } catch {
    local = null;
  }
  if (!local || typeof local !== 'object') return;
  try {
    for (const [slot, names] of Object.entries(local)) {
      if (Array.isArray(names) && names.length) await api.createPreset(`Пресет ${slot}`, names);
    }
    localStorage.removeItem('bimmerlink_presets');
  } catch {
    // попробуем в следующий раз
  }
}

function renderPresetSelect() {
  const sel = $('presetSelect');
  const current = sel.value;
  clear(sel).append(
    h('option', { value: '' }, state.presets.length ? 'Пресеты…' : 'Пресетов пока нет'),
    ...state.presets.map((p) => h('option', { value: String(p.id) }, `${p.name} (${p.channels.length})`))
  );
  sel.value = state.presets.some((p) => String(p.id) === current) ? current : '';
  $('presetDeleteBtn').hidden = !sel.value;
}

function applyPreset() {
  const preset = state.presets.find((p) => String(p.id) === $('presetSelect').value);
  $('presetDeleteBtn').hidden = !preset;
  if (!preset || !state.log) return;
  const available = preset.channels.filter((n) => channelBySource(state.log, n));
  if (!available.length) {
    toast(`В этом заезде нет параметров из пресета «${preset.name}».`, true);
    return;
  }
  state.selected = available;
  renderChannels();
  refreshChart();
  if (available.length < preset.channels.length) {
    toast(`Пресет «${preset.name}»: найдено ${available.length} из ${preset.channels.length} параметров.`);
  }
}

// ---------------- Сравнение ----------------
function renderCompareSelect() {
  const sel = $('compareSelect');
  const others = state.logs.filter((l) => !state.log || l.id !== state.log.id);
  clear(sel).append(
    h('option', { value: '' }, others.length ? 'Сравнить с…' : 'Нет других заездов для сравнения'),
    ...others.map((l) => h('option', { value: String(l.id) }, `${l.name}, ${fmtDuration(l.duration)}`))
  );
  sel.value = state.compareId ? String(state.compareId) : '';
}

async function onCompareChange() {
  const id = Number($('compareSelect').value) || null;
  state.compareId = id;
  state.compareLog = null;
  state.compareData = null;
  if (id) {
    try {
      state.compareLog = await api.getLog(id);
    } catch (err) {
      toast(err.message, true);
      state.compareId = null;
    }
  }
  refreshChart();
}

// ---------------- Действия с логом ----------------
async function saveTitle() {
  const el = $('logTitle');
  const name = el.textContent.trim();
  if (!state.log || name === state.log.name) return;
  if (!name) {
    el.textContent = state.log.name;
    return;
  }
  try {
    const updated = await api.updateLog(state.log.id, { name });
    state.log.name = updated.name;
    toast('Название сохранено.');
    await loadArchive();
    renderHead();
  } catch (err) {
    toast(err.message, true);
    el.textContent = state.log.name;
  }
}

const saveNotes = debounce(async () => {
  if (!state.log) return;
  try {
    await api.updateLog(state.log.id, { notes: $('logNotes').value });
    state.log.notes = $('logNotes').value;
  } catch (err) {
    toast(err.message, true);
  }
}, 800);

async function deleteCurrent() {
  if (!state.log) return;
  if (!confirm(`Удалить заезд «${state.log.name}»? Исходный CSV тоже будет удалён.`)) return;
  try {
    await api.deleteLog(state.log.id);
    toast('Заезд удалён.');
    state.charts?.destroy();
    Object.assign(state, {
      log: null,
      charts: null,
      data: null,
      view: null,
      compareId: null,
      compareLog: null
    });
    $('logView').hidden = true;
    $('emptyState').hidden = false;
    writeHash();
    await loadArchive();
  } catch (err) {
    toast(err.message, true);
  }
}

function exportPng() {
  if (!state.charts) return;
  const sub = [
    state.log.recordedAt ? fmtDate(state.log.recordedAt) : '',
    state.view
      ? `${fmtTime(state.view[0])} — ${fmtTime(state.view[1])}`
      : `весь заезд, ${fmtDuration(state.log.duration)}`
  ]
    .filter(Boolean)
    .join(', ');
  const canvas = state.charts.toCanvas(state.log.name, sub);
  canvas.toBlob((blob) => {
    const a = h('a', { href: URL.createObjectURL(blob), download: `${state.log.name}.png` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
}

async function copyLink() {
  writeHash();
  try {
    await navigator.clipboard.writeText(location.href);
    toast('Ссылка на этот вид скопирована.');
  } catch {
    toast('Не удалось скопировать: скопируйте адрес из строки браузера.', true);
  }
}

// ---------------- Подписки ----------------
function bind() {
  $('fileInput').addEventListener('change', (e) => {
    uploadFile(e.target.files[0]);
    e.target.value = '';
  });
  const dz = $('dropzone');
  for (const target of [dz, document.body]) {
    target.addEventListener('dragover', (e) => {
      e.preventDefault();
      dz.classList.add('is-over');
    });
    target.addEventListener('dragleave', (e) => {
      if (e.target === target) dz.classList.remove('is-over');
    });
    target.addEventListener('drop', (e) => {
      e.preventDefault();
      dz.classList.remove('is-over');
      uploadFile(e.dataTransfer.files[0]);
    });
  }

  $('archiveSearch').addEventListener('input', renderArchive);
  $('archiveSort').addEventListener('change', renderArchive);
  $('archiveToggle').addEventListener('click', () =>
    $('archive').classList.contains('is-open') ? closeArchive() : openArchive()
  );
  $('scrim').addEventListener('click', closeArchive);
  document.addEventListener('keydown', (e) => e.key === 'Escape' && closeArchive());

  document.querySelectorAll('input[name="mode"]').forEach((r) =>
    r.addEventListener('change', () => {
      state.mode = r.value;
      refreshChart();
    })
  );

  $('rangeFrom').addEventListener('input', onSlider);
  $('rangeTo').addEventListener('input', onSlider);
  $('rangeReset').addEventListener('click', () => setView(null));

  const title = $('logTitle');
  title.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      title.blur();
    }
    if (e.key === 'Escape') {
      title.textContent = state.log.name;
      title.blur();
    }
  });
  title.addEventListener('blur', saveTitle);
  $('logNotes').addEventListener('input', saveNotes);
  $('deleteBtn').addEventListener('click', deleteCurrent);
  $('pngBtn').addEventListener('click', exportPng);
  $('copyLinkBtn').addEventListener('click', copyLink);

  $('presetSelect').addEventListener('change', applyPreset);
  $('presetSaveBtn').addEventListener('click', () => {
    if (!state.selected.length) {
      toast('Сначала выберите параметры.', true);
      return;
    }
    $('presetForm').hidden = false;
    $('presetName').focus();
  });
  $('presetCancel').addEventListener('click', () => ($('presetForm').hidden = true));
  $('presetForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const p = await api.createPreset($('presetName').value, state.selected);
      $('presetName').value = '';
      $('presetForm').hidden = true;
      state.presets = await api.listPresets();
      renderPresetSelect();
      $('presetSelect').value = String(p.id);
      $('presetDeleteBtn').hidden = false;
      toast(`Пресет «${p.name}» сохранён.`);
    } catch (err) {
      toast(err.message, true);
    }
  });
  $('presetDeleteBtn').addEventListener('click', async () => {
    const preset = state.presets.find((p) => String(p.id) === $('presetSelect').value);
    if (!preset || !confirm(`Удалить пресет «${preset.name}»?`)) return;
    try {
      await api.deletePreset(preset.id);
      state.presets = await api.listPresets();
      renderPresetSelect();
      toast('Пресет удалён.');
    } catch (err) {
      toast(err.message, true);
    }
  });

  $('compareSelect').addEventListener('change', onCompareChange);

  window.addEventListener('hashchange', () => {
    const hash = readHash();
    if (hash.log && (!state.log || hash.log !== state.log.id)) openLog(hash.log, hash);
  });
}

async function init() {
  bind();
  try {
    await Promise.all([loadArchive(), loadPresets()]);
  } catch (err) {
    toast(`Сервер недоступен: ${err.message}`, true);
    return;
  }
  const hash = readHash();
  if (hash.log) await openLog(hash.log, hash);
  else if (window.matchMedia('(max-width: 900px)').matches && !state.logs.length) openArchive();

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
}

init();
