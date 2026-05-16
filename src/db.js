const sqlite3 = require('sqlite3').verbose();
const log = require('electron-log');

let db;

function initDatabase(dbPath) {
    return new Promise((resolve, reject) => {
        db = new sqlite3.Database(dbPath, (err) => {
            if (err) {
                log.error('Failed to connect to database', err);
                return reject(err);
            }
            log.info(`Connected to SQLite database at ${dbPath}`);
            
            // Create necessary tables if they don't exist
            db.serialize(() => {
                db.run(`CREATE TABLE IF NOT EXISTS mapped_signals (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    label TEXT,
                    type TEXT,
                    ip TEXT,
                    port INTEGER,
                    register INTEGER
                )`);

                db.run(`CREATE TABLE IF NOT EXISTS device_registry (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    display_name TEXT,
                    ip TEXT,
                    port INTEGER
                )`);

                // Insert a mock signal if empty (for demo purposes)
                db.get("SELECT COUNT(*) as count FROM mapped_signals", (err, row) => {
                    if (!err && row.count === 0) {
                        db.run(`INSERT INTO mapped_signals (label, type, ip, port, register) 
                                VALUES ('AO-05', 'analog-out', '192.168.1.100', 502, 100)`, (err) => {
                            resolve();
                        });
                    } else {
                        resolve();
                    }
                });
            });
        });
    });
}

function closeDatabase() {
    if (db) {
        db.close();
    }
}

function getMappedSignals() {
    return new Promise((resolve, reject) => {
        if (!db) return resolve([]);
        db.all("SELECT * FROM mapped_signals", (err, rows) => {
            if (err) {
                log.error("Error fetching signals", err);
                resolve([]);
            } else {
                resolve(rows);
            }
        });
    });
}

function getDevices() {
    return new Promise((resolve, reject) => {
        if (!db) return resolve([]);
        db.all("SELECT * FROM device_registry", (err, rows) => {
            if (err) {
                log.error("Error fetching devices", err);
                resolve([]);
            } else {
                resolve(rows);
            }
        });
    });
}

function addDevice(device) {
    return new Promise((resolve, reject) => {
        const { display_name, ip, port } = device;
        db.run(
            "INSERT INTO device_registry (display_name, ip, port) VALUES (?, ?, ?)",
            [display_name, ip, port],
            function (err) {
                if (err) {
                    log.error("Error adding device", err);
                    resolve({ success: false, error: err.message });
                } else {
                    resolve({ success: true, id: this.lastID });
                }
            }
        );
    });
}

function updateDevice(device) {
    return new Promise((resolve, reject) => {
        const { id, display_name, ip, port } = device;
        db.run(
            "UPDATE device_registry SET display_name = ?, ip = ?, port = ? WHERE id = ?",
            [display_name, ip, port, id],
            function (err) {
                if (err) {
                    log.error("Error updating device", err);
                    resolve({ success: false, error: err.message });
                } else {
                    resolve({ success: true, changes: this.changes });
                }
            }
        );
    });
}

function deleteDevice(id) {
    return new Promise((resolve, reject) => {
        db.run("DELETE FROM device_registry WHERE id = ?", [id], function (err) {
            if (err) {
                log.error("Error deleting device", err);
                resolve({ success: false, error: err.message });
            } else {
                resolve({ success: true, changes: this.changes });
            }
        });
    });
}

module.exports = {
    initDatabase,
    closeDatabase,
    getMappedSignals,
    getDevices,
    addDevice,
    updateDevice,
    deleteDevice
};
