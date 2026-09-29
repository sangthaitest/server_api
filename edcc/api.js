const crypto = require("crypto");
const net = require("net");
const os = require("os");
const express = require("express");
const edccDb = require("./db");

const EDCC_PORT = 21502;
const PING_MS = 20000;
const MAX_LINES = 120;

const router = express.Router();
const clients = [];
const lines = [];
let listening = false;
let listenError = "";
let lastQrKey = "";

function nowIso() {
    return new Date().toISOString();
}

function addLine(dir, text) {
    lines.push({
        at: nowIso(),
        dir: dir,
        text: text
    });

    if (lines.length > MAX_LINES) {
        lines.splice(0, lines.length - MAX_LINES);
    }
}

function lanAddresses() {
    const nets = os.networkInterfaces();
    const ips = [];

    Object.keys(nets).forEach(function (name) {
        (nets[name] || []).forEach(function (netInfo) {
            const family = netInfo.family;
            const ipv4 = family === "IPv4" || family === 4;

            if (ipv4 && !netInfo.internal) {
                ips.push(netInfo.address);
            }
        });
    });

    return ips;
}

function buildFrame(message) {
    const msg = Buffer.from(message, "utf8");
    const frame = Buffer.alloc(5 + msg.length);

    frame[0] = 0x02;
    frame[1] = (msg.length >> 8) & 0xff;
    frame[2] = msg.length & 0xff;
    msg.copy(frame, 3);
    frame[3 + msg.length] = 0x03;

    let lrc = 0;

    for (let i = 1; i <= msg.length + 3; i++) {
        lrc ^= frame[i];
    }

    frame[4 + msg.length] = lrc;
    return frame;
}

function takeFrames(buffer) {
    const frames = [];
    let offset = 0;

    while (buffer.length - offset >= 5) {
        if (buffer[offset] !== 0x02) {
            offset++;
            continue;
        }

        const length = (buffer[offset + 1] << 8) | buffer[offset + 2];
        const total = length + 5;

        if (length < 0 || total > 65535) {
            offset++;
            continue;
        }

        if (buffer.length - offset < total) {
            break;
        }

        const slice = buffer.subarray(offset, offset + total);
        let lrc = 0;

        for (let i = 1; i <= length + 3; i++) {
            lrc ^= slice[i];
        }

        if (slice[3 + length] !== 0x03 || lrc !== slice[total - 1]) {
            offset++;
            continue;
        }

        frames.push(slice.subarray(3, 3 + length).toString("utf8"));
        offset += total;
    }

    return {
        frames: frames,
        rest: Buffer.from(buffer.subarray(offset))
    };
}

function parseFields(message) {
    const data = {};

    String(message).split(";").forEach(function (item) {
        if (item === "") {
            return;
        }

        const index = item.indexOf(":");
        if (index === -1) {
            return;
        }

        const key = item.slice(0, index).replace(/ /g, "_");
        data[key] = item.slice(index + 1);
    });

    return data;
}

function newKey() {
    return crypto.randomBytes(16).toString("hex").toUpperCase();
}

function latestClient() {
    for (let i = clients.length - 1; i >= 0; i--) {
        if (!clients[i].socket.destroyed) {
            return clients[i];
        }
    }

    return null;
}

function sendRaw(client, message) {
    client.socket.write(buildFrame(message));
    addLine("out", client.remote + " " + message);
}

function onMessage(client, message) {
    addLine("in", client.remote + " " + message);
    const fields = parseFields(message);

    if (fields.TXN_TYPE === "0") {
        client.terminalId = fields.REF_ID || "";
        client.serial = fields.SERIAL || "";
        addLine("sys", "POS logon " + client.terminalId + " " + client.serial);
        return;
    }

    const txnCode = fields.TXN_CODE || "";

    if (client.pendingTrigger && txnCode.endsWith("_INIT")) {
        const trigger = client.pendingTrigger;
        clearPending(client);
        sendRaw(client, trigger);
        return;
    }

    if (fields.ERROR) {
        clearPending(client);
        addLine("sys", "POS rejected " + fields.ERROR);
        finishHistory(fields, "failed", message);
    } else if (fields.RESPONSE_CODE) {
        finishHistory(fields, fields.RESPONSE_CODE === "00" ? "success" : "failed", message);
    }

    if (fields.RESPONSE_CODE || fields.ERROR) {
        sendRaw(client, "RECEIVED");
    }
}

function clearPending(client) {
        client.pendingTrigger = "";
        client.pendingKey = "";
        client.holdPing = false;

    if (client.pendingTimer) {
        clearTimeout(client.pendingTimer);
        client.pendingTimer = null;
    }
}

function armTrigger(client, trigger, txnKey) {
    clearPending(client);
    client.pendingTrigger = trigger;
    client.pendingKey = txnKey || "";
    client.holdPing = true;
    client.pendingTimer = setTimeout(function () {
        if (client.pendingTrigger === trigger) {
            addLine("sys", "POS did not accept " + trigger);
            markHistoryFailed(txnKey, "NO_INIT", trigger);
            clearPending(client);
        }
    }, 8000);
}

function recordHistory(client, command) {
    const createdAt = nowIso();

    edccDb.prepare(`
        INSERT INTO edcc_history (
            createdAt, updatedAt, action, amount, invoice, txnKey, terminalId, serial,
            outcome, responseCode, errorCode, txnCode, requestMessage, resultMessage
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        createdAt,
        createdAt,
        command.action,
        command.amount || 0,
        command.invoice || "",
        command.key || "",
        client.terminalId || "",
        client.serial || "",
        "pending",
        "",
        "",
        "",
        command.message,
        ""
    );
}

function finishHistory(fields, outcome, rawMessage) {
    const txnKey = fields.KEY || "";

    if (txnKey === "") {
        return;
    }

    const invoice = fields.INVOICE || "";
    const updatedAt = nowIso();

    if (invoice !== "") {
        edccDb.prepare(`
            UPDATE edcc_history
            SET updatedAt = ?, outcome = ?, responseCode = ?, errorCode = ?, txnCode = ?, resultMessage = ?, invoice = ?
            WHERE txnKey = ? AND outcome = 'pending'
        `).run(
            updatedAt,
            outcome,
            fields.RESPONSE_CODE || "",
            fields.ERROR || "",
            fields.TXN_CODE || "",
            rawMessage || "",
            invoice,
            txnKey
        );
        return;
    }

    edccDb.prepare(`
        UPDATE edcc_history
        SET updatedAt = ?, outcome = ?, responseCode = ?, errorCode = ?, txnCode = ?, resultMessage = ?
        WHERE txnKey = ? AND outcome = 'pending'
    `).run(
        updatedAt,
        outcome,
        fields.RESPONSE_CODE || "",
        fields.ERROR || "",
        fields.TXN_CODE || "",
        rawMessage || "",
        txnKey
    );
}

function markHistoryFailed(txnKey, errorCode, txnCode) {
    if (!txnKey) {
        return;
    }

    edccDb.prepare(`
        UPDATE edcc_history
        SET updatedAt = ?, outcome = 'failed', errorCode = ?, txnCode = ?
        WHERE txnKey = ? AND outcome = 'pending'
    `).run(nowIso(), errorCode, txnCode || "", txnKey);
}

function attachClient(socket) {
    const client = {
        socket: socket,
        remote: socket.remoteAddress + ":" + socket.remotePort,
        terminalId: "",
        serial: "",
        connectedAt: nowIso(),
        buffer: Buffer.alloc(0),
        pendingTrigger: "",
        pendingKey: "",
        holdPing: false,
        pendingTimer: null
    };

    clients.push(client);
    addLine("sys", "POS connected " + client.remote);

    const timer = setInterval(function () {
        if (socket.destroyed) {
            clearInterval(timer);
            return;
        }

        if (client.holdPing) {
            return;
        }

        sendRaw(client, "PING");
    }, PING_MS);

    socket.on("data", function (chunk) {
        client.buffer = Buffer.concat([client.buffer, chunk]);
        const parsed = takeFrames(client.buffer);
        client.buffer = parsed.rest;
        parsed.frames.forEach(function (message) {
            onMessage(client, message);
        });
    });

    socket.on("close", function () {
        clearInterval(timer);
        clearPending(client);
        const index = clients.indexOf(client);

        if (index !== -1) {
            clients.splice(index, 1);
        }

        addLine("sys", "POS disconnected " + client.remote);
    });

    socket.on("error", function (err) {
        addLine("sys", "POS error " + client.remote + " " + err.message);
    });
}

function start() {
    const server = net.createServer(attachClient);

    server.on("error", function (err) {
        listening = false;
        listenError = err.message;
        addLine("sys", "EDCC listen failed " + err.message);
    });

    server.listen(EDCC_PORT, "0.0.0.0", function () {
        listening = true;
        listenError = "";
        addLine("sys", "EDCC listening on 0.0.0.0:" + EDCC_PORT);
    });
}

function asVnd(value) {
    if (typeof value === "number" && Number.isInteger(value) && value > 0) {
        return value;
    }

    if (typeof value === "string" && /^\d+$/.test(value.trim())) {
        const parsed = Number(value.trim());

        if (Number.isSafeInteger(parsed) && parsed > 0) {
            return parsed;
        }
    }

    return 0;
}

function commandMessage(body) {
    const action = body && typeof body.action === "string" ? body.action : "";
    const key = newKey();
    const amount = asVnd(body && body.amount);
    const minor = String(amount * 100);

    if (action === "ping") {
        return { message: "PING" };
    }

    if (action === "sale" || action === "qr") {
        if (amount === 0) {
            return { error: "Amount must be a positive VND integer" };
        }

        const txnType = action === "sale" ? "101" : "121";

        if (action === "qr") {
            lastQrKey = key;
        }

        return {
            action: action,
            amount: amount,
            invoice: "",
            key: key,
            trigger: action === "sale" ? "SALE" : "QRPAYMENT",
            message: "APP:PAYMENT_STD;TXN_TYPE:" + txnType +
                ";AMOUNT:" + minor +
                ";CURRENCY_CODE:704;KEY:" + key + ";SEND:OK"
        };
    }

    if (action === "void") {
        const invoice = body && typeof body.invoice === "string" ? body.invoice.trim() : "";

        if (!/^\d+$/.test(invoice) || amount === 0) {
            return { error: "Void needs invoice and a positive VND amount" };
        }

        return {
            action: "void",
            amount: amount,
            invoice: invoice,
            key: key,
            trigger: "VOID",
            message: "APP:PAYMENT_STD;TXN_TYPE:103;INVOICE:" + invoice +
                ";AMOUNT:" + minor +
                ";CURRENCY_CODE:704;KEY:" + key + ";SEND:OK"
        };
    }

    if (action === "settle") {
        return {
            action: "settle",
            amount: 0,
            invoice: "",
            key: key,
            trigger: "SETTLE",
            message: "APP:PAYMENT_STD;TXN_TYPE:105;KEY:" + key + ";SEND:OK"
        };
    }

    if (action === "inquiry") {
        const qrKey = body && typeof body.qrKey === "string" && body.qrKey.trim() !== ""
            ? body.qrKey.trim()
            : lastQrKey;

        if (qrKey === "" || /[;:]/.test(qrKey)) {
            return { error: "QR key is required" };
        }

        return {
            action: "inquiry",
            amount: 0,
            invoice: "",
            key: key,
            trigger: "INQUIRY_QRPAYMENT",
            message: "APP:PAYMENT_STD;TXN_TYPE:123;QRPAYMENT_KEY:" + qrKey +
                ";KEY:" + key + ";CURRENCY_CODE:704;SEND:OK"
        };
    }

    return { error: "Unknown action" };
}

function mapClient(client) {
    return {
        remote: client.remote,
        terminalId: client.terminalId,
        serial: client.serial,
        connectedAt: client.connectedAt
    };
}

router.get("/api/edcc/state", (req, res) => {
    const client = latestClient();

    res.json({
        port: EDCC_PORT,
        listening: listening,
        listenError: listenError,
        addresses: lanAddresses(),
        pos: client ? mapClient(client) : null,
        lastQrKey: lastQrKey,
        lines: lines
    });
});

router.get("/api/edcc/history", (req, res) => {
    const outcome = typeof req.query.outcome === "string" ? req.query.outcome : "";
    let rows;

    if (outcome === "success" || outcome === "failed" || outcome === "pending") {
        rows = edccDb.prepare(`
            SELECT id, createdAt, updatedAt, action, amount, invoice, txnKey, terminalId, serial,
                   outcome, responseCode, errorCode, txnCode
            FROM edcc_history
            WHERE outcome = ?
            ORDER BY id DESC
        `).all(outcome);
    } else {
        rows = edccDb.prepare(`
            SELECT id, createdAt, updatedAt, action, amount, invoice, txnKey, terminalId, serial,
                   outcome, responseCode, errorCode, txnCode
            FROM edcc_history
            ORDER BY id DESC
        `).all();
    }

    res.json(rows);
});

router.post("/api/edcc/command", (req, res) => {
    const client = latestClient();

    if (!client) {
        return res.status(409).json({ error: "POS is not connected" });
    }

    const command = commandMessage(req.body || {});

    if (command.error) {
        return res.status(400).json({ error: command.error });
    }

    if (command.trigger) {
        recordHistory(client, command);
        armTrigger(client, command.trigger, command.key);
    }

    sendRaw(client, command.message);
    res.json({
        message: command.message,
        key: command.key || "",
        lastQrKey: lastQrKey
    });
});

module.exports = {
    router: router,
    start: start,
    EDCC_PORT: EDCC_PORT
};
