const path = require("path");
const Database = require("better-sqlite3");

const shbvnDb = new Database(path.join(__dirname, "..", "..", "data", "shbvn.db"));

shbvnDb.exec(`
    CREATE TABLE IF NOT EXISTS shbvn_devices (
        serial_number TEXT PRIMARY KEY NOT NULL,
        tid TEXT NOT NULL,
        mid TEXT NOT NULL,
        merchant_name TEXT NOT NULL,
        token TEXT NOT NULL,
        secret TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
    )
`);

shbvnDb.exec(`
    CREATE TABLE IF NOT EXISTS shbvn_payments (
        id INTEGER PRIMARY KEY,
        transaction_id TEXT NOT NULL UNIQUE,
        virtual_acc_no TEXT NOT NULL,
        tid TEXT NOT NULL,
        mid TEXT NOT NULL,
        amount TEXT NOT NULL,
        status TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
    )
`);

console.log("SHBVN database connected");
console.log("SHBVN tables ready");

module.exports = shbvnDb;
