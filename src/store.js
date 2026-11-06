const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { parseBimmerlinkCsv } = require('./parser');
const { detectEvents } = require('./detect');

class NotFoundError extends Error {
  constructor(message = 'Запись не найдена.') {
    super(message);
    this.status = 404;
  }
}

function createStore(db, { rawDir, parsedDir }) {
  fs.mkdirSync(rawDir, { recursive: true });
  fs.mkdirSync(parsedDir, { recursive: true });

  const cache = new Map(); // id -> { time, series }, последние 5 открытых логов
  const rawPath = (id) => path.join(rawDir, `${id}.csv`);
  const parsedPath = (id) => path.join(parsedDir, `${id}.json.gz`);

  const insertLog = db.prepare(`INSERT INTO logs
    (name, filename, recorded_at, uploaded_at, duration_s, row_count, parser_version, time_label, warnings_json, events_json)
    VALUES (@name, @filename, @recordedAt, @uploadedAt, @duration, @rowCount, @version, @timeLabel, @warnings, @events)`);
  const updateParsed = db.prepare(`UPDATE logs SET recorded_at = COALESCE(recorded_at, @recordedAt),
    duration_s = @duration, row_count = @rowCount, parser_version = @version, time_label = @timeLabel,
    warnings_json = @warnings, events_json = @events WHERE id = @id`);
  const insertChannel = db.prepare(`INSERT INTO channels
    (log_id, idx, source_name, name, unit, grp, warn, min, max, avg, min_t, max_t, valid_count, constant, all_zero)
    VALUES (@logId, @idx, @sourceName, @name, @unit, @group, @warn, @min, @max, @avg, @minT, @maxT, @validCount, @constant, @allZero)`);
  const deleteChannels = db.prepare('DELETE FROM channels WHERE log_id = ?');

  function saveParsed(id, parsed) {
    const events = detectEvents(parsed);
    const row = {
      id,
      recordedAt: parsed.recordedAt,
      duration: parsed.duration,
      rowCount: parsed.rowCount,
      version: parsed.version,
      timeLabel: parsed.timeLabel,
      warnings: JSON.stringify(parsed.warnings),
      events: JSON.stringify(events)
    };
    updateParsed.run(row);
    deleteChannels.run(id);
    for (const ch of parsed.channels) {
      insertChannel.run({
        logId: id,
        idx: ch.idx,
        sourceName: ch.sourceName,
        name: ch.name,
        unit: ch.unit || '',
        group: ch.group,
        warn: typeof ch.warn === 'number' ? ch.warn : null,
        min: ch.min,
        max: ch.max,
        avg: ch.avg,
        minT: ch.minT,
        maxT: ch.maxT,
        validCount: ch.validCount,
        constant: ch.constant ? 1 : 0,
        allZero: ch.allZero ? 1 : 0
      });
    }
    const payload = JSON.stringify({ version: parsed.version, time: parsed.time, series: parsed.series });
    fs.writeFileSync(parsedPath(id), zlib.gzipSync(payload));
    cache.delete(id);
  }

  function createLog({ buffer, filename, name }) {
    const parsed = parseBimmerlinkCsv(buffer, { filename });
    const cleanName = String(name || '').trim() || defaultName(filename, parsed.recordedAt);
    const id = db.transaction(() => {
      const info = insertLog.run({
        name: cleanName,
        filename: filename || 'log.csv',
        recordedAt: parsed.recordedAt,
        uploadedAt: new Date().toISOString(),
        duration: parsed.duration,
        rowCount: parsed.rowCount,
        version: parsed.version,
        timeLabel: parsed.timeLabel,
        warnings: '[]',
        events: '[]'
      });
      const newId = Number(info.lastInsertRowid);
      fs.writeFileSync(rawPath(newId), buffer);
      saveParsed(newId, parsed);
      return newId;
    })();
    return getLog(id);
  }

  function rowToLog(row) {
    return {
      id: row.id,
      name: row.name,
      filename: row.filename,
      recordedAt: row.recorded_at,
      uploadedAt: row.uploaded_at,
      duration: row.duration_s,
      rowCount: row.row_count,
      notes: row.notes,
      timeLabel: row.time_label
    };
  }

  function listLogs() {
    return db
      .prepare(
        `SELECT l.*, (SELECT COUNT(*) FROM channels c WHERE c.log_id = l.id) AS channel_count
         FROM logs l ORDER BY COALESCE(l.recorded_at, l.uploaded_at) DESC, l.id DESC`
      )
      .all()
      .map((row) => ({ ...rowToLog(row), channelCount: row.channel_count }));
  }

  function getLog(id) {
    const row = db.prepare('SELECT * FROM logs WHERE id = ?').get(id);
    if (!row) throw new NotFoundError();
    const channels = db
      .prepare('SELECT * FROM channels WHERE log_id = ? ORDER BY idx')
      .all(id)
      .map((c) => ({
        idx: c.idx,
        sourceName: c.source_name,
        name: c.name,
        unit: c.unit,
        group: c.grp,
        warn: c.warn,
        min: c.min,
        max: c.max,
        avg: c.avg,
        minT: c.min_t,
        maxT: c.max_t,
        validCount: c.valid_count,
        constant: !!c.constant,
        allZero: !!c.all_zero
      }));
    return {
      ...rowToLog(row),
      channels,
      events: JSON.parse(row.events_json),
      warnings: JSON.parse(row.warnings_json)
    };
  }

  function updateLog(id, { name, notes }) {
    getLog(id);
    if (name !== undefined) {
      const clean = String(name).trim();
      if (!clean) {
        const err = new Error('Имя не может быть пустым.');
        err.status = 400;
        throw err;
      }
      db.prepare('UPDATE logs SET name = ? WHERE id = ?').run(clean, id);
    }
    if (notes !== undefined) db.prepare('UPDATE logs SET notes = ? WHERE id = ?').run(String(notes), id);
    return getLog(id);
  }

  function deleteLog(id) {
    const info = db.prepare('DELETE FROM logs WHERE id = ?').run(id);
    if (!info.changes) throw new NotFoundError();
    cache.delete(id);
    for (const p of [rawPath(id), parsedPath(id)]) fs.rmSync(p, { force: true });
  }

  function getData(id) {
    if (cache.has(id)) {
      const hit = cache.get(id);
      cache.delete(id);
      cache.set(id, hit);
      return hit;
    }
    const file = parsedPath(id);
    if (!fs.existsSync(file)) throw new NotFoundError('Данные лога не найдены.');
    const data = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8'));
    cache.set(id, data);
    while (cache.size > 5) cache.delete(cache.keys().next().value);
    return data;
  }

  function reparseAll() {
    const rows = db.prepare('SELECT id, filename FROM logs').all();
    const report = { ok: 0, failed: [] };
    for (const { id, filename } of rows) {
      try {
        const parsed = parseBimmerlinkCsv(fs.readFileSync(rawPath(id)), { filename });
        db.transaction(() => saveParsed(id, parsed))();
        report.ok++;
      } catch (err) {
        report.failed.push({ id, error: err.message });
      }
    }
    return report;
  }

  /** Перенос записей из старой таблицы sessions (версия до переработки). */
  function migrateLegacy() {
    const legacy = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'").get();
    if (!legacy) return 0;
    const rows = db.prepare('SELECT * FROM sessions ORDER BY id').all();
    let moved = 0;
    for (const row of rows) {
      try {
        const columns = JSON.parse(row.columns_json);
        const data = JSON.parse(row.data_json);
        const csv = legacyToCsv(columns, data);
        const log = createLog({ buffer: Buffer.from(csv, 'utf8'), filename: row.filename, name: row.name });
        db.prepare('UPDATE logs SET uploaded_at = ? WHERE id = ?').run(row.created_at, log.id);
        moved++;
      } catch (err) {
        console.warn(`Не удалось перенести старую запись #${row.id}: ${err.message}`);
      }
    }
    db.exec('ALTER TABLE sessions RENAME TO sessions_legacy');
    return moved;
  }

  // ---------- Пресеты ----------
  const presetRow = (r) => ({
    id: r.id,
    name: r.name,
    channels: JSON.parse(r.channels_json),
    createdAt: r.created_at,
    updatedAt: r.updated_at
  });

  function validatePreset({ name, channels }) {
    const clean = String(name || '').trim();
    if (!clean) throw Object.assign(new Error('Укажите имя пресета.'), { status: 400 });
    if (!Array.isArray(channels) || !channels.length || channels.some((c) => typeof c !== 'string')) {
      throw Object.assign(new Error('Пресет должен содержать список параметров.'), { status: 400 });
    }
    return { name: clean.slice(0, 80), channels: [...new Set(channels)] };
  }

  const presets = {
    list: () => db.prepare('SELECT * FROM presets ORDER BY name COLLATE NOCASE').all().map(presetRow),
    create(input) {
      const p = validatePreset(input);
      const now = new Date().toISOString();
      const info = db
        .prepare('INSERT INTO presets (name, channels_json, created_at, updated_at) VALUES (?, ?, ?, ?)')
        .run(p.name, JSON.stringify(p.channels), now, now);
      return presetRow(db.prepare('SELECT * FROM presets WHERE id = ?').get(info.lastInsertRowid));
    },
    update(id, input) {
      const p = validatePreset(input);
      const info = db
        .prepare('UPDATE presets SET name = ?, channels_json = ?, updated_at = ? WHERE id = ?')
        .run(p.name, JSON.stringify(p.channels), new Date().toISOString(), id);
      if (!info.changes) throw new NotFoundError('Пресет не найден.');
      return presetRow(db.prepare('SELECT * FROM presets WHERE id = ?').get(id));
    },
    remove(id) {
      const info = db.prepare('DELETE FROM presets WHERE id = ?').run(id);
      if (!info.changes) throw new NotFoundError('Пресет не найден.');
    }
  };

  return {
    createLog,
    listLogs,
    getLog,
    updateLog,
    deleteLog,
    getData,
    reparseAll,
    migrateLegacy,
    rawPath,
    presets
  };
}

function defaultName(filename, recordedAt) {
  if (recordedAt) {
    const [d, t] = recordedAt.split('T');
    const [y, m, day] = d.split('-');
    return `Заезд ${day}.${m}.${y} ${t.slice(0, 5)}`;
  }
  return String(filename || 'Лог').replace(/\.csv$/i, '');
}

function legacyToCsv(columns, data) {
  const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
  const lines = [columns.map(q).join(',')];
  const started = columns.map(() => false);
  for (const row of data) {
    lines.push(
      row
        .map((v, i) => {
          if (i === 0) return String(v);
          if (v === null || v === undefined) return '';
          if (!started[i] && v === 0) return '0';
          started[i] = true;
          return Number.isInteger(v) ? v.toFixed(1) : String(v);
        })
        .join(',')
    );
  }
  return lines.join('\n');
}

module.exports = { createStore, NotFoundError, defaultName, legacyToCsv };
