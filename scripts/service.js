const fs = require("fs");
const path = require("path");
const { spawn, execFileSync } = require("child_process");

const root = path.join(__dirname, "..");
const pidFile = path.join(root, ".server.pid");
const logFile = path.join(root, "server.log");
const PORT = 21501;

function sleep(ms) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function isRunning(pid) {
    if (!Number.isInteger(pid) || pid <= 0) {
        return false;
    }

    try {
        process.kill(pid, 0);
        return true;
    } catch (err) {
        return err.code === "EPERM";
    }
}

function readPidFile() {
    if (!fs.existsSync(pidFile)) {
        return null;
    }

    const pid = Number(fs.readFileSync(pidFile, "utf8").trim());

    if (!Number.isInteger(pid) || pid <= 0) {
        return null;
    }

    return pid;
}

function writePidFile(pid) {
    fs.writeFileSync(pidFile, String(pid));
}

function removePidFile() {
    if (fs.existsSync(pidFile)) {
        fs.unlinkSync(pidFile);
    }
}

function pidListeningOn(port) {
    let output = "";

    try {
        output = execFileSync("netstat", ["-ano"], { encoding: "utf8" });
    } catch (err) {
        return null;
    }

    const lines = output.split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
        const parts = lines[i].trim().split(/\s+/);

        if (parts[0] !== "TCP" || parts[3] !== "LISTENING") {
            continue;
        }

        const localAddress = parts[1] || "";
        const pid = Number(parts[parts.length - 1]);

        if (localAddress.endsWith(":" + port) && Number.isInteger(pid) && pid > 0) {
            return pid;
        }
    }

    return null;
}

function runningServicePid() {
    const fromFile = readPidFile();

    if (isRunning(fromFile)) {
        return fromFile;
    }

    const listening = pidListeningOn(PORT);

    if (isRunning(listening)) {
        writePidFile(listening);
        return listening;
    }

    removePidFile();
    return null;
}

function waitForStart(pid) {
    const deadline = Date.now() + 8000;

    while (Date.now() < deadline) {
        if (!isRunning(pid)) {
            return "exited";
        }

        if (fs.existsSync(logFile) && fs.readFileSync(logFile, "utf8").includes("API server running")) {
            return "ready";
        }

        sleep(200);
    }

    return "timeout";
}

function start() {
    const existing = runningServicePid();

    if (existing) {
        console.log("Service already running (PID " + existing + ")");
        console.log("http://localhost:" + PORT);
        return;
    }

    const logFd = fs.openSync(logFile, "w");
    const child = spawn(process.execPath, ["server.js"], {
        cwd: root,
        detached: true,
        windowsHide: true,
        stdio: ["ignore", logFd, logFd]
    });

    child.unref();
    fs.closeSync(logFd);
    writePidFile(child.pid);

    const result = waitForStart(child.pid);
    const logText = fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8").trim() : "";

    if (result !== "ready") {
        removePidFile();
        console.log("Service failed to start");

        if (logText !== "") {
            console.log(logText);
        }

        process.exitCode = 1;
        return;
    }

    console.log("Service started (PID " + child.pid + ")");
    console.log(logText);
    console.log("Log: " + logFile);
}

function restartAfter(oldPid) {
    const pid = Number(oldPid);
    const deadline = Date.now() + 8000;

    while (Date.now() < deadline && (isRunning(pid) || pidListeningOn(PORT))) {
        sleep(200);
    }

    removePidFile();
    start();
}

function stop() {
    const pid = runningServicePid();

    if (!pid) {
        console.log("Service is not running");
        return;
    }

    try {
        process.kill(pid);
    } catch (err) {
        if (err.code === "ESRCH") {
            removePidFile();
            console.log("Service is not running");
            return;
        }

        throw err;
    }

    const deadline = Date.now() + 5000;

    while (Date.now() < deadline && isRunning(pid)) {
        sleep(100);
    }

    removePidFile();
    console.log("Service stopped (PID " + pid + ")");
}

const command = process.argv[2];

if (command === "start") {
    start();
} else if (command === "stop") {
    stop();
} else if (command === "restart-after") {
    restartAfter(process.argv[3]);
} else {
    console.log("Usage: node scripts/service.js start|stop");
    process.exitCode = 1;
}
