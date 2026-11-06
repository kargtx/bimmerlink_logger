// Резервная копия: снимок базы через SQLite backup API + копия data/raw.
// Запуск: npm run backup (можно повесить на cron / планировщик Windows).
const fs = require('fs');
const path = require('path');
const config = require('../src/config');
const { openDatabase } = require('../src/db');

const KEEP = Number(process.env.BACKUP_KEEP) || 14;

async function main() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const target = path.join(config.backupDir, stamp);
  fs.mkdirSync(target, { recursive: true });

  const db = openDatabase(config.dbPath);
  await db.backup(path.join(target, 'logs.db'));
  db.close();

  if (fs.existsSync(config.rawDir)) fs.cpSync(config.rawDir, path.join(target, 'raw'), { recursive: true });

  const all = fs
    .readdirSync(config.backupDir)
    .filter((d) => fs.statSync(path.join(config.backupDir, d)).isDirectory())
    .sort();
  for (const old of all.slice(0, Math.max(0, all.length - KEEP))) {
    fs.rmSync(path.join(config.backupDir, old), { recursive: true, force: true });
  }
  console.log(`Резервная копия: ${target}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
