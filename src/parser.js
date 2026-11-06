const { parse } = require('csv-parse/sync');
const { describeChannel } = require('./channels');

const PARSER_VERSION = 2;

class CsvError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

function detectDelimiter(headerLine) {
  const candidates = [',', ';', '\t'];
  let best = ',';
  let bestCount = -1;
  for (const d of candidates) {
    const count = headerLine.split(d).length - 1;
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  return best;
}

/** Дата и время записи из имени файла BimmerLink: 2026-05-09_23-32-53.csv */
function recordedAtFromFilename(filename) {
  const m = String(filename || '').match(/(\d{4})-(\d{2})-(\d{2})[_ T](\d{2})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  // Локальное время телефона, часовой пояс неизвестен — храним без смещения
  return `${y}-${mo}-${d}T${h}:${mi}:${s}`;
}

function toNumber(raw, decimalComma) {
  if (raw === undefined || raw === null) return null;
  let s = String(raw).trim();
  if (s === '') return null;
  if (decimalComma) s = s.replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Разбор CSV BimmerLink.
 *
 * BimmerLink опрашивает параметры по кругу: пока параметр ни разу не опрошен,
 * в его колонке стоит «0» (целое, без дробной части). Первое реальное значение
 * всегда записано с дробной частью («0.00», «87.00»). Поэтому всё до первого
 * значения с дробной частью считается пропуском (null). Если колонка вообще не
 * содержит дробных чисел — пропуском считаются ведущие нули.
 */
function parseBimmerlinkCsv(input, { filename } = {}) {
  let text = Buffer.isBuffer(input) ? input.toString('utf8') : String(input || '');
  text = text.replace(/^\uFEFF/, '');
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  if (!firstLine.trim()) throw new CsvError('Файл пустой.');

  const delimiter = detectDelimiter(firstLine);
  const decimalComma = delimiter === ';';

  let records;
  try {
    records = parse(text, {
      delimiter,
      relax_column_count: true,
      skip_empty_lines: true,
      trim: true,
      bom: true
    });
  } catch (err) {
    throw new CsvError(`Не удалось разобрать CSV: ${err.message}`);
  }

  if (records.length < 2) throw new CsvError('В файле нет строк с данными.');

  const header = records[0].map((h) => String(h).trim());
  if (header.length < 2) throw new CsvError('В заголовке меньше двух колонок — это не лог BimmerLink.');

  const width = header.length;
  const warnings = [];
  const time = [];
  const rawCols = Array.from({ length: width - 1 }, () => []);
  let badRows = 0;

  for (let r = 1; r < records.length; r++) {
    const row = records[r];
    const t = toNumber(row[0], decimalComma);
    if (t === null || row.length < 2) {
      badRows++;
      continue;
    }
    if (time.length && t < time[time.length - 1]) {
      badRows++;
      continue;
    }
    time.push(t);
    // недостающие колонки в строке считаются пропусками
    for (let c = 1; c < width; c++) rawCols[c - 1].push(row[c] === undefined ? '' : String(row[c]));
  }

  if (badRows) warnings.push(`Пропущено строк с ошибками: ${badRows}.`);
  if (time.length < 2) throw new CsvError('Недостаточно корректных строк с данными.');

  const series = rawCols.map((col) => {
    const hasDecimal = col.some((v) => /[.,]\d/.test(v));
    let started = false;
    return col.map((raw) => {
      const n = toNumber(raw, decimalComma);
      if (!started) {
        if (n === null) return null;
        if (hasDecimal ? /[.,]\d/.test(raw) : n !== 0) started = true;
        else return null;
      }
      return n;
    });
  });

  const channels = header.slice(1).map((sourceName, i) => ({
    idx: i,
    sourceName,
    ...describeChannel(sourceName),
    ...computeStats(time, series[i])
  }));

  const empty = channels.filter((c) => c.validCount === 0).length;
  if (empty) warnings.push(`Каналов без данных: ${empty}.`);

  return {
    version: PARSER_VERSION,
    recordedAt: recordedAtFromFilename(filename),
    timeLabel: header[0],
    duration: time[time.length - 1] - time[0],
    rowCount: time.length,
    time,
    series,
    channels,
    warnings
  };
}

function computeStats(time, values) {
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let count = 0;
  let minT = null;
  let maxT = null;
  let allZero = true;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v === null) continue;
    count++;
    sum += v;
    if (v !== 0) allZero = false;
    if (v < min) {
      min = v;
      minT = time[i];
    }
    if (v > max) {
      max = v;
      maxT = time[i];
    }
  }
  if (!count) {
    return {
      min: null,
      max: null,
      avg: null,
      minT: null,
      maxT: null,
      validCount: 0,
      constant: true,
      allZero: true
    };
  }
  return {
    min,
    max,
    avg: sum / count,
    minT,
    maxT,
    validCount: count,
    constant: min === max,
    allZero
  };
}

module.exports = {
  parseBimmerlinkCsv,
  recordedAtFromFilename,
  detectDelimiter,
  computeStats,
  CsvError,
  PARSER_VERSION
};
