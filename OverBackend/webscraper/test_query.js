const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '../../assets/routes.db');
console.log("Opening database:", dbPath);
const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
  if (err) {
    console.error("Failed to open DB:", err);
    process.exit(1);
  }
});

console.time("Query execution");
db.all(`
  SELECT 
    s.stop_id, 
    s.stop_name, 
    next_s.stop_name AS next_stop_name
  FROM stops s
  LEFT JOIN stop_times st1 ON s.stop_id = st1.stop_id
  LEFT JOIN stop_times st2 ON st1.trip_id = st2.trip_id AND st2.stop_sequence = st1.stop_sequence + 1
  LEFT JOIN stops next_s ON st2.stop_id = next_s.stop_id
  GROUP BY s.stop_id, next_s.stop_name;
`, [], (err, rows) => {
  console.timeEnd("Query execution");
  if (err) {
    console.error("Query failed:", err);
  } else {
    console.log(`Successfully fetched ${rows.length} rows.`);
    console.log("Sample rows:", rows.slice(0, 10));
  }
  db.close();
});
