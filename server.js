const config = require('./src/config');
const { openDatabase } = require('./src/db');
const { createStore } = require('./src/store');
const { createApp } = require('./src/app');

const db = openDatabase(config.dbPath);
const store = createStore(db, config);

const moved = store.migrateLegacy();
if (moved) console.log(`Перенесено записей из старой базы: ${moved}`);

const app = createApp({ store, root: config.root });
const server = app.listen(config.port, () => {
  console.log(`Bimmerlink Logger: http://localhost:${config.port}`);
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
