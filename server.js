const path = require("path");
const express = require("express");
const db = require("./db");
const srsApi = require("./srs-api");

const app = express();
const PORT = 21501;

app.use(express.json());

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

app.use(srsApi);

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
        server: "my-pc"
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

app.get("/devices", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "devices.html"));
});

app.get("/srs", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "srs.html"));
});

app.listen({ port: PORT, host: "::", ipv6Only: false }, () => {
    console.log(`API server running at http://localhost:${PORT}`);
    console.log(`LAN: http://10.247.42.215:${PORT}`);
});
