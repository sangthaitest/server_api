const crypto = require("crypto");

const BRANCH_KEYS = {
    "35": {
        tripleDesKey: "A2021BefCd117268119Fcda0",
        registerKey: "kefowF72dB26blhZlI7lpMwxLWhpFXzl"
    },
    "5": {
        tripleDesKey: "AB1B98A8C5A44CD3AEED452F",
        registerKey: "kefowF72dB26blhZlI7lpMwxLWhpFXzl"
    },
    "10": {
        tripleDesKey: "A9D171C827488A56DF3FC05B",
        registerKey: "kefowF72dB26blhZlI7lpMwxLWhpFXzl"
    },
    "37": {
        tripleDesKey: "VTB",
        registerKey: "kefowF72dB26blhZlI7lpMwxLWhpFXzl"
    },
    "18": {
        tripleDesKey: "5E8D1CF99F684E62B6D5C296",
        registerKey: "kefowF72dB26blhZlI7lpMwxLWhpFXzl"
    },
    "44": {
        tripleDesKey: "A2021bEfCd11F268115fcda9",
        registerKey: "kefowF72dB26blhZlI7lpMwxLWhpFXzl"
    }
};

const DEFAULT_REGISTER_KEY = "kefowF72dB26blhZlI7lpMwxLWhpFXzl";
const V2_IV = Buffer.alloc(8, 0);
const KEY_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

function bytesToHex(buffer) {
    return Buffer.from(buffer).toString("hex").toUpperCase();
}

function hexToBytes(hex) {
    if (typeof hex !== "string" || hex.length === 0 || hex.length % 2 !== 0) {
        throw new Error("Invalid hex string");
    }

    return Buffer.from(hex, "hex");
}

function getBranchKeys(code) {
    const mapped = BRANCH_KEYS[String(code)];

    if (mapped) {
        return {
            tripleDesKey: mapped.tripleDesKey,
            registerKey: mapped.registerKey
        };
    }

    return {
        tripleDesKey: null,
        registerKey: DEFAULT_REGISTER_KEY
    };
}

function padZero(buffer, blockSize) {
    const remainder = buffer.length % blockSize;
    const padding = remainder === 0 ? 0 : blockSize - remainder;
    return Buffer.concat([buffer, Buffer.alloc(padding, 0)]);
}

function padNullAes(buffer) {
    const paddingLength = 16 - (buffer.length % 16);
    return Buffer.concat([buffer, Buffer.alloc(paddingLength, 0)]);
}

function bufferToTrimmedString(buffer) {
    let end = buffer.length;

    while (end > 0 && buffer[end - 1] === 0) {
        end -= 1;
    }

    return buffer.slice(0, end).toString("utf8").trim();
}

function createCipheriv(algorithm, key, iv) {
    const cipher = crypto.createCipheriv(algorithm, key, iv);
    cipher.setAutoPadding(false);
    return cipher;
}

function createDecipheriv(algorithm, key, iv) {
    const decipher = crypto.createDecipheriv(algorithm, key, iv);
    decipher.setAutoPadding(false);
    return decipher;
}

function encrypt3Des(plainText, keyString) {
    const key = Buffer.from(String(keyString), "utf8");
    const padded = padZero(Buffer.from(String(plainText), "utf8"), 8);
    const cipher = createCipheriv("des-ede3-cbc", key, V2_IV);
    return bytesToHex(Buffer.concat([cipher.update(padded), cipher.final()]));
}

function decrypt3Des(hexData, keyString) {
    const key = Buffer.from(String(keyString), "utf8");
    const encrypted = hexToBytes(hexData);
    const decipher = createDecipheriv("des-ede3-cbc", key, V2_IV);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return bufferToTrimmedString(decrypted);
}

function buildAesIvFrom8Bytes(first8Bytes) {
    return crypto.createHash("md5").update(first8Bytes).digest();
}

function generateFirst8BytesIv() {
    return crypto.randomBytes(8);
}

function encryptAesNoPadding(plainBuffer, keyString, iv16) {
    const key = Buffer.from(String(keyString), "utf8");
    const padded = padNullAes(plainBuffer);
    const cipher = createCipheriv("aes-256-cbc", key, iv16);
    return Buffer.concat([cipher.update(padded), cipher.final()]);
}

function decryptAesNoPadding(encryptedBuffer, keyString, iv16) {
    const key = Buffer.from(String(keyString), "utf8");
    const decipher = createDecipheriv("aes-256-cbc", key, iv16);
    return Buffer.concat([decipher.update(encryptedBuffer), decipher.final()]);
}

function wrapV3(plainText, keyString) {
    const first8Bytes = generateFirst8BytesIv();
    const iv16 = buildAesIvFrom8Bytes(first8Bytes);
    const encrypted = encryptAesNoPadding(Buffer.from(String(plainText), "utf8"), keyString, iv16);
    return bytesToHex(first8Bytes) + bytesToHex(encrypted);
}

function unwrapV3(hexData, keyString) {
    if (typeof hexData !== "string" || hexData.length < 16) {
        throw new Error("Invalid v3 data");
    }

    const first8Bytes = hexToBytes(hexData.substring(0, 16));
    const encrypted = hexToBytes(hexData.substring(16));
    const iv16 = buildAesIvFrom8Bytes(first8Bytes);
    return bufferToTrimmedString(decryptAesNoPadding(encrypted, keyString, iv16));
}

function hmacSha256Hex(data, keyString) {
    return crypto.createHmac("sha256", Buffer.from(String(keyString), "utf8"))
        .update(Buffer.from(String(data), "utf8"))
        .digest("hex")
        .toUpperCase();
}

function hmacEquals(left, right) {
    if (typeof left !== "string" || typeof right !== "string") {
        return false;
    }

    const leftBuf = Buffer.from(left.toUpperCase(), "utf8");
    const rightBuf = Buffer.from(right.toUpperCase(), "utf8");

    if (leftBuf.length !== rightBuf.length) {
        return false;
    }

    return crypto.timingSafeEqual(leftBuf, rightBuf);
}

function randomAsciiKey(length) {
    const bytes = crypto.randomBytes(length);
    let result = "";

    for (let i = 0; i < length; i++) {
        result += KEY_CHARS[bytes[i] % KEY_CHARS.length];
    }

    return result;
}

function generateTransactionId() {
    return "SRS" + Date.now().toString(10) + crypto.randomBytes(3).toString("hex").toUpperCase();
}

function parseJsonObject(text) {
    const parsed = JSON.parse(text);

    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("JSON is not an object");
    }

    return parsed;
}

function buildMacSource(receipt, deviceId) {
    const transactionType = receipt.transactionType == null ? "" : String(receipt.transactionType);
    const currentTime = receipt.currentTime == null ? "" : String(receipt.currentTime);
    const approvalCode = receipt.approvalCode == null ? "0" : String(receipt.approvalCode);
    const batchNumber = receipt.batchNumber == null ? "" : String(receipt.batchNumber);
    const id = deviceId == null ? "" : String(deviceId);

    return {
        withApproval: transactionType + "|" + approvalCode + "|" + currentTime + "|" + id,
        withBatch: transactionType + "|" + batchNumber + "|" + currentTime + "|" + id,
        isSettlement: transactionType === "SETTLEMENT"
    };
}

function verifyTransactionMac(receipt, deviceId, macingKey, requestMac) {
    const sources = buildMacSource(receipt, deviceId);
    const macApproval = hmacSha256Hex(sources.withApproval, macingKey);

    if (hmacEquals(macApproval, requestMac)) {
        return true;
    }

    if (sources.isSettlement) {
        const macBatch = hmacSha256Hex(sources.withBatch, macingKey);
        return hmacEquals(macBatch, requestMac);
    }

    return false;
}

module.exports = {
    getBranchKeys,
    encrypt3Des,
    decrypt3Des,
    wrapV3,
    unwrapV3,
    hmacSha256Hex,
    hmacEquals,
    randomAsciiKey,
    generateTransactionId,
    parseJsonObject,
    verifyTransactionMac
};
