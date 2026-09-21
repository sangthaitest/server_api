const Database = require("better-sqlite3");

const srsDb = new Database("./data/srs.db");

srsDb.exec(`
    CREATE TABLE IF NOT EXISTS srs_clients (
        deviceId TEXT PRIMARY KEY NOT NULL,
        serial TEXT NOT NULL,
        encryptingKey TEXT NOT NULL,
        macingKey TEXT NOT NULL,
        expiredDate INTEGER NOT NULL,
        code TEXT NOT NULL,
        createdAt TEXT NOT NULL
    )
`);

srsDb.exec(`
    CREATE TABLE IF NOT EXISTS srs_transactions (
        id INTEGER PRIMARY KEY,
        transactionId TEXT NOT NULL UNIQUE,
        deviceId TEXT NOT NULL,
        approvalCode TEXT NOT NULL,
        code TEXT NOT NULL,
        version TEXT NOT NULL,
        receiptJson TEXT NOT NULL,
        createdAt TEXT NOT NULL
    )
`);

srsDb.exec(`
    CREATE TABLE IF NOT EXISTS srs_emails (
        id INTEGER PRIMARY KEY,
        transactionId TEXT NOT NULL,
        email TEXT NOT NULL,
        createdAt TEXT NOT NULL
    )
`);

srsDb.exec(`
    CREATE TABLE IF NOT EXISTS srs_signatures (
        id INTEGER PRIMARY KEY,
        signatureId TEXT NOT NULL,
        signatureString TEXT NOT NULL,
        uploadCurrent INTEGER,
        uploadTotal INTEGER,
        createdAt TEXT NOT NULL
    )
`);

srsDb.exec(`
    CREATE TABLE IF NOT EXISTS srs_licenses (
        id INTEGER PRIMARY KEY,
        otp TEXT,
        content TEXT,
        createdAt TEXT NOT NULL
    )
`);

console.log("SRS database connected");
console.log("SRS tables ready");

module.exports = srsDb;
