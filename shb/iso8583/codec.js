const FIELDS = {
    2: { type: "llnum" },
    3: { type: "bcd", len: 6 },
    4: { type: "bcd", len: 12 },
    5: { type: "bcd", len: 12 },
    6: { type: "bcd", len: 12 },
    7: { type: "bcd", len: 10 },
    8: { type: "bcd", len: 8 },
    9: { type: "bcd", len: 8 },
    10: { type: "bcd", len: 8 },
    11: { type: "bcd", len: 6 },
    12: { type: "bcd", len: 6 },
    13: { type: "bcd", len: 4 },
    14: { type: "bcd", len: 4 },
    15: { type: "bcd", len: 4 },
    16: { type: "bcd", len: 4 },
    17: { type: "bcd", len: 4 },
    18: { type: "bcd", len: 4 },
    19: { type: "bcd", len: 3, pad: true },
    20: { type: "bcd", len: 3 },
    21: { type: "bcd", len: 3 },
    22: { type: "bcd", len: 3, pad: true },
    23: { type: "bcd", len: 3 },
    24: { type: "bcd", len: 3, pad: true },
    25: { type: "bcd", len: 2 },
    26: { type: "bcd", len: 2 },
    27: { type: "bcd", len: 1 },
    28: { type: "amount", len: 9 },
    29: { type: "amount", len: 9 },
    30: { type: "amount", len: 9 },
    31: { type: "amount", len: 9 },
    32: { type: "llnum" },
    33: { type: "llnum" },
    34: { type: "llchar" },
    35: { type: "llhex" },
    36: { type: "lllchar" },
    37: { type: "char", len: 12 },
    38: { type: "char", len: 6 },
    39: { type: "char", len: 2 },
    40: { type: "char", len: 3 },
    41: { type: "char", len: 8 },
    42: { type: "char", len: 15 },
    43: { type: "char", len: 40 },
    44: { type: "lllchar" },
    45: { type: "llchar" },
    46: { type: "lllchar" },
    47: { type: "lllchar" },
    48: { type: "lllchar" },
    49: { type: "bcd", len: 3, pad: true },
    50: { type: "bcd", len: 3, pad: true },
    51: { type: "bcd", len: 3, pad: true },
    52: { type: "bin", len: 8 },
    53: { type: "bcd", len: 16 },
    54: { type: "lllchar" },
    55: { type: "lllchar" },
    56: { type: "lllchar" },
    57: { type: "lllchar" },
    58: { type: "lllchar" },
    59: { type: "lllchar" },
    60: { type: "lllchar" },
    61: { type: "lllchar" },
    62: { type: "lllchar" },
    63: { type: "lllchar" },
    64: { type: "bin", len: 8 },
    65: { type: "bin", len: 1 },
    66: { type: "bcd", len: 1 },
    67: { type: "bcd", len: 2 },
    68: { type: "bcd", len: 3 },
    69: { type: "bcd", len: 3 },
    70: { type: "bcd", len: 3, pad: true },
    71: { type: "bcd", len: 4 },
    72: { type: "bcd", len: 4 },
    73: { type: "bcd", len: 6 },
    74: { type: "bcd", len: 10 },
    75: { type: "bcd", len: 10 },
    76: { type: "bcd", len: 10 },
    77: { type: "bcd", len: 10 },
    78: { type: "bcd", len: 10 },
    79: { type: "bcd", len: 10 },
    80: { type: "bcd", len: 10 },
    81: { type: "bcd", len: 10 },
    82: { type: "bcd", len: 12 },
    83: { type: "bcd", len: 12 },
    84: { type: "bcd", len: 12 },
    85: { type: "bcd", len: 12 },
    86: { type: "bcd", len: 16 },
    87: { type: "bcd", len: 16 },
    88: { type: "bcd", len: 16 },
    89: { type: "bcd", len: 16 },
    90: { type: "bcd", len: 42 },
    91: { type: "char", len: 1 },
    92: { type: "char", len: 2 },
    93: { type: "char", len: 6 },
    94: { type: "char", len: 7 },
    95: { type: "char", len: 42 },
    96: { type: "bin", len: 16 },
    97: { type: "amount", len: 17 },
    98: { type: "char", len: 25 },
    99: { type: "llnum" },
    100: { type: "llnum" },
    101: { type: "llchar" },
    102: { type: "llchar" },
    103: { type: "llchar" },
    104: { type: "lllascii" },
    105: { type: "lllchar" },
    106: { type: "lllchar" },
    107: { type: "lllchar" },
    108: { type: "lllchar" },
    109: { type: "lllchar" },
    110: { type: "lllchar" },
    111: { type: "lllchar" },
    112: { type: "lllchar" },
    113: { type: "lllchar" },
    114: { type: "lllchar" },
    115: { type: "lllchar" },
    116: { type: "lllchar" },
    117: { type: "lllchar" },
    118: { type: "lllchar" },
    119: { type: "lllchar" },
    120: { type: "lllchar" },
    121: { type: "lllchar" },
    122: { type: "lllchar" },
    123: { type: "lllchar" },
    124: { type: "lllchar" },
    125: { type: "lllchar" },
    126: { type: "lllchar" },
    127: { type: "lllchar" },
    128: { type: "bin", len: 8 }
};

function need(buf, offset, size) {
    if (offset + size > buf.length) {
        throw new Error("ISO message truncated");
    }
}

function digitsToBcd(digits, padLeft) {
    let value = String(digits);

    if (!/^[0-9A-Fa-f]*$/.test(value)) {
        throw new Error("BCD field is not hex digits");
    }

    if (value.length % 2 === 1) {
        value = padLeft ? "0" + value : value + "0";
    }

    return Buffer.from(value, "hex");
}

function readBcdDigits(buf, offset, digitLen, padLeft) {
    const size = Math.ceil(digitLen / 2);
    need(buf, offset, size);
    const hex = buf.subarray(offset, offset + size).toString("hex").toUpperCase();
    const value = digitLen % 2 === 1
        ? (padLeft ? hex.slice(1) : hex.slice(0, digitLen))
        : hex;

    return {
        value: value,
        next: offset + size
    };
}

function readBcdCount(buf, offset, bytes) {
    const read = readBcdDigits(buf, offset, bytes * 2, true);
    const count = Number(read.value);

    if (!Number.isInteger(count) || count < 0) {
        throw new Error("Invalid BCD length");
    }

    return {
        value: count,
        next: read.next
    };
}

function packBcdCount(count, bytes) {
    return digitsToBcd(String(count).padStart(bytes * 2, "0"), true);
}

function unpackField(spec, buf, offset) {
    if (spec.type === "bcd") {
        return readBcdDigits(buf, offset, spec.len, spec.pad === true);
    }

    if (spec.type === "char") {
        need(buf, offset, spec.len);
        return {
            value: buf.subarray(offset, offset + spec.len).toString("ascii"),
            next: offset + spec.len
        };
    }

    if (spec.type === "bin") {
        need(buf, offset, spec.len);
        return {
            value: buf.subarray(offset, offset + spec.len).toString("hex").toUpperCase(),
            next: offset + spec.len
        };
    }

    if (spec.type === "amount") {
        need(buf, offset, 1);
        const sign = String.fromCharCode(buf[offset]);
        const digits = (spec.len >> 1) * 2;
        const read = readBcdDigits(buf, offset + 1, digits, true);
        return {
            value: sign + read.value,
            next: read.next
        };
    }

    if (spec.type === "llnum" || spec.type === "llhex") {
        const count = readBcdCount(buf, offset, 1);
        const read = readBcdDigits(buf, count.next, count.value, false);
        return {
            value: read.value,
            next: read.next
        };
    }

    if (spec.type === "llchar") {
        const count = readBcdCount(buf, offset, 1);
        need(buf, count.next, count.value);
        return {
            value: buf.subarray(count.next, count.next + count.value).toString("ascii"),
            next: count.next + count.value
        };
    }

    if (spec.type === "lllchar") {
        const count = readBcdCount(buf, offset, 2);
        need(buf, count.next, count.value);
        return {
            value: buf.subarray(count.next, count.next + count.value).toString("latin1"),
            next: count.next + count.value
        };
    }

    if (spec.type === "lllascii") {
        need(buf, offset, 3);
        const count = Number(buf.subarray(offset, offset + 3).toString("ascii"));

        if (!Number.isInteger(count) || count < 0) {
            throw new Error("Invalid ASCII length");
        }

        need(buf, offset + 3, count);
        return {
            value: buf.subarray(offset + 3, offset + 3 + count).toString("latin1"),
            next: offset + 3 + count
        };
    }

    throw new Error("Unknown field type");
}

function packField(spec, value) {
    const text = value == null ? "" : String(value);

    if (spec.type === "bcd") {
        const digits = text.replace(/\s+/g, "").padStart(spec.len, "0").slice(-spec.len);
        return digitsToBcd(digits, spec.pad === true);
    }

    if (spec.type === "char") {
        return Buffer.from(text.padEnd(spec.len, " ").slice(0, spec.len), "ascii");
    }

    if (spec.type === "bin") {
        const hex = text.replace(/\s+/g, "").padEnd(spec.len * 2, "0").slice(0, spec.len * 2);
        return Buffer.from(hex, "hex");
    }

    if (spec.type === "amount") {
        const sign = text.charAt(0) === "D" ? "D" : "C";
        const digits = text.replace(/^[CD]/, "").padStart((spec.len >> 1) * 2, "0").slice(-((spec.len >> 1) * 2));
        return Buffer.concat([Buffer.from(sign, "ascii"), digitsToBcd(digits, true)]);
    }

    if (spec.type === "llnum" || spec.type === "llhex") {
        const digits = text.replace(/\s+/g, "").toUpperCase();
        return Buffer.concat([
            packBcdCount(digits.length, 1),
            digitsToBcd(digits, false)
        ]);
    }

    if (spec.type === "llchar") {
        const body = Buffer.from(text, "ascii");
        return Buffer.concat([packBcdCount(body.length, 1), body]);
    }

    if (spec.type === "lllchar") {
        const body = Buffer.from(text, "latin1");
        return Buffer.concat([packBcdCount(body.length, 2), body]);
    }

    if (spec.type === "lllascii") {
        const body = Buffer.from(text, "latin1");
        const prefix = String(body.length).padStart(3, "0").slice(-3);
        return Buffer.concat([Buffer.from(prefix, "ascii"), body]);
    }

    throw new Error("Unknown field type");
}

function readBitmap(buf, offset) {
    need(buf, offset, 8);
    const hasSecond = (buf[offset] & 0x80) !== 0;
    const size = hasSecond ? 16 : 8;
    need(buf, offset, size);
    const present = [];

    for (let bit = 1; bit <= size * 8; bit++) {
        const index = offset + Math.floor((bit - 1) / 8);
        const mask = 1 << (7 - ((bit - 1) % 8));

        if ((buf[index] & mask) !== 0 && bit !== 1) {
            present.push(bit);
        }
    }

    return {
        present: present,
        next: offset + size
    };
}

function writeBitmap(fieldNumbers) {
    const maxField = fieldNumbers.reduce(function (max, field) {
        return field > max ? field : max;
    }, 0);
    const size = maxField > 64 ? 16 : 8;
    const bitmap = Buffer.alloc(size);

    if (size === 16) {
        bitmap[0] |= 0x80;
    }

    fieldNumbers.forEach(function (field) {
        if (field < 2 || field > size * 8) {
            return;
        }

        const index = Math.floor((field - 1) / 8);
        const mask = 1 << (7 - ((field - 1) % 8));
        bitmap[index] |= mask;
    });

    return bitmap;
}

function unpack(body) {
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
    const mti = readBcdDigits(buf, 0, 4, true);
    const bitmap = readBitmap(buf, mti.next);
    const fields = {};
    let offset = bitmap.next;

    bitmap.present.forEach(function (field) {
        const spec = FIELDS[field];

        if (!spec) {
            throw new Error("Unsupported ISO field " + field);
        }

        const read = unpackField(spec, buf, offset);
        fields[field] = read.value;
        offset = read.next;
    });

    if (offset !== buf.length) {
        throw new Error("ISO message has trailing bytes");
    }

    return {
        mti: mti.value,
        fields: fields
    };
}

function pack(message) {
    const fields = message.fields || {};
    const numbers = Object.keys(fields)
        .map(function (key) {
            return Number(key);
        })
        .filter(function (field) {
            return field >= 2 && field <= 128 && fields[field] != null && String(fields[field]) !== "";
        })
        .sort(function (left, right) {
            return left - right;
        });
    const parts = [
        digitsToBcd(String(message.mti).padStart(4, "0").slice(-4), true),
        writeBitmap(numbers)
    ];

    numbers.forEach(function (field) {
        const spec = FIELDS[field];

        if (!spec) {
            throw new Error("Unsupported ISO field " + field);
        }

        parts.push(packField(spec, fields[field]));
    });

    return Buffer.concat(parts);
}

function nibbleOk(byte) {
    return (byte >> 4) <= 9 && (byte & 0x0f) <= 9;
}

function bcdLength(buf, offset) {
    if (!nibbleOk(buf[offset]) || !nibbleOk(buf[offset + 1])) {
        return null;
    }

    const length = Number(buf.subarray(offset, offset + 2).toString("hex"));

    if (length < 10 || length > 8192) {
        return null;
    }

    return length;
}

function binaryLength(buf, offset) {
    const length = (buf[offset] << 8) | buf[offset + 1];

    if (length < 10 || length > 8192) {
        return null;
    }

    return length;
}

function looksLikeMti(buf, offset) {
    return offset + 2 <= buf.length && nibbleOk(buf[offset]) && nibbleOk(buf[offset + 1]);
}

function peelTpdu(raw) {
    if (raw.length > 7 && raw[0] === 0x60 && looksLikeMti(raw, 5)) {
        return {
            tpdu: Buffer.from(raw.subarray(0, 5)),
            iso: raw.subarray(5)
        };
    }

    return {
        tpdu: null,
        iso: raw
    };
}

function responseTpdu(tpdu) {
    const out = Buffer.from(tpdu);
    out[1] = tpdu[3];
    out[2] = tpdu[4];
    out[3] = tpdu[1];
    out[4] = tpdu[2];
    return out;
}

function lengthOptions(slice) {
    const options = [];
    const bcd = bcdLength(slice, 0);
    const binary = binaryLength(slice, 0);

    if (bcd != null) {
        options.push({ encoding: "bcd", length: bcd });
    }

    if (binary != null && binary !== bcd) {
        options.push({ encoding: "bin", length: binary });
    }

    return options;
}

function optionUnpacks(slice, option) {
    if (slice.length < 2 + option.length) {
        return false;
    }

    const peeled = peelTpdu(slice.subarray(2, 2 + option.length));
    unpack(peeled.iso);
    return true;
}

function chooseLength(slice) {
    const options = lengthOptions(slice);

    if (options.length === 0) {
        throw new Error("ISO length header is not valid");
    }

    const ready = options.filter(function (option) {
        return slice.length >= 2 + option.length;
    });

    for (let i = 0; i < ready.length; i++) {
        try {
            if (optionUnpacks(slice, ready[i])) {
                return ready[i];
            }
        } catch (err) {
            continue;
        }
    }

    const stillWaiting = options.some(function (option) {
        return slice.length < 2 + option.length;
    });

    if (stillWaiting && ready.length === 0) {
        return null;
    }

    if (ready.length > 0) {
        return ready[0];
    }

    return null;
}

function frame(body, encoding, tpdu) {
    const payload = tpdu ? Buffer.concat([responseTpdu(tpdu), body]) : body;

    if (payload.length > 9999) {
        throw new Error("ISO frame is too long");
    }

    const header = encoding === "bin"
        ? Buffer.from([(payload.length >> 8) & 0xff, payload.length & 0xff])
        : packBcdCount(payload.length, 2);

    return Buffer.concat([header, payload]);
}

function takeFrames(buffer) {
    const frames = [];
    let offset = 0;

    while (buffer.length - offset >= 2) {
        const slice = buffer.subarray(offset);
        const chosen = chooseLength(slice);

        if (!chosen) {
            break;
        }

        if (slice.length < 2 + chosen.length) {
            break;
        }

        const peeled = peelTpdu(slice.subarray(2, 2 + chosen.length));
        frames.push({
            body: peeled.iso,
            tpdu: peeled.tpdu,
            encoding: chosen.encoding
        });
        offset += 2 + chosen.length;
    }

    return {
        frames: frames,
        rest: buffer.subarray(offset)
    };
}

function responseMti(mti) {
    if (!/^\d{4}$/.test(mti)) {
        return "";
    }

    if (mti[2] !== "0" && mti[2] !== "2") {
        return "";
    }

    return mti.slice(0, 2) + "1" + mti[3];
}

module.exports = {
    unpack: unpack,
    pack: pack,
    frame: frame,
    takeFrames: takeFrames,
    responseMti: responseMti
};
