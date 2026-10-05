const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const express = require("express");
const db = require("./db");
const srsApi = require("./srs/api");
const qrApi = require("./qr/api");
const edcc = require("./edcc/api");
const shb = require("./shb/api");

const BOOT_ID = crypto.randomBytes(8).toString("hex");
const LAB_USER = "admin";
const LAB_PASS = "admin";
const SESSION_COOKIE = "lab_session";
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const sessions = new Map();

const app = express();
const PORT = 21501;
const DOWNLOAD_DIR = path.join(__dirname, "download");

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use((req, res, next) => {
    const queryIndex = req.url.indexOf("?");
    const pathPart = queryIndex === -1 ? req.url : req.url.slice(0, queryIndex);
    const query = queryIndex === -1 ? "" : req.url.slice(queryIndex);
    const normalized = pathPart.replace(/\/{2,}/g, "/");

    if (normalized !== pathPart) {
        req.url = normalized + query;
    }

    next();
});

app.use((req, res, next) => {
    const started = Date.now();

    res.on("finish", () => {
        console.log(
            new Date().toISOString(),
            req.method,
            req.originalUrl,
            res.statusCode,
            (Date.now() - started) + "ms",
            getClientIp(req)
        );
    });

    next();
});

app.use(requireLabAuth);
app.use(srsApi);
app.use(qrApi);
app.use(edcc.router);
app.use("/shb/qr", shb.qr.router);
app.use("/shb/iso8583", shb.iso8583.router);
edcc.start();
shb.qr.start(app);
shb.iso8583.start();

function readCookie(req, name) {
    const header = req.headers.cookie || "";
    const parts = header.split(";");

    for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        const index = part.indexOf("=");

        if (index === -1) {
            continue;
        }

        if (part.slice(0, index).trim() === name) {
            return decodeURIComponent(part.slice(index + 1).trim());
        }
    }

    return "";
}

function sameSecret(leftValue, rightValue) {
    const left = Buffer.from(String(leftValue));
    const right = Buffer.from(String(rightValue));

    if (left.length !== right.length) {
        return false;
    }

    return crypto.timingSafeEqual(left, right);
}

function sessionToken(req) {
    const token = readCookie(req, SESSION_COOKIE);

    if (token === "") {
        return "";
    }

    const session = sessions.get(token);

    if (!session) {
        return "";
    }

    if (session.expiresAt <= Date.now()) {
        sessions.delete(token);
        return "";
    }

    return token;
}

function isLabPath(urlPath) {
    return urlPath === "/" || urlPath === "/srs" || urlPath === "/qr" || urlPath === "/edcc" || urlPath === "/history" || urlPath === "/shb/qr" || urlPath === "/shb/iso8583" || urlPath === "/restart" || urlPath.startsWith("/api/srs/") || urlPath.startsWith("/api/qr/") || urlPath.startsWith("/api/edcc/") || urlPath.startsWith("/shb/qr/api/payments") || urlPath.startsWith("/shb/iso8583/api/");
}

function safeNext(value) {
    if (typeof value !== "string" || value.length > 200 || value.includes("\\") || value.includes("//")) {
        return "/srs";
    }

    if (value === "/" || value === "/srs" || value === "/qr" || value === "/edcc" || value === "/history" || value === "/shb/qr" || value === "/shb/iso8583") {
        return value;
    }

    if (/^\/srs\?[A-Za-z0-9._~%=&-]*$/.test(value) || /^\/qr\?[A-Za-z0-9._~%=&-]*$/.test(value) || /^\/edcc\?[A-Za-z0-9._~%=&-]*$/.test(value) || /^\/history\?[A-Za-z0-9._~%=&-]*$/.test(value) || /^\/shb\/qr\?[A-Za-z0-9._~%=&-]*$/.test(value) || /^\/shb\/iso8583\?[A-Za-z0-9._~%=&-]*$/.test(value)) {
        return value;
    }

    return "/srs";
}

function setSessionCookie(res, token) {
    res.setHeader(
        "Set-Cookie",
        SESSION_COOKIE + "=" + encodeURIComponent(token) +
        "; HttpOnly; SameSite=Lax; Path=/; Max-Age=" + Math.floor(SESSION_MS / 1000)
    );
}

function clearSessionCookie(res) {
    res.setHeader(
        "Set-Cookie",
        SESSION_COOKIE + "=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0"
    );
}

function requireLabAuth(req, res, next) {
    if (!isLabPath(req.path)) {
        next();
        return;
    }

    if (sessionToken(req) !== "") {
        next();
        return;
    }

    if (req.path.startsWith("/api/")) {
        res.status(401).json({ error: "Login required" });
        return;
    }

    res.redirect("/login?next=" + encodeURIComponent(req.originalUrl));
}

function findManualApk() {
    if (!fs.existsSync(DOWNLOAD_DIR)) {
        return null;
    }

    const names = fs.readdirSync(DOWNLOAD_DIR).filter((name) => name.toLowerCase().endsWith(".apk"));

    if (names.length === 0) {
        return null;
    }

    names.sort((left, right) => {
        return fs.statSync(path.join(DOWNLOAD_DIR, right)).mtimeMs - fs.statSync(path.join(DOWNLOAD_DIR, left)).mtimeMs;
    });

    const fileName = names[0];
    const filePath = path.join(DOWNLOAD_DIR, fileName);
    const stat = fs.statSync(filePath);

    return {
        fileName: fileName,
        filePath: filePath,
        size: stat.size
    };
}

function sendManualApk(req, res) {
    const query = req.query || {};

    console.log(
        "manual download",
        req.method,
        "tid=" + (query.tid || ""),
        "schemeid=" + (query.schemeid || ""),
        "serial=" + (query.serial || ""),
        "version=" + (query.version || ""),
        "zip=" + (query.zip || ""),
        "finish=" + (query.finish || "")
    );

    if (String(query.finish || "") === "true") {
        res.status(200);
        res.setHeader("Content-Type", "text/plain");
        res.setHeader("Content-Length", "2");
        res.end("ok");
        return;
    }

    const apk = findManualApk();

    if (!apk) {
        res.status(404);
        res.setHeader("Content-Type", "text/plain");
        res.end("APK not found");
        return;
    }

    res.status(200);
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Length", String(apk.size));
    res.setHeader("Content-Disposition", "attachment; filename=\"" + apk.fileName.replace(/"/g, "") + "\"");
    fs.createReadStream(apk.filePath).pipe(res);
}

function getClientIp(req) {
    let ip = req.ip || (req.socket && req.socket.remoteAddress) || "";

    if (ip.startsWith("::ffff:")) {
        ip = ip.substring(7);
    }

    if (ip === "::1") {
        ip = "127.0.0.1";
    }

    return ip;
}

function requireNonEmptyString(value, fieldName) {
    if (typeof value !== "string") {
        return fieldName + " must be a non-empty string";
    }

    if (value.trim() === "") {
        return fieldName + " must be a non-empty string";
    }

    return null;
}

app.get("/api/health", (req, res) => {
    res.json({
        status: "ok",
        server: "my-pc",
        bootId: BOOT_ID
    });
});

app.get("/api/products", (req, res) => {
    try {
        const products = db.prepare("SELECT id, name, price FROM products").all();
        res.json(products);
    } catch (err) {
        res.status(500).json({ error: "Failed to read products" });
    }
});

app.get("/api/products/:id", (req, res) => {
    const idParam = req.params.id;
    const id = Number(idParam);

    if (!Number.isInteger(id) || id < 1 || String(id) !== idParam) {
        return res.status(400).json({ error: "id must be a positive integer" });
    }

    try {
        const product = db.prepare("SELECT id, name, price FROM products WHERE id = ?").get(id);

        if (!product) {
            return res.status(404).json({ error: "Product not found" });
        }

        res.json({ product: product });
    } catch (err) {
        res.status(500).json({ error: "Failed to read product" });
    }
});

app.post("/api/products", (req, res) => {
    const body = req.body;

    if (body === null || typeof body !== "object" || Array.isArray(body)) {
        return res.status(400).json({ error: "Invalid request body" });
    }

    if (Object.prototype.hasOwnProperty.call(body, "id")) {
        return res.status(400).json({ error: "id is not allowed" });
    }

    if (!Object.prototype.hasOwnProperty.call(body, "name") || !Object.prototype.hasOwnProperty.call(body, "price")) {
        return res.status(400).json({ error: "name and price are required" });
    }

    const { name, price } = body;

    if (typeof name !== "string") {
        return res.status(400).json({ error: "name must be a non-empty string" });
    }

    const trimmedName = name.trim();
    if (trimmedName === "") {
        return res.status(400).json({ error: "name must be a non-empty string" });
    }

    if (!Number.isInteger(price) || price < 0) {
        return res.status(400).json({ error: "price must be an integer >= 0" });
    }

    try {
        const result = db.prepare("INSERT INTO products (name, price) VALUES (?, ?)").run(trimmedName, price);
        const product = db.prepare("SELECT id, name, price FROM products WHERE id = ?").get(result.lastInsertRowid);

        if (!product) {
            return res.status(500).json({ error: "Failed to create product" });
        }

        res.status(201).json({
            message: "Product created",
            product: product
        });
    } catch (err) {
        res.status(500).json({ error: "Failed to create product" });
    }
});

app.get("/api/devices", (req, res) => {
    try {
        const devices = db.prepare(`
            SELECT deviceId, manufacturer, model, brand, androidVersion, sdkVersion, appVersion, ipAddress, createdAt, updatedAt
            FROM devices
            ORDER BY updatedAt DESC
        `).all();
        res.json(devices);
    } catch (err) {
        res.status(500).json({ error: "Failed to read devices" });
    }
});

app.post("/api/devices", (req, res) => {
    const body = req.body;

    if (body === null || typeof body !== "object" || Array.isArray(body)) {
        return res.status(400).json({ error: "Invalid request body" });
    }

    const stringFields = ["deviceId", "manufacturer", "model", "brand", "androidVersion", "appVersion"];

    for (let i = 0; i < stringFields.length; i++) {
        const fieldName = stringFields[i];
        const errorMessage = requireNonEmptyString(body[fieldName], fieldName);

        if (errorMessage) {
            return res.status(400).json({ error: errorMessage });
        }
    }

    if (!Number.isInteger(body.sdkVersion)) {
        return res.status(400).json({ error: "sdkVersion must be an integer" });
    }

    const deviceId = body.deviceId.trim();
    const manufacturer = body.manufacturer.trim();
    const model = body.model.trim();
    const brand = body.brand.trim();
    const androidVersion = body.androidVersion.trim();
    const sdkVersion = body.sdkVersion;
    const appVersion = body.appVersion.trim();
    const ipAddress = getClientIp(req);
    const now = new Date().toISOString();

    try {
        const existing = db.prepare("SELECT deviceId FROM devices WHERE deviceId = ?").get(deviceId);

        if (existing) {
            db.prepare(`
                UPDATE devices
                SET manufacturer = ?, model = ?, brand = ?, androidVersion = ?, sdkVersion = ?, appVersion = ?, ipAddress = ?, updatedAt = ?
                WHERE deviceId = ?
            `).run(manufacturer, model, brand, androidVersion, sdkVersion, appVersion, ipAddress, now, deviceId);

            const device = db.prepare(`
                SELECT deviceId, manufacturer, model, brand, androidVersion, sdkVersion, appVersion, ipAddress, createdAt, updatedAt
                FROM devices
                WHERE deviceId = ?
            `).get(deviceId);

            if (!device) {
                return res.status(500).json({ error: "Failed to update device" });
            }

            return res.json({
                message: "Device updated",
                device: device
            });
        }

        db.prepare(`
            INSERT INTO devices (deviceId, manufacturer, model, brand, androidVersion, sdkVersion, appVersion, ipAddress, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(deviceId, manufacturer, model, brand, androidVersion, sdkVersion, appVersion, ipAddress, now, now);

        const device = db.prepare(`
            SELECT deviceId, manufacturer, model, brand, androidVersion, sdkVersion, appVersion, ipAddress, createdAt, updatedAt
            FROM devices
            WHERE deviceId = ?
        `).get(deviceId);

        if (!device) {
            return res.status(500).json({ error: "Failed to create device" });
        }

        res.status(201).json({
            message: "Device created",
            device: device
        });
    } catch (err) {
        res.status(500).json({ error: "Failed to save device" });
    }
});

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/devices", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "devices.html"));
});

app.get("/manual", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "manual.html"));
});

app.get("/api/manual-download", (req, res) => {
    const apk = findManualApk();

    if (!apk) {
        res.json({
            ready: false,
            fileName: "",
            size: 0
        });
        return;
    }

    res.json({
        ready: true,
        fileName: apk.fileName,
        size: apk.size
    });
});

app.all("/loadfile.aspx", sendManualApk);
app.all("/titms/download/loadfile.aspx", sendManualApk);

app.get("/login", (req, res) => {
    if (sessionToken(req) !== "") {
        res.redirect(safeNext(req.query.next));
        return;
    }

    res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.post("/login", (req, res) => {
    const username = req.body && req.body.username;
    const password = req.body && req.body.password;
    const nextUrl = safeNext(req.body && req.body.next);

    if (typeof username !== "string" || typeof password !== "string" || !sameSecret(username, LAB_USER) || !sameSecret(password, LAB_PASS)) {
        res.redirect("/login?error=1&next=" + encodeURIComponent(nextUrl));
        return;
    }

    const token = crypto.randomBytes(24).toString("hex");
    sessions.set(token, { expiresAt: Date.now() + SESSION_MS });
    setSessionCookie(res, token);
    res.redirect(nextUrl);
});

let restarting = false;

function restartPage(nextUrl, bootId) {
    return "<!DOCTYPE html>\n" +
        "<html lang=\"vi\">\n" +
        "<head>\n" +
        "<meta charset=\"UTF-8\">\n" +
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n" +
        "<title>Reset server</title>\n" +
        "<style>\n" +
        "body { font-family: Arial, sans-serif; margin: 24px; color: #222; background: #f7f7f7; }\n" +
        "h1 { margin: 0 0 12px; font-size: 24px; }\n" +
        "p { margin: 0; color: #555; }\n" +
        ".error { color: #b00020; }\n" +
        "</style>\n" +
        "</head>\n" +
        "<body>\n" +
        "<h1>Reset server</h1>\n" +
        "<p id=\"status\">Đang khởi động lại...</p>\n" +
        "<script>\n" +
        "var nextUrl = " + JSON.stringify(nextUrl) + ";\n" +
        "var previousBootId = " + JSON.stringify(bootId) + ";\n" +
        "var started = Date.now();\n" +
        "function fail() {\n" +
        "    var status = document.getElementById(\"status\");\n" +
        "    status.className = \"error\";\n" +
        "    status.textContent = \"Server chưa phản hồi. Thử tải lại trang.\";\n" +
        "}\n" +
        "function ping() {\n" +
        "    if (Date.now() - started > 15000) {\n" +
        "        fail();\n" +
        "        return;\n" +
        "    }\n" +
        "    fetch(\"/api/health\", { cache: \"no-store\" })\n" +
        "        .then(function (response) {\n" +
        "            if (!response.ok) {\n" +
        "                throw new Error(\"down\");\n" +
        "            }\n" +
        "            return response.json();\n" +
        "        })\n" +
        "        .then(function (body) {\n" +
        "            if (!body || body.bootId === previousBootId) {\n" +
        "                setTimeout(ping, 300);\n" +
        "                return;\n" +
        "            }\n" +
        "            document.getElementById(\"status\").textContent = \"Server đã chạy lại.\";\n" +
        "            setTimeout(function () {\n" +
        "                window.location.href = nextUrl;\n" +
        "            }, 400);\n" +
        "        })\n" +
        "        .catch(function () {\n" +
        "            setTimeout(ping, 400);\n" +
        "        });\n" +
        "}\n" +
        "setTimeout(ping, 400);\n" +
        "</script>\n" +
        "</body>\n" +
        "</html>\n";
}

app.post("/restart", (req, res) => {
    const nextUrl = safeNext(req.body && req.body.next);

    if (restarting) {
        res.redirect(nextUrl);
        return;
    }

    restarting = true;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(restartPage(nextUrl, BOOT_ID));

    res.on("finish", () => {
        const child = spawn(process.execPath, [
            path.join(__dirname, "scripts", "service.js"),
            "restart-after",
            String(process.pid)
        ], {
            cwd: __dirname,
            detached: true,
            windowsHide: true,
            stdio: "ignore"
        });

        child.unref();
        setTimeout(() => {
            process.exit(0);
        }, 500);
    });
});

app.get("/logout", (req, res) => {
    const token = readCookie(req, SESSION_COOKIE);

    if (token !== "") {
        sessions.delete(token);
    }

    clearSessionCookie(res);
    res.redirect("/login");
});

app.get("/srs", (req, res) => {
    res.sendFile(path.join(__dirname, "srs", "srs.html"));
});

app.get("/qr", (req, res) => {
    res.sendFile(path.join(__dirname, "qr", "qr.html"));
});

app.get("/edcc", (req, res) => {
    res.sendFile(path.join(__dirname, "edcc", "edcc.html"));
});

app.get("/history", (req, res) => {
    res.sendFile(path.join(__dirname, "edcc", "history.html"));
});

app.get("/shb/qr", (req, res) => {
    res.sendFile(path.join(__dirname, "shb", "qr", "shbvn.html"));
});

app.get("/shb/iso8583", (req, res) => {
    res.sendFile(path.join(__dirname, "shb", "iso8583", "iso8583.html"));
});

app.get("/shbvn", (req, res) => {
    res.redirect("/shb/qr");
});

app.get("/iso8583", (req, res) => {
    res.redirect("/shb/iso8583");
});

app.listen({ port: PORT, host: "::", ipv6Only: false }, () => {
    console.log(`API server running at http://localhost:${PORT}`);
    console.log(`LAN: http://10.247.42.215:${PORT}`);
});
