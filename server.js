const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const upload = multer({ storage: multer.memoryStorage() });
const PORT = process.env.PORT || 3000;
const DATA_PATH = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_PATH, 'logs.db');

if (!fs.existsSync(DATA_PATH)) {
  fs.mkdirSync(DATA_PATH, { recursive: true });
}

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('Не удалось открыть базу данных:', err.message);
    process.exit(1);
  }
});

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    folder TEXT DEFAULT '',
    filename TEXT NOT NULL,
    created_at TEXT NOT NULL,
    columns_json TEXT NOT NULL,
    max_json TEXT NOT NULL,
    data_json TEXT NOT NULL
  )`, () => {
    db.run(`ALTER TABLE sessions ADD COLUMN folder TEXT DEFAULT ''`, (err) => {
      // Ignore error if column already exists
    });
  });
});

function parseCsv(csvText) {
  const lines = csvText.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) {
    throw new Error('Недостаточно строк для разбора.');
  }

  const headerLine = lines[0];
  const columns = headerLine.split(',').map((item) => item.replace(/^"|"$/g, '').trim());
  const data = lines.slice(1).map((line) => {
    const values = line.split(',').map((value) => {
      const trimmed = value.trim();
      return trimmed === '' ? null : Number(trimmed);
    });
    return values;
  });

  const max = columns.map((col, index) => {
    if (index === 0) {
      return null;
    }
    const values = data.map((row) => row[index]).filter((value) => typeof value === 'number' && !Number.isNaN(value));
    return values.length === 0 ? null : Math.max(...values);
  });

  return { columns, data, max };
}

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/sessions', (req, res) => {
  db.all('SELECT id, name, folder, filename, created_at, columns_json, max_json FROM sessions ORDER BY created_at DESC', [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    const sessions = rows.map((row) => {
      let cols = [], maxs = [];
      try { cols = JSON.parse(row.columns_json); } catch(e) {}
      try { maxs = JSON.parse(row.max_json); } catch(e) {}
      return {
        id: row.id,
        name: row.name,
        folder: row.folder || '',
        filename: row.filename,
        createdAt: row.created_at,
        columns: cols,
        maxValues: maxs
      };
    });
    res.json({ sessions });
  });
});

app.post('/api/upload', upload.single('logfile'), (req, res) => {
  const name = (req.body.name || '').trim();
  const folder = (req.body.folder || '').trim();
  if (!req.file) {
    return res.status(400).json({ error: 'Файл не был загружен.' });
  }
  if (!name) {
    return res.status(400).json({ error: 'Укажите имя для лог-файла.' });
  }

  const fileContent = req.file.buffer.toString('utf8');
  let parsed;
  try {
    parsed = parseCsv(fileContent);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  const createdAt = new Date().toISOString();
  const stmt = db.prepare('INSERT INTO sessions (name, folder, filename, created_at, columns_json, max_json, data_json) VALUES (?, ?, ?, ?, ?, ?, ?)');
  stmt.run(name, folder, req.file.originalname, createdAt, JSON.stringify(parsed.columns), JSON.stringify(parsed.max), JSON.stringify(parsed.data), function (err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json({ id: this.lastID, name, folder, filename: req.file.originalname, createdAt, columns: parsed.columns, maxValues: parsed.max });
  });
  stmt.finalize();
});

app.get('/api/session/:id', (req, res) => {
  const sessionId = Number(req.params.id);
  db.get('SELECT id, name, folder, filename, created_at, columns_json, max_json, data_json FROM sessions WHERE id = ?', [sessionId], (err, row) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!row) {
      return res.status(404).json({ error: 'Запись не найдена.' });
    }
    let cols = [], maxs = [], dat = [];
    try { cols = JSON.parse(row.columns_json); } catch(e) {}
    try { maxs = JSON.parse(row.max_json); } catch(e) {}
    try { dat = JSON.parse(row.data_json); } catch(e) {}
    res.json({
      id: row.id,
      name: row.name,
      folder: row.folder || '',
      filename: row.filename,
      createdAt: row.created_at,
      columns: cols,
      maxValues: maxs,
      data: dat
    });
  });
});

// DELETE session by id
app.delete('/api/session/:id', (req, res) => {
  const sessionId = Number(req.params.id);
  db.run('DELETE FROM sessions WHERE id = ?', [sessionId], function (err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (this.changes === 0) {
      return res.status(404).json({ error: 'Запись не найдена.' });
    }
    res.json({ success: true, deletedId: sessionId });
  });
});

app.put('/api/session/:id/folder', (req, res) => {
  const sessionId = Number(req.params.id);
  const folder = (req.body.folder || '').trim();
  db.run('UPDATE sessions SET folder = ? WHERE id = ?', [folder, sessionId], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
