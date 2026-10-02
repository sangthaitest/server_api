const crypto = require("crypto");
const express = require("express");
const shbvnDb = require("./db");
const shbvnCrypto = require("./crypto");

const SHBVN_PORT = 30088;
const API_TOKEN = "mock-shbvn-qr-token";
const API_SECRET = "shbvn-mock-hmac-secret";

const router = express.Router();

function nowIso() {
    return new Date().toISOString();
}

function text(value) {
    return typeof value === "string" ? value.trim() : "";
}

function amountText(value) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
        return String(value);
    }

    if (typeof value === "string" && /^\d+(\.\d+)?$/.test(value.trim())) {
        const parsed = Number(value.trim());

        if (parsed > 0) {
            return String(parsed);
        }
    }

    return "";
}

function errorBody(errorCode, message) {
    return {
        status: "error",
        error_code: errorCode,
        message: message
    };
}

function paymentResult(row) {
    return {
        transaction_id: row.transaction_id,
        transaction_type: "QR",
        reprst_vrtl_ac_no: row.virtual_acc_no,
        vac_etpr_nm: "SHBVN",
        vac_mo_acno: "",
        local_datetime: row.updatedAt,
        amount: row.amount,
        currency: "VND",
        addition_info: "",
        err_description: "",
        transaction_stat: row.status,
        timeout: false
    };
}

function findPayment(body) {
    const transactionId = text(body && body.transaction_id);
    const virtualAccNo = text(body && (body.virtual_acc_no || body.reprst_vrtl_ac_no));

    if (transactionId !== "") {
        return shbvnDb.prepare("SELECT * FROM shbvn_payments WHERE transaction_id = ?").get(transactionId);
    }

    if (virtualAccNo !== "") {
        return shbvnDb.prepare("SELECT * FROM shbvn_payments WHERE virtual_acc_no = ? ORDER BY id DESC").get(virtualAccNo);
    }

    return null;
}

function requireToken(req, res) {
    if (req.get("X-API-Token") === API_TOKEN) {
        return true;
    }

    res.json(errorBody("INVALID_KEY", "Token is missing or expired"));
    return false;
}

function statusBody(row) {
    if (!row) {
        return errorBody("TRANSACTION_NOT_FOUND", "Transaction not found");
    }

    if (row.status === "success") {
        return {
            status: "success",
            data: paymentResult(row)
        };
    }

    if (row.status === "failed") {
        return errorBody("INQUIRY_ERROR", "Payment failed");
    }

    return errorBody("TRANSACTION_PENDING", "Transaction is pending");
}

router.post("/api/v1/init", (req, res) => {
    const serialNumber = text(req.body && req.body.serial_number) || "unknown";
    const tid = text(req.body && req.body.tid);
    const mid = text(req.body && req.body.mid);
    const merchantName = text(req.body && req.body.merchant_name);
    const now = nowIso();
    const existing = shbvnDb.prepare("SELECT serial_number FROM shbvn_devices WHERE serial_number = ?").get(serialNumber);

    if (existing) {
        shbvnDb.prepare(`
            UPDATE shbvn_devices
            SET tid = ?, mid = ?, merchant_name = ?, token = ?, secret = ?, updatedAt = ?
            WHERE serial_number = ?
        `).run(tid, mid, merchantName, API_TOKEN, API_SECRET, now, serialNumber);
    } else {
        shbvnDb.prepare(`
            INSERT INTO shbvn_devices (
                serial_number, tid, mid, merchant_name, token, secret, createdAt, updatedAt
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(serialNumber, tid, mid, merchantName, API_TOKEN, API_SECRET, now, now);
    }

    res.json({
        status: "success",
        data: shbvnCrypto.encryptTokenSecret(API_TOKEN, API_SECRET)
    });
});

router.post("/api/v1/qr/create", (req, res) => {
    if (!requireToken(req, res)) {
        return;
    }

    const amount = amountText(req.body && req.body.amount);

    if (amount === "") {
        res.json(errorBody("INVALID_AMOUNT", "Amount is invalid"));
        return;
    }

    const now = nowIso();
    const transactionId = "SHB" + Date.now().toString() + crypto.randomBytes(2).toString("hex");
    const virtualAccNo = String(Date.now()).slice(-12);

    shbvnDb.prepare(`
        INSERT INTO shbvn_payments (
            transaction_id, virtual_acc_no, tid, mid, amount, status, createdAt, updatedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        transactionId,
        virtualAccNo,
        text(req.body && req.body.tid),
        text(req.body && req.body.mid),
        amount,
        "pending",
        now,
        now
    );

    res.json({
        status: "success",
        data: {
            transaction_id: transactionId,
            virtual_acc_no: virtualAccNo,
            amount: amount,
            countdown_time_sec: 450,
            request_interval_sec: 5
        }
    });
});

router.post("/api/v1/transaction/check", (req, res) => {
    if (!requireToken(req, res)) {
        return;
    }

    res.json(statusBody(findPayment(req.body)));
});

router.post("/api/v1/transaction/timeout", (req, res) => {
    if (!requireToken(req, res)) {
        return;
    }

    res.json(statusBody(findPayment(req.body)));
});

router.get("/api/shbvn/payments", (req, res) => {
    const rows = shbvnDb.prepare(`
        SELECT id, transaction_id, virtual_acc_no, tid, mid, amount, status, createdAt, updatedAt
        FROM shbvn_payments
        ORDER BY id DESC
    `).all();

    res.json(rows);
});

router.post("/api/shbvn/payments/:transactionId/status", (req, res) => {
    const status = text(req.body && req.body.status);

    if (status !== "pending" && status !== "success" && status !== "failed") {
        res.status(400).json({ error: "Status must be pending, success, or failed" });
        return;
    }

    const result = shbvnDb.prepare(`
        UPDATE shbvn_payments
        SET status = ?, updatedAt = ?
        WHERE transaction_id = ?
    `).run(status, nowIso(), req.params.transactionId);

    if (result.changes === 0) {
        res.status(404).json({ error: "Payment not found" });
        return;
    }

    res.json({ message: "Status updated", status: status });
});

function start(app) {
    const server = app.listen({ port: SHBVN_PORT, host: "::", ipv6Only: false }, function () {
        console.log("SHBVN QR listening on 0.0.0.0:" + SHBVN_PORT);
    });

    server.on("error", function (err) {
        console.log("SHBVN QR listen error: " + err.message);
    });
}

module.exports = {
    router: router,
    start: start,
    SHBVN_PORT: SHBVN_PORT
};
