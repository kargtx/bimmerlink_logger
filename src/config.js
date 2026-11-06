const path = require('path');

try {
  // Node >= 21.7: читает .env, если он есть
  process.loadEnvFile(path.join(__dirname, '..', '.env'));
} catch {
  // .env необязателен
}

const root = path.join(__dirname, '..');
const dataDir = path.resolve(root, process.env.DATA_DIR || 'data');

module.exports = {
  root,
  port: Number(process.env.PORT) || 3000,
  dataDir,
  dbPath: path.join(dataDir, 'logs.db'),
  rawDir: path.join(dataDir, 'raw'),
  parsedDir: path.join(dataDir, 'parsed'),
  backupDir: path.resolve(root, process.env.BACKUP_DIR || 'backups')
};
