const crypto = require("crypto");

const SIGNATURE_INIT = "dce619b46c332dca552796be1ad48665aacd6b9b357ab1df24477230ba75a97b";

function encryptTokenSecret(token, secret) {
    const key = Buffer.from(SIGNATURE_INIT, "hex");
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const plaintext = JSON.stringify({ token: token, secret: secret });
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();

    return Buffer.concat([iv, encrypted, tag]).toString("base64");
}

module.exports = {
    encryptTokenSecret: encryptTokenSecret
};
