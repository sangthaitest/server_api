const path = require("path");
const Database = require("better-sqlite3");

const edccDb = new Database(path.join(__dirname, "..", "data", "edcc.db"));

edccDb.exec(`
    CREATE TABLE IF NOT EXISTS edcc_history (
        id INTEGER PRIMARY KEY,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        action TEXT NOT NULL,
        amount INTEGER NOT NULL,
        invoice TEXT NOT NULL,
        txnKey TEXT NOT NULL,
        terminalId TEXT NOT NULL,
        serial TEXT NOT NULL,
        outcome TEXT NOT NULL,
        responseCode TEXT NOT NULL,
        errorCode TEXT NOT NULL,
        txnCode TEXT NOT NULL,
        requestMessage TEXT NOT NULL,
        resultMessage TEXT NOT NULL
    )
`);

console.log("EDCC database connected");
console.log("EDCC tables ready");

module.exports = edccDb;
