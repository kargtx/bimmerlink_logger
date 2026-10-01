const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./data/logs.db');

db.all("PRAGMA table_info(sessions)", [], (err, rows) => {
    console.log(rows);
});
