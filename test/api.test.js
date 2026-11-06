const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { openDatabase } = require('../src/db');
const { createStore } = require('../src/store');
const { createApp } = require('../src/app');

const FIXTURE = path.join(__dirname, '..', 'fixtures', '2026-05-09_23-32-53.csv');

function setup(prepareDb) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-'));
  const dbPath = path.join(dir, 'logs.db');
  if (prepareDb) prepareDb(dbPath);
  const db = openDatabase(dbPath);
  const store = createStore(db, { rawDir: path.join(dir, 'raw'), parsedDir: path.join(dir, 'parsed') });
  const app = createApp({ store, root: path.join(__dirname, '..') });
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const base = `http://127.0.0.1:${server.address().port}`;
      resolve({
        base,
        store,
        close: () =>
          new Promise((r) => server.close(() => (db.close(), fs.rmSync(dir, { recursive: true }), r())))
      });
    });
  });
}

async function uploadFixture(base, name = '') {
  const form = new FormData();
  form.append('name', name);
  form.append('logfile', new Blob([fs.readFileSync(FIXTURE)]), path.basename(FIXTURE));
  return fetch(`${base}/api/logs`, { method: 'POST', body: form });
}

test('полный цикл: загрузка, список, данные, правка, удаление', async () => {
  const ctx = await setup();
  try {
    const up = await uploadFixture(ctx.base);
    assert.equal(up.status, 201);
    const log = await up.json();
    assert.equal(log.name, 'Заезд 09.05.2026 23:32');
    assert.equal(log.channels.length, 16);
    assert.ok(log.events.some((e) => e.kind === 'sprint'));

    const list = await (await fetch(`${ctx.base}/api/logs`)).json();
    assert.equal(list.logs.length, 1);

    const data = await (await fetch(`${ctx.base}/api/logs/${log.id}/data?ch=14,15&from=5&to=10`)).json();
    assert.deepEqual(data.channels, [14, 15]);
    assert.equal(data.series.length, 2);
    assert.ok(data.time[0] <= 5 && data.time.at(-1) >= 10);

    const patched = await (
      await fetch(`${ctx.base}/api/logs/${log.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: '<img src=x onerror=alert(1)>', notes: 'трасса' })
      })
    ).json();
    assert.equal(patched.notes, 'трасса');

    const raw = await fetch(`${ctx.base}/api/logs/${log.id}/raw`);
    assert.equal(raw.status, 200);
    assert.match(await raw.text(), /^Time,/);

    const del = await fetch(`${ctx.base}/api/logs/${log.id}`, { method: 'DELETE' });
    assert.equal(del.status, 200);
    assert.equal((await fetch(`${ctx.base}/api/logs/${log.id}`)).status, 404);
  } finally {
    await ctx.close();
  }
});

test('ошибки API отдаются как JSON', async () => {
  const ctx = await setup();
  try {
    const r404 = await fetch(`${ctx.base}/api/nope`);
    assert.equal(r404.status, 404);
    assert.ok((await r404.json()).error);
    const bad = await fetch(`${ctx.base}/api/logs`, { method: 'POST', body: new FormData() });
    assert.equal(bad.status, 400);
    assert.equal((await fetch(`${ctx.base}/api/logs/abc`)).status, 400);
  } finally {
    await ctx.close();
  }
});

test('пресеты: создание, изменение, удаление', async () => {
  const ctx = await setup();
  try {
    const json = { 'content-type': 'application/json' };
    const created = await (
      await fetch(`${ctx.base}/api/presets`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ name: 'Наддув', channels: ['Boost pressure', 'Engine speed'] })
      })
    ).json();
    assert.equal(created.channels.length, 2);
    const upd = await fetch(`${ctx.base}/api/presets/${created.id}`, {
      method: 'PUT',
      headers: json,
      body: JSON.stringify({ name: 'Наддув 2', channels: ['Boost pressure'] })
    });
    assert.equal((await upd.json()).name, 'Наддув 2');
    const bad = await fetch(`${ctx.base}/api/presets`, { method: 'POST', headers: json, body: '{}' });
    assert.equal(bad.status, 400);
    assert.equal((await fetch(`${ctx.base}/api/presets/${created.id}`, { method: 'DELETE' })).status, 200);
  } finally {
    await ctx.close();
  }
});

test('перенос записей из старой таблицы sessions', async () => {
  const ctx = await setup((dbPath) => {
    const old = new Database(dbPath);
    old.exec(`CREATE TABLE sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, filename TEXT NOT NULL,
      created_at TEXT NOT NULL, columns_json TEXT NOT NULL, max_json TEXT NOT NULL, data_json TEXT NOT NULL)`);
    old
      .prepare(
        'INSERT INTO sessions (name, filename, created_at, columns_json, max_json, data_json) VALUES (?,?,?,?,?,?)'
      )
      .run(
        'Старая',
        '2026-01-01_10-00-00.csv',
        '2026-01-01T10:05:00.000Z',
        JSON.stringify(['Time', 'Coolant temperature']),
        '[]',
        JSON.stringify([
          [0, 0],
          [0.1, 0],
          [0.2, 80],
          [0.3, 81.5]
        ])
      );
    old.close();
  });
  try {
    assert.equal(ctx.store.migrateLegacy(), 1);
    const [log] = ctx.store.listLogs();
    assert.equal(log.name, 'Старая');
    const full = ctx.store.getLog(log.id);
    assert.equal(full.channels[0].min, 80);
    assert.equal(ctx.store.migrateLegacy(), 0, 'повторный запуск ничего не делает');
  } finally {
    await ctx.close();
  }
});
