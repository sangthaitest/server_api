const path = require("path");
const Database = require("better-sqlite3");

const isoDb = new Database(path.join(__dirname, "..", "..", "data", "iso8583.db"));

isoDb.exec(`
    CREATE TABLE IF NOT EXISTS iso_settings (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL
    )
`);

isoDb.exec(`
    CREATE TABLE IF NOT EXISTS iso_messages (
        id INTEGER PRIMARY KEY,
        createdAt TEXT NOT NULL,
        remote TEXT NOT NULL,
        mti TEXT NOT NULL,
        processingCode TEXT NOT NULL,
        amount TEXT NOT NULL,
        panMasked TEXT NOT NULL,
        tid TEXT NOT NULL,
        mid TEXT NOT NULL,
        entryMode TEXT NOT NULL,
        responseCode TEXT NOT NULL,
        approvalCode TEXT NOT NULL,
        rrn TEXT NOT NULL,
        detail TEXT NOT NULL
    )
`);

isoDb.prepare(`
    INSERT INTO iso_settings (key, value)
    VALUES ('response_code', '00')
    ON CONFLICT(key) DO NOTHING
`).run();

console.log("ISO8583 database connected");
console.log("ISO8583 tables ready");

module.exports = isoDb;
