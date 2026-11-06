// Пересобирает все логи из исходных CSV (data/raw) — после правок парсера или словаря каналов.
const config = require('../src/config');
const { openDatabase } = require('../src/db');
const { createStore } = require('../src/store');

const db = openDatabase(config.dbPath);
const store = createStore(db, config);
const report = store.reparseAll();
console.log(`Пересобрано: ${report.ok}`);
for (const f of report.failed) console.log(`  #${f.id}: ${f.error}`);
db.close();
process.exit(report.failed.length ? 1 : 0);
