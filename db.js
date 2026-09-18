const Database = require("better-sqlite3");

const db = new Database("./data/app.db");

db.exec(`
    CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        price INTEGER NOT NULL
    )
`);

console.log("Database connected");
console.log("Products table ready");

module.exports = db;