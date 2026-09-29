const path = require("path");
const Database = require("better-sqlite3");

const qrDb = new Database(path.join(__dirname, "..", "data", "qr.db"));

qrDb.exec(`
    CREATE TABLE IF NOT EXISTS qr_tokens (
        accessToken TEXT PRIMARY KEY NOT NULL,
        clientId TEXT NOT NULL,
        expiresAt INTEGER NOT NULL,
        createdAt TEXT NOT NULL
    )
`);

qrDb.exec(`
    CREATE TABLE IF NOT EXISTS qr_payments (
        id INTEGER PRIMARY KEY,
        paymentRef TEXT NOT NULL UNIQUE,
        requestId TEXT NOT NULL,
        partnerCode TEXT NOT NULL,
        mid TEXT NOT NULL,
        tid TEXT NOT NULL,
        billNumber TEXT NOT NULL,
        billInfo TEXT NOT NULL,
        amount INTEGER NOT NULL,
        payType TEXT NOT NULL,
        qrPayload TEXT NOT NULL,
        payStatus TEXT NOT NULL,
        requestJson TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
    )
`);

console.log("QR database connected");
console.log("QR tables ready");

module.exports = qrDb;
