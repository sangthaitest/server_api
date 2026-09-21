const express = require("express");
const crypto = require("crypto");
const srsDb = require("./db-srs");
const srsCrypto = require("./srs-crypto");

const router = express.Router();

function nowIso() {
    return new Date().toISOString();
}

function isObjectBody(body) {
    return body !== null && typeof body === "object" && !Array.isArray(body);
}

function bodyKeys(body) {
    if (!isObjectBody(body)) {
        return String(body);
    }

    return Object.keys(body).join(",");
}

function v3Error(result, message) {
    return {
        result: result,
        data: message
    };
}

function v2ErrorPayload(message) {
    return JSON.stringify({ Error: message });
}

function saveTransaction(deviceId, approvalCode, code, version, receipt) {
    const transactionId = srsCrypto.generateTransactionId();
    const receiptApproval = receipt && receipt.approvalCode != null && String(receipt.approvalCode) !== ""
        ? String(receipt.approvalCode)
        : (approvalCode == null ? "0" : String(approvalCode));
    const receiptJson = JSON.stringify(receipt);

    srsDb.prepare(`
        INSERT INTO srs_transactions (transactionId, deviceId, approvalCode, code, version, receiptJson, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
        transactionId,
        deviceId == null ? "" : String(deviceId),
        receiptApproval,
        code == null ? "" : String(code),
        version,
        receiptJson,
        nowIso()
    );

    return {
        transactionId: transactionId,
        approvalCode: receiptApproval
    };
}

function parseReceiptJson(receiptJson) {
    try {
        return srsCrypto.parseJsonObject(receiptJson);
    } catch (err) {
        return null;
    }
}

router.post("/saveTransaction/v2", (req, res) => {
    const body = req.body;

    if (!isObjectBody(body) || typeof body.data !== "string" || body.data.trim() === "") {
        return res.json({ data: "" });
    }

    const code = body.code == null ? "" : String(body.code);
    const keys = srsCrypto.getBranchKeys(code);

    if (!keys.tripleDesKey) {
        return res.json({ data: "" });
    }

    let receiptText;

    try {
        receiptText = srsCrypto.decrypt3Des(body.data, keys.tripleDesKey);
    } catch (err) {
        try {
            return res.json({
                data: srsCrypto.encrypt3Des(v2ErrorPayload("Failed to decrypt receipt"), keys.tripleDesKey)
            });
        } catch (encryptErr) {
            return res.json({ data: "" });
        }
    }

    let receipt;

    try {
        receipt = srsCrypto.parseJsonObject(receiptText);
    } catch (err) {
        return res.json({
            data: srsCrypto.encrypt3Des(v2ErrorPayload("Invalid receipt"), keys.tripleDesKey)
        });
    }

    try {
        const saved = saveTransaction("", body.approvalCode, code, "v2", receipt);
        return res.json({
            data: srsCrypto.encrypt3Des(JSON.stringify(saved), keys.tripleDesKey)
        });
    } catch (err) {
        return res.json({
            data: srsCrypto.encrypt3Des(v2ErrorPayload("Failed to save transaction"), keys.tripleDesKey)
        });
    }
});

router.post("/api/v3/clients", (req, res) => {
    console.log("SRS register body keys:", bodyKeys(req.body));
    const body = req.body;

    if (!isObjectBody(body) || typeof body.data !== "string" || body.data.trim() === "") {
        console.log("SRS register rejected: invalid body");
        return res.json(v3Error(96, "Invalid request body"));
    }

    const code = body.code == null ? "" : String(body.code);
    const keys = srsCrypto.getBranchKeys(code);

    let registerText;

    try {
        registerText = srsCrypto.unwrapV3(body.data, keys.registerKey);
    } catch (err) {
        console.log("SRS register decrypt failed", err.message);
        return res.json(v3Error(96, "Failed to decrypt register data"));
    }

    let registerData;

    try {
        registerData = srsCrypto.parseJsonObject(registerText);
    } catch (err) {
        return res.json(v3Error(96, "Invalid register data"));
    }

    const serial = registerData.serial == null ? "" : String(registerData.serial).trim();

    if (serial === "") {
        return res.json(v3Error(96, "serial is required"));
    }

    const deviceId = crypto.randomUUID();
    const encryptingKey = srsCrypto.randomAsciiKey(32);
    const macingKey = srsCrypto.randomAsciiKey(32);
    const expiredDate = Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60);

    try {
        srsDb.prepare(`
            INSERT INTO srs_clients (deviceId, serial, encryptingKey, macingKey, expiredDate, code, createdAt)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(deviceId, serial, encryptingKey, macingKey, expiredDate, code, nowIso());

        const payload = {
            deviceId: deviceId,
            encryptingKey: encryptingKey,
            macingKey: macingKey,
            expiredDate: expiredDate
        };

        console.log("SRS register saved", deviceId, serial, code);
        return res.json({
            result: 0,
            data: srsCrypto.wrapV3(JSON.stringify(payload), keys.registerKey)
        });
    } catch (err) {
        console.log("SRS register insert failed", err.message);
        return res.json(v3Error(96, "Failed to register client"));
    }
});

router.post("/api/v3/transactions", (req, res) => {
    console.log("SRS transaction body keys:", bodyKeys(req.body));
    const body = req.body;

    if (!isObjectBody(body) || typeof body.data !== "string" || body.data.trim() === "") {
        return res.json(v3Error(96, "Invalid request body"));
    }

    const deviceId = body.deviceId == null ? "" : String(body.deviceId).trim();

    if (deviceId === "") {
        return res.json(v3Error(1, "deviceId is required"));
    }

    let client;

    try {
        client = srsDb.prepare(`
            SELECT deviceId, encryptingKey, macingKey, expiredDate, code
            FROM srs_clients
            WHERE deviceId = ?
        `).get(deviceId);
    } catch (err) {
        return res.json(v3Error(96, "Failed to read client"));
    }

    if (!client) {
        return res.json(v3Error(1, "Device not registered"));
    }

    let receiptText;

    try {
        receiptText = srsCrypto.unwrapV3(body.data, client.encryptingKey);
    } catch (err) {
        return res.json(v3Error(96, "Failed to decrypt transaction"));
    }

    let receipt;

    try {
        receipt = srsCrypto.parseJsonObject(receiptText);
    } catch (err) {
        return res.json(v3Error(96, "Invalid receipt"));
    }

    if (!srsCrypto.verifyTransactionMac(receipt, deviceId, client.macingKey, body.mac)) {
        return res.json(v3Error(1, "Invalid mac"));
    }

    try {
        const saved = saveTransaction(deviceId, body.approvalCode, client.code, "v3", receipt);
        return res.json({
            result: 0,
            data: srsCrypto.wrapV3(JSON.stringify(saved), client.encryptingKey)
        });
    } catch (err) {
        return res.json(v3Error(96, "Failed to save transaction"));
    }
});

router.post("/sendEmail", (req, res) => {
    const body = req.body;

    if (!isObjectBody(body)) {
        return res.json({
            transactionId: "",
            message: "Invalid request body",
            responseCode: "01"
        });
    }

    const transactionId = body.transactionId == null ? "" : String(body.transactionId);
    const email = body.email == null ? "" : String(body.email);

    try {
        srsDb.prepare(`
            INSERT INTO srs_emails (transactionId, email, createdAt)
            VALUES (?, ?, ?)
        `).run(transactionId, email, nowIso());

        return res.json({
            transactionId: transactionId,
            message: "Email accepted",
            responseCode: "00"
        });
    } catch (err) {
        return res.json({
            transactionId: transactionId,
            message: "Failed to save email",
            responseCode: "01"
        });
    }
});

router.post("/uploadSignature", (req, res) => {
    const body = req.body;

    if (!isObjectBody(body)) {
        return res.json({
            transactionId: "",
            message: "Invalid request body",
            responseCode: "01"
        });
    }

    const signatureId = body.signatureId == null ? "" : String(body.signatureId);
    const signatureString = body.signatureString == null ? "" : String(body.signatureString);
    const uploadCurrent = Number.isInteger(body.uploadCurrent) ? body.uploadCurrent : null;
    const uploadTotal = Number.isInteger(body.uploadTotal) ? body.uploadTotal : null;

    try {
        srsDb.prepare(`
            INSERT INTO srs_signatures (signatureId, signatureString, uploadCurrent, uploadTotal, createdAt)
            VALUES (?, ?, ?, ?, ?)
        `).run(signatureId, signatureString, uploadCurrent, uploadTotal, nowIso());

        return res.json({
            transactionId: signatureId,
            message: "Signature accepted",
            responseCode: "00"
        });
    } catch (err) {
        return res.json({
            transactionId: signatureId,
            message: "Failed to save signature",
            responseCode: "01"
        });
    }
});

router.post("/api/license", (req, res) => {
    const body = req.body;
    const otp = isObjectBody(body) && body.Otp != null ? String(body.Otp) : "";
    const content = isObjectBody(body) && body.Content != null ? String(body.Content) : "";

    try {
        srsDb.prepare(`
            INSERT INTO srs_licenses (otp, content, createdAt)
            VALUES (?, ?, ?)
        `).run(otp, content, nowIso());
    } catch (err) {
        return res.json({
            responseCode: "01",
            description: "Failed to save license",
            data: ""
        });
    }

    return res.json({
        responseCode: "00",
        description: "OK",
        data: "MOCK-LICENSE"
    });
});

router.get("/api/srs/transactions", (req, res) => {
    try {
        const rows = srsDb.prepare(`
            SELECT transactionId, deviceId, approvalCode, code, version, receiptJson, createdAt
            FROM srs_transactions
            ORDER BY id DESC
        `).all();

        const transactions = rows.map(function (row) {
            const receipt = parseReceiptJson(row.receiptJson);

            return {
                transactionId: row.transactionId,
                deviceId: row.deviceId,
                approvalCode: row.approvalCode,
                code: row.code,
                version: row.version,
                createdAt: row.createdAt,
                merchantName: receipt && receipt.merchantName != null ? receipt.merchantName : "",
                terminalId: receipt && receipt.terminalId != null ? receipt.terminalId : "",
                transactionType: receipt && receipt.transactionType != null ? receipt.transactionType : "",
                totalAmount: receipt && receipt.totalAmount != null ? receipt.totalAmount : "",
                receipt: receipt
            };
        });

        res.json(transactions);
    } catch (err) {
        res.status(500).json({ error: "Failed to read transactions" });
    }
});

router.get("/api/srs/clients", (req, res) => {
    try {
        const rows = srsDb.prepare(`
            SELECT deviceId, serial, encryptingKey, macingKey, expiredDate, code, createdAt
            FROM srs_clients
            ORDER BY createdAt DESC
        `).all();

        const clients = rows.map(function (row) {
            return {
                deviceId: row.deviceId,
                serial: row.serial,
                expiredDate: row.expiredDate,
                code: row.code,
                createdAt: row.createdAt,
                keysMasked: true
            };
        });

        res.json(clients);
    } catch (err) {
        res.status(500).json({ error: "Failed to read clients" });
    }
});

module.exports = router;
