const crypto = require("crypto");
const express = require("express");
const qrDb = require("./db");

const router = express.Router();

function nowIso() {
    return new Date().toISOString();
}

function padTime(value, width) {
    return String(value).padStart(width, "0");
}

function formatServerTime(date) {
    const shifted = new Date(date.getTime() + (7 * 60 * 60 * 1000));

    return padTime(shifted.getUTCHours(), 2) + ":" +
        padTime(shifted.getUTCMinutes(), 2) + ":" +
        padTime(shifted.getUTCSeconds(), 2) + " " +
        padTime(shifted.getUTCDate(), 2) + "/" +
        padTime(shifted.getUTCMonth() + 1, 2) + "/" +
        shifted.getUTCFullYear();
}

function isObjectBody(body) {
    return body !== null && typeof body === "object" && !Array.isArray(body);
}

function asString(value) {
    if (value == null) {
        return "";
    }

    return String(value);
}

function asAmount(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
        return Math.trunc(value);
    }

    if (typeof value === "string" && value.trim() !== "") {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
            return Math.trunc(parsed);
        }
    }

    return 0;
}

function mockChecksum(seed) {
    return crypto.createHash("md5").update(String(seed)).digest("hex").toUpperCase();
}

function generatePaymentRef() {
    return "QRP" + Date.now().toString(10) + crypto.randomBytes(3).toString("hex").toUpperCase();
}

const MOCK_ACCESS_TOKEN = "mock-vcb-qr-access-token";

function generateAccessToken() {
    return crypto.randomBytes(24).toString("hex");
}

function ensureMockToken() {
    const expiresAt = Math.floor(Date.now() / 1000) + (10 * 365 * 24 * 60 * 60);

    qrDb.prepare(`
        INSERT INTO qr_tokens (accessToken, clientId, expiresAt, createdAt)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(accessToken) DO UPDATE SET
            expiresAt = excluded.expiresAt
    `).run(MOCK_ACCESS_TOKEN, "mock-vcb", expiresAt, nowIso());
}

ensureMockToken();

function buildMockQrPayload(paymentRef, amount, billNumber) {
    return "MOCKQR|" + paymentRef + "|" + amount + "|" + billNumber;
}

function getBearerToken(req) {
    const header = req.get("authorization") || req.get("Authorization") || "";
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());

    if (!match) {
        return "";
    }

    return match[1].trim();
}

function requireValidToken(req, res) {
    const token = getBearerToken(req);

    if (token === "") {
        res.status(403).json({
            code: "403",
            message: "Missing bearer token"
        });
        return null;
    }

    try {
        const row = qrDb.prepare(`
            SELECT accessToken, expiresAt
            FROM qr_tokens
            WHERE accessToken = ?
        `).get(token);

        if (!row) {
            res.status(403).json({
                code: "403",
                message: "Invalid token"
            });
            return null;
        }

        if (row.expiresAt <= Math.floor(Date.now() / 1000)) {
            res.status(403).json({
                code: "403",
                message: "Token expired"
            });
            return null;
        }

        return token;
    } catch (err) {
        res.status(500).json({
            code: "96",
            message: "Failed to validate token"
        });
        return null;
    }
}

function mapPayment(row) {
    let request = null;

    try {
        request = JSON.parse(row.requestJson);
    } catch (err) {
        request = null;
    }

    return {
        paymentRef: row.paymentRef,
        requestId: row.requestId,
        partnerCode: row.partnerCode,
        mid: row.mid,
        tid: row.tid,
        billNumber: row.billNumber,
        billInfo: row.billInfo,
        amount: row.amount,
        payType: row.payType,
        qrPayload: row.qrPayload,
        payStatus: row.payStatus,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        request: request
    };
}

router.post("/api/acqhub/v2/oauth/token", (req, res) => {
    const body = req.body || {};
    const grantType = asString(body.grant_type).trim() || "client_credentials";
    const clientId = asString(body.client_id).trim();
    const clientSecret = asString(body.client_secret).trim();

    console.log("QR token request", grantType, clientId ? "clientId=set" : "clientId=empty");

    if (clientId === "" || clientSecret === "") {
        return res.status(400).json({
            error: "invalid_client",
            error_description: "client_id and client_secret are required"
        });
    }

    const accessToken = generateAccessToken();
    const expiresIn = 3600;
    const expiresAt = Math.floor(Date.now() / 1000) + expiresIn;
    const createdAt = nowIso();

    try {
        qrDb.prepare(`
            INSERT INTO qr_tokens (accessToken, clientId, expiresAt, createdAt)
            VALUES (?, ?, ?, ?)
        `).run(accessToken, clientId, expiresAt, createdAt);
    } catch (err) {
        return res.status(500).json({
            error: "server_error",
            error_description: "Failed to save token"
        });
    }

    return res.json({
        access_token: accessToken,
        token_type: "Bearer",
        expires_in: String(expiresIn),
        ".issued": createdAt,
        ".expires": new Date(expiresAt * 1000).toISOString()
    });
});

router.post("/api/acqhub/payment/partner/v2/:partnerCode/initialize", (req, res) => {
    if (!requireValidToken(req, res)) {
        return;
    }

    const body = req.body;
    const partnerCode = asString(req.params.partnerCode).trim();

    if (!isObjectBody(body)) {
        return res.status(400).json({
            code: "96",
            message: "Invalid request body"
        });
    }

    const requestId = asString(body.requestId).trim() || (crypto.randomUUID().toUpperCase() + ".0");
    const mid = asString(body.mid).trim();
    const tid = asString(body.tid).trim();
    const billNumber = asString(body.billNumber).trim();
    const billInfo = asString(body.billInfo);
    const amount = asAmount(body.amount);
    const payType = asString(body.payType).trim() || "QRPOS";
    const paymentRef = generatePaymentRef();
    const qrPayload = buildMockQrPayload(paymentRef, amount, billNumber || paymentRef);
    const serverTime = formatServerTime(new Date());
    const createdAt = nowIso();

    console.log("QR initialize", partnerCode, mid, tid, amount, billNumber);

    try {
        qrDb.prepare(`
            INSERT INTO qr_payments (
                paymentRef, requestId, partnerCode, mid, tid, billNumber, billInfo,
                amount, payType, qrPayload, payStatus, requestJson, createdAt, updatedAt
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            paymentRef,
            requestId,
            partnerCode || asString(body.partnerCode).trim(),
            mid,
            tid,
            billNumber,
            billInfo,
            amount,
            payType,
            qrPayload,
            "1",
            JSON.stringify(body),
            createdAt,
            createdAt
        );
    } catch (err) {
        console.log("QR initialize insert failed", err.message);
        return res.status(500).json({
            code: "96",
            message: "Failed to save payment"
        });
    }

    return res.json({
        code: "00",
        message: "Success",
        subCode: "00",
        subMessage: "Success",
        requestId: requestId,
        serverTime: serverTime,
        operation: "INITIALIZE",
        nodeIn: "MOCK",
        nodeOut: "MOCK",
        mid: mid,
        tid: tid,
        billNumber: billNumber,
        amount: amount,
        qrPayload: qrPayload,
        paymentRef: paymentRef,
        paymentName: "QR Mock Payment",
        paymentUrl: "",
        qrUrl: "",
        checksum: mockChecksum(paymentRef + "|" + requestId + "|" + amount)
    });
});

router.post("/api/acqhub/payment/partner/v2/:partnerCode/inquiry", (req, res) => {
    if (!requireValidToken(req, res)) {
        return;
    }

    const body = req.body;
    const partnerCode = asString(req.params.partnerCode).trim();

    if (!isObjectBody(body)) {
        return res.status(400).json({
            code: "96",
            message: "Invalid request body"
        });
    }

    const paymentRef = asString(body.paymentRef).trim();
    const billNumber = asString(body.billNumber).trim();
    const requestId = asString(body.requestId).trim() || (crypto.randomUUID().toUpperCase() + ".0");
    const amount = asAmount(body.amount);

    console.log("QR inquiry", partnerCode, paymentRef, billNumber);

    let row = null;

    try {
        if (paymentRef !== "") {
            row = qrDb.prepare(`
                SELECT paymentRef, requestId, partnerCode, mid, tid, billNumber, billInfo,
                       amount, payType, qrPayload, payStatus, requestJson, createdAt, updatedAt
                FROM qr_payments
                WHERE paymentRef = ?
            `).get(paymentRef);
        }

        if (!row && billNumber !== "") {
            row = qrDb.prepare(`
                SELECT paymentRef, requestId, partnerCode, mid, tid, billNumber, billInfo,
                       amount, payType, qrPayload, payStatus, requestJson, createdAt, updatedAt
                FROM qr_payments
                WHERE billNumber = ?
                ORDER BY id DESC
                LIMIT 1
            `).get(billNumber);
        }
    } catch (err) {
        return res.status(500).json({
            code: "96",
            message: "Failed to read payment"
        });
    }

    if (!row) {
        return res.json({
            code: "01",
            message: "Payment not found",
            subCode: "01",
            subMessage: "Payment not found",
            requestId: requestId,
            serverTime: formatServerTime(new Date()),
            operation: "INQUIRY",
            nodeIn: "MOCK",
            nodeOut: "MOCK",
            amount: amount,
            payStatus: "0",
            payDesc: "NOT_FOUND",
            payRef: paymentRef,
            checksum: mockChecksum(requestId + "|NOT_FOUND")
        });
    }

    const responseAmount = row.amount != null ? row.amount : amount;
    const payRef = row.paymentRef;
    const serverTime = formatServerTime(new Date());
    const txnTime = nowIso();
    const outcome = inquiryOutcome(row.payStatus);

    return res.json({
        code: outcome.code,
        message: outcome.message,
        subCode: outcome.code,
        subMessage: outcome.message,
        requestId: requestId,
        serverTime: serverTime,
        operation: "INQUIRY",
        nodeIn: "MOCK",
        nodeOut: "MOCK",
        mobile: "",
        debitAccountNo: "",
        debitAccountCurrency: "VND",
        debitAccountName: "",
        creditAccountNo: "",
        creditAccountCurrency: "VND",
        creditAccountName: "",
        payRef: payRef,
        txnDate: txnTime,
        remark: outcome.remark,
        amount: responseAmount,
        tid: row.tid,
        billNumber: row.billNumber,
        mid: row.mid,
        partnerRefId: payRef,
        teller: "",
        sequence: "",
        postingDate: txnTime.substring(0, 10),
        pcTime: txnTime,
        costCenter: "",
        addData: null,
        payStatus: outcome.payStatus,
        payDesc: outcome.payDesc,
        checksum: mockChecksum(payRef + "|" + requestId + "|" + responseAmount + "|" + outcome.payStatus)
    });
});

const PAY_STATUSES = [
    { payStatus: "0", payDesc: "Giao dịch đã hủy", group: "stop" },
    { payStatus: "1", payDesc: "Khởi tạo thanh toán", group: "poll" },
    { payStatus: "2", payDesc: "Chờ thanh toán", group: "poll" },
    { payStatus: "3", payDesc: "Chờ thanh toán", group: "poll" },
    { payStatus: "33", payDesc: "Hệ thống đang xử lý", group: "poll" },
    { payStatus: "4", payDesc: "Hạch toán thành công, chờ báo có", group: "success" },
    { payStatus: "5", payDesc: "Hạch toán và báo có thành công", group: "success" },
    { payStatus: "55", payDesc: "Hạch toán và báo có thành công", group: "stop" },
    { payStatus: "6", payDesc: "Hạch toán thành công, báo có thất bại, chờ đối soát", group: "stop" },
    { payStatus: "7", payDesc: "Báo có nhận kết quả tường minh, tự động hoàn tiền thành công", group: "stop" },
    { payStatus: "71", payDesc: "Báo có nhận kết quả tường minh, tự động hoàn tiền thất bại", group: "stop" },
    { payStatus: "8", payDesc: "Hết hạn thanh toán", group: "stop" },
    { payStatus: "9", payDesc: "Hủy thanh toán", group: "stop" },
    { payStatus: "10", payDesc: "Hạch toán thành công, kiểm tra thông tin trước khi báo có thất bại", group: "stop" },
    { payStatus: "99", payDesc: "Trạng thái giao dịch chưa xác định", group: "stop" },
    { payStatus: "08", payDesc: "Trạng thái giao dịch chưa xác định", group: "stop" },
    { payStatus: "I.RF", payDesc: "Khởi tạo giao dịch hoàn tiền toàn phần thành công, chờ xử lý", group: "stop" },
    { payStatus: "I.PRF", payDesc: "Khởi tạo giao dịch hoàn tiền một phần thành công, chờ xử lý", group: "stop" },
    { payStatus: "S.RF", payDesc: "Giao dịch hoàn tiền toàn phần đã được xử lý thành công", group: "stop" },
    { payStatus: "S.PRF", payDesc: "Giao dịch hoàn tiền một phần đã được xử lý thành công", group: "stop" },
    { payStatus: "F.RF", payDesc: "Giao dịch hoàn tiền toàn phần đã được xử lý thất bại", group: "stop" },
    { payStatus: "F.PRF", payDesc: "Giao dịch hoàn tiền một phần đã được xử lý thất bại", group: "stop" },
    { payStatus: "U.RF", payDesc: "Giao dịch hoàn tiền toàn phần tình trạng chưa xác định", group: "stop" },
    { payStatus: "U.PRF", payDesc: "Giao dịch hoàn tiền một phần tình trạng chưa xác định", group: "stop" }
];

function findPayStatus(payStatus) {
    return PAY_STATUSES.find(function (item) {
        return item.payStatus === payStatus;
    }) || null;
}

function inquiryOutcome(payStatus) {
    const known = findPayStatus(payStatus);
    const status = known ? known.payStatus : asString(payStatus);
    const payDesc = known ? known.payDesc : "UNKNOWN";
    let message = payDesc;

    if (known && known.group === "success") {
        message = "Success";
    } else if (known && known.group === "poll") {
        message = "Pending";
    }

    return {
        code: "00",
        message: message,
        payStatus: status,
        payDesc: payDesc,
        remark: "MOCK " + payDesc
    };
}

function mapToken(row) {
    const now = Math.floor(Date.now() / 1000);

    return {
        accessToken: row.accessToken,
        clientId: row.clientId,
        expiresAt: row.expiresAt,
        expiresAtIso: new Date(row.expiresAt * 1000).toISOString(),
        createdAt: row.createdAt,
        expired: row.expiresAt <= now
    };
}

router.get("/api/qr/tokens", (req, res) => {
    try {
        const rows = qrDb.prepare(`
            SELECT accessToken, clientId, expiresAt, createdAt
            FROM qr_tokens
            ORDER BY createdAt DESC
        `).all();

        res.json(rows.map(mapToken));
    } catch (err) {
        res.status(500).json({ error: "Failed to read tokens" });
    }
});

router.get("/api/qr/payments", (req, res) => {
    try {
        const rows = qrDb.prepare(`
            SELECT paymentRef, requestId, partnerCode, mid, tid, billNumber, billInfo,
                   amount, payType, qrPayload, payStatus, requestJson, createdAt, updatedAt
            FROM qr_payments
            ORDER BY id DESC
        `).all();

        res.json(rows.map(mapPayment));
    } catch (err) {
        res.status(500).json({ error: "Failed to read payments" });
    }
});

router.get("/api/qr/pay-statuses", (req, res) => {
    res.json(PAY_STATUSES);
});

router.post("/api/qr/payments/:paymentRef/result", (req, res) => {
    const paymentRef = asString(req.params.paymentRef).trim();
    const payStatus = asString(req.body && req.body.payStatus).trim();

    if (paymentRef === "") {
        return res.status(400).json({ error: "paymentRef is required" });
    }

    if (!findPayStatus(payStatus)) {
        return res.status(400).json({ error: "Unknown payStatus" });
    }

    const updatedAt = nowIso();

    try {
        const updated = qrDb.prepare(`
            UPDATE qr_payments
            SET payStatus = ?, updatedAt = ?
            WHERE paymentRef = ?
        `).run(payStatus, updatedAt, paymentRef);

        if (updated.changes === 0) {
            return res.status(404).json({ error: "Payment not found" });
        }

        const row = qrDb.prepare(`
            SELECT paymentRef, requestId, partnerCode, mid, tid, billNumber, billInfo,
                   amount, payType, qrPayload, payStatus, requestJson, createdAt, updatedAt
            FROM qr_payments
            WHERE paymentRef = ?
        `).get(paymentRef);

        res.json(mapPayment(row));
    } catch (err) {
        res.status(500).json({ error: "Failed to update payment" });
    }
});

router.get("/api/qr/payments/:paymentRef", (req, res) => {
    const paymentRef = asString(req.params.paymentRef).trim();

    if (paymentRef === "") {
        return res.status(400).json({ error: "paymentRef is required" });
    }

    try {
        const row = qrDb.prepare(`
            SELECT paymentRef, requestId, partnerCode, mid, tid, billNumber, billInfo,
                   amount, payType, qrPayload, payStatus, requestJson, createdAt, updatedAt
            FROM qr_payments
            WHERE paymentRef = ?
        `).get(paymentRef);

        if (!row) {
            return res.status(404).json({ error: "Payment not found" });
        }

        res.json(mapPayment(row));
    } catch (err) {
        res.status(500).json({ error: "Failed to read payment" });
    }
});

module.exports = router;
