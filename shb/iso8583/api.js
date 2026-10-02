const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const net = require("net");
const os = require("os");
const express = require("express");
const isoDb = require("./db");
const codec = require("./codec");

const ISO_PORT = 21500;
const ISO_PORTS = [21500, 21503, 20900, 9999];
const RESPONSE_CODES = {
    "00": "Approved",
    "05": "Do not honor",
    "51": "Insufficient funds",
    "55": "Incorrect PIN",
    "91": "Issuer unavailable"
};

const router = express.Router();
let listening = false;
let listenError = "";

function nowIso() {
    return new Date().toISOString();
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

function responseCode() {
    const row = isoDb.prepare("SELECT value FROM iso_settings WHERE key = ?").get("response_code");
    const code = row && RESPONSE_CODES[row.value] ? row.value : "00";
    return code;
}

function maskPan(pan) {
    const digits = String(pan || "").replace(/\D/g, "");

    if (digits.length < 10) {
        return digits === "" ? "" : "******";
    }

    return digits.slice(0, 6) + "******" + digits.slice(-4);
}

function panFromFields(fields) {
    if (fields[2]) {
        return String(fields[2]);
    }

    const track = fields[35] ? String(fields[35]) : "";
    const separator = track.indexOf("D") >= 0 ? track.indexOf("D") : track.indexOf("=");

    if (separator > 0) {
        return track.slice(0, separator);
    }

    return "";
}

function amountText(value) {
    const digits = String(value || "").replace(/\D/g, "");

    if (digits === "") {
        return "";
    }

    return String(Number(digits));
}

function approvalCode() {
    return String(crypto.randomInt(0, 1000000)).padStart(6, "0");
}

function retrievalReference() {
    return String(Date.now()).slice(-12).padStart(12, "0");
}

function publicFields(fields) {
    const copy = {};

    Object.keys(fields).forEach(function (key) {
        const field = Number(key);

        if (field === 2 || field === 35 || field === 45 || field === 52) {
            return;
        }

        if (field === 55) {
            copy[key] = "len " + String(fields[key] || "").length;
            return;
        }

        copy[key] = fields[key];
    });

    return copy;
}

function saveMessage(row) {
    isoDb.prepare(`
        INSERT INTO iso_messages (
            createdAt, remote, mti, processingCode, amount, panMasked, tid, mid,
            entryMode, responseCode, approvalCode, rrn, detail
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        row.createdAt,
        row.remote,
        row.mti,
        row.processingCode,
        row.amount,
        row.panMasked,
        row.tid,
        row.mid,
        row.entryMode,
        row.responseCode,
        row.approvalCode,
        row.rrn,
        row.detail
    );
}

function fieldText(request, id) {
    const value = request.fields[id];

    if (value == null) {
        return "";
    }

    return String(value).trim();
}

function vietnamNow() {
    return new Date(Date.now() + (7 * 60 * 60 * 1000));
}

function field12Now() {
    const now = vietnamNow();
    const hour = String(now.getUTCHours()).padStart(2, "0");
    const minute = String(now.getUTCMinutes()).padStart(2, "0");
    const second = String(now.getUTCSeconds()).padStart(2, "0");

    return hour + minute + second;
}

function field13Now() {
    const now = vietnamNow();
    const month = String(now.getUTCMonth() + 1).padStart(2, "0");
    const day = String(now.getUTCDate()).padStart(2, "0");

    return month + day;
}

function putField(fields, id, value) {
    if (value != null && String(value) !== "") {
        fields[id] = value;
    }
}

function niiText(request) {
    const nii = fieldText(request, 24).replace(/\D/g, "");

    if (nii === "") {
        return "119";
    }

    return nii.slice(-3).padStart(3, "0");
}

function buildResponse(request) {
    const code = responseCode();
    const processingCode = fieldText(request, 3) || "000000";
    const fields = {};
    const reversal = request.mti === "0400" || request.mti === "0420";

    fields[3] = processingCode;
    fields[4] = fieldText(request, 4) || "000000000000";
    fields[11] = fieldText(request, 11) || "000001";
    fields[24] = niiText(request);
    fields[39] = code;
    fields[41] = (fieldText(request, 41) || "00000001").padEnd(8, " ").slice(0, 8);

    if (!reversal) {
        fields[12] = fieldText(request, 12) || field12Now();
        fields[13] = fieldText(request, 13) || field13Now();
        fields[37] = fieldText(request, 37) || retrievalReference();
        putField(fields, 42, fieldText(request, 42));
        fields[44] = Buffer.alloc(8).toString("latin1");

        if (code === "00") {
            fields[38] = fieldText(request, 38) || approvalCode();

            if (request.mti === "0200" && processingCode.slice(0, 2) === "00") {
                fields[55] = Buffer.from("910880330BBE000400008A023030", "hex").toString("latin1");
            }
        }
    } else {
        fields[64] = "0000000000000000";
    }

    return {
        mti: codec.responseMti(request.mti),
        fields: fields,
        responseCode: code,
        approvalCode: fields[38] || "",
        rrn: fields[37] || ""
    };
}

function handleFrame(remote, incoming) {
    const body = Buffer.isBuffer(incoming) ? incoming : incoming.body;
    const encoding = incoming && incoming.encoding ? incoming.encoding : "bcd";
    const tpdu = incoming && incoming.tpdu ? incoming.tpdu : null;
    let request;

    try {
        request = codec.unpack(body);
    } catch (err) {
        saveMessage({
            createdAt: nowIso(),
            remote: remote,
            mti: "",
            processingCode: "",
            amount: "",
            panMasked: "",
            tid: "",
            mid: "",
            entryMode: "",
            responseCode: "",
            approvalCode: "",
            rrn: "",
            detail: err.message
        });
        console.log("ISO8583 parse error " + remote + " " + err.message);
        return null;
    }

    const replyMti = codec.responseMti(request.mti);

    if (replyMti === "") {
        saveMessage({
            createdAt: nowIso(),
            remote: remote,
            mti: request.mti,
            processingCode: request.fields[3] || "",
            amount: amountText(request.fields[4]),
            panMasked: maskPan(panFromFields(request.fields)),
            tid: String(request.fields[41] || "").trim(),
            mid: String(request.fields[42] || "").trim(),
            entryMode: request.fields[22] || "",
            responseCode: "",
            approvalCode: "",
            rrn: String(request.fields[37] || "").trim(),
            detail: "Ignored response MTI"
        });
        return null;
    }

    const response = buildResponse(request);
    response.mti = replyMti;
    const packed = codec.frame(codec.pack(response), encoding, tpdu);

    saveMessage({
        createdAt: nowIso(),
        remote: remote,
        mti: request.mti,
        processingCode: request.fields[3] || "",
        amount: amountText(request.fields[4]),
        panMasked: maskPan(panFromFields(request.fields)),
        tid: String(request.fields[41] || "").trim(),
        mid: String(request.fields[42] || "").trim(),
        entryMode: request.fields[22] || "",
        responseCode: response.responseCode,
        approvalCode: String(response.approvalCode || "").trim(),
        rrn: String(response.rrn || "").trim(),
        detail: JSON.stringify(publicFields(request.fields))
    });

    console.log(
        "ISO8583",
        remote,
        request.mti,
        "->",
        replyMti,
        response.responseCode,
        String(request.fields[41] || "").trim()
    );

    return packed;
}

function attachClient(socket) {
    const remote = socket.remoteAddress + ":" + socket.remotePort;
    let buffer = Buffer.alloc(0);
    let notedPartial = false;

    console.log("ISO8583 connected " + remote);

    socket.on("data", function (chunk) {
        buffer = Buffer.concat([buffer, chunk]);
        fs.appendFileSync(
            path.join(__dirname, "..", "..", "data", "iso8583.log"),
            nowIso() + " " + remote + " " + chunk.toString("hex") + "\n"
        );

        try {
            const parsed = codec.takeFrames(buffer);
            buffer = Buffer.from(parsed.rest);
            parsed.frames.forEach(function (frame) {
                const reply = handleFrame(remote, frame);

                if (reply) {
                    socket.write(reply);
                }
            });

            if (parsed.frames.length === 0 && buffer.length > 0 && !notedPartial) {
                notedPartial = true;
                saveMessage({
                    createdAt: nowIso(),
                    remote: remote,
                    mti: "",
                    processingCode: "",
                    amount: "",
                    panMasked: "",
                    tid: "",
                    mid: "",
                    entryMode: "",
                    responseCode: "",
                    approvalCode: "",
                    rrn: "",
                    detail: "Đã nhận " + buffer.length + " byte, chưa đủ frame " + buffer.subarray(0, 32).toString("hex")
                });
            }
        } catch (err) {
            saveMessage({
                createdAt: nowIso(),
                remote: remote,
                mti: "",
                processingCode: "",
                amount: "",
                panMasked: "",
                tid: "",
                mid: "",
                entryMode: "",
                responseCode: "",
                approvalCode: "",
                rrn: "",
                detail: err.message
            });
            console.log("ISO8583 frame error " + remote + " " + err.message);
            socket.destroy();
        }
    });

    socket.on("error", function (err) {
        console.log("ISO8583 socket error " + remote + " " + err.message);
    });

    socket.on("close", function () {
        console.log("ISO8583 disconnected " + remote);
    });
}

function start() {
    ISO_PORTS.forEach(function (port) {
        const server = net.createServer(attachClient);

        server.on("error", function (err) {
            listenError = port + " " + err.message;
            console.log("ISO8583 listen error: " + listenError);
        });

        server.listen(port, "0.0.0.0", function () {
            listening = true;
            if (listenError.indexOf(String(port) + " ") === 0) {
                listenError = "";
            }
            console.log("ISO8583 host listening on 0.0.0.0:" + port);
        });
    });
}

router.get("/api/state", (req, res) => {
    const rows = isoDb.prepare(`
        SELECT id, createdAt, remote, mti, processingCode, amount, panMasked, tid, mid,
               entryMode, responseCode, approvalCode, rrn, detail
        FROM iso_messages
        ORDER BY id DESC
        LIMIT 50
    `).all();

    res.json({
        port: ISO_PORT,
        ports: ISO_PORTS,
        listening: listening,
        listenError: listenError,
        addresses: lanAddresses(),
        responseCode: responseCode(),
        messages: rows
    });
});

router.post("/api/response", (req, res) => {
    const code = req.body && typeof req.body.responseCode === "string" ? req.body.responseCode : "";

    if (!RESPONSE_CODES[code]) {
        res.status(400).json({ error: "Response code must be 00, 05, 51, 55, or 91" });
        return;
    }

    isoDb.prepare(`
        INSERT INTO iso_settings (key, value)
        VALUES ('response_code', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(code);

    res.json({ responseCode: code });
});

module.exports = {
    router: router,
    start: start,
    ISO_PORT: ISO_PORT
};
