const Database = require("better-sqlite3");

const db = new Database("./data/app.db");

db.exec(`
    CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        price INTEGER NOT NULL
    )
`);

db.exec(`
    CREATE TABLE IF NOT EXISTS devices (
        deviceId TEXT PRIMARY KEY NOT NULL,
        manufacturer TEXT NOT NULL,
        model TEXT NOT NULL,
        brand TEXT NOT NULL,
        androidVersion TEXT NOT NULL,
        sdkVersion INTEGER NOT NULL,
        appVersion TEXT NOT NULL,
        ipAddress TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
    )
`);

console.log("Database connected");
console.log("Products table ready");
console.log("Devices table ready");

module.exports = db;