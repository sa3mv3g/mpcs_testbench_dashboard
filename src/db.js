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
                    read_register INTEGER,
                    encoding TEXT,
                    cal_scale_reg INTEGER,
                    cal_offset_reg INTEGER,
                    cal_deadzone_reg INTEGER
                )`);

                db.run(`CREATE TABLE IF NOT EXISTS device_registry (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    display_name TEXT,
                    ip TEXT,
                    port INTEGER,
                    key1 INTEGER,
                    key2 INTEGER
                )`);

                db.run(`CREATE TABLE IF NOT EXISTS calibration_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                    signal_label TEXT,
                    m_value REAL,
                    c_value REAL,
                    deadzone REAL,
                    data_points TEXT
                )`);

                // Insert a mock signal if empty (for demo purposes)
                db.get("SELECT COUNT(*) as count FROM mapped_signals", (err, row) => {
                    if (!err && row.count === 0) {
                        db.run(`INSERT INTO mapped_signals (label, type, ip, port, read_register, encoding, cal_scale_reg, cal_offset_reg, cal_deadzone_reg) 
                                VALUES ('AO-05', 'analog-out', '192.168.1.100', 502, 100, 'CDAB', 200, 202, 204)`, (err) => {
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

// --- Mapped Signals Operations ---
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

function addMappedSignal(signal) {
    return new Promise((resolve, reject) => {
        const { label, type, ip, port, read_register, encoding, cal_scale_reg, cal_offset_reg, cal_deadzone_reg } = signal;
        db.run(
            `INSERT INTO mapped_signals (label, type, ip, port, read_register, encoding, cal_scale_reg, cal_offset_reg, cal_deadzone_reg) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [label, type, ip, port, read_register, encoding, cal_scale_reg, cal_offset_reg, cal_deadzone_reg],
            function (err) {
                if (err) {
                    log.error("Error adding signal", err);
                    resolve({ success: false, error: err.message });
                } else {
                    resolve({ success: true, id: this.lastID });
                }
            }
        );
    });
}

function updateMappedSignal(signal) {
    return new Promise((resolve, reject) => {
        const { id, label, type, ip, port, read_register, encoding, cal_scale_reg, cal_offset_reg, cal_deadzone_reg } = signal;
        db.run(
            `UPDATE mapped_signals SET label = ?, type = ?, ip = ?, port = ?, read_register = ?, 
             encoding = ?, cal_scale_reg = ?, cal_offset_reg = ?, cal_deadzone_reg = ? WHERE id = ?`,
            [label, type, ip, port, read_register, encoding, cal_scale_reg, cal_offset_reg, cal_deadzone_reg, id],
            function (err) {
                if (err) {
                    log.error("Error updating signal", err);
                    resolve({ success: false, error: err.message });
                } else {
                    resolve({ success: true, changes: this.changes });
                }
            }
        );
    });
}

function deleteMappedSignal(id) {
    return new Promise((resolve, reject) => {
        db.run("DELETE FROM mapped_signals WHERE id = ?", [id], function (err) {
            if (err) {
                log.error("Error deleting signal", err);
                resolve({ success: false, error: err.message });
            } else {
                resolve({ success: true, changes: this.changes });
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
        const { display_name, ip, port, key1, key2 } = device;
        db.run(
            "INSERT INTO device_registry (display_name, ip, port, key1, key2) VALUES (?, ?, ?, ?, ?)",
            [display_name, ip, port, key1, key2],
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
        const { id, display_name, ip, port, key1, key2 } = device;
        db.run(
            "UPDATE device_registry SET display_name = ?, ip = ?, port = ?, key1 = ?, key2 = ? WHERE id = ?",
            [display_name, ip, port, key1, key2, id],
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

function saveCalibrationHistory(history) {
    return new Promise((resolve, reject) => {
        const { signal_label, m_value, c_value, deadzone, data_points } = history;
        db.run(
            "INSERT INTO calibration_history (signal_label, m_value, c_value, deadzone, data_points) VALUES (?, ?, ?, ?, ?)",
            [signal_label, m_value, c_value, deadzone, JSON.stringify(data_points)],
            function (err) {
                if (err) {
                    log.error("Error saving calibration history", err);
                    resolve({ success: false, error: err.message });
                } else {
                    resolve({ success: true, id: this.lastID });
                }
            }
        );
    });
}

function getCalibrationHistory(signal_label) {
    return new Promise((resolve, reject) => {
        if (!db) return resolve([]);
        const query = signal_label 
            ? "SELECT * FROM calibration_history WHERE signal_label = ? ORDER BY timestamp DESC" 
            : "SELECT * FROM calibration_history ORDER BY timestamp DESC";
        const params = signal_label ? [signal_label] : [];
        
        db.all(query, params, (err, rows) => {
            if (err) {
                log.error("Error fetching calibration history", err);
                resolve([]);
            } else {
                // Parse data_points back to object
                rows.forEach(r => {
                    try { r.data_points = JSON.parse(r.data_points); } catch(e) {}
                });
                resolve(rows);
            }
        });
    });
}

module.exports = {
    initDatabase,
    closeDatabase,
    getMappedSignals,
    addMappedSignal,
    updateMappedSignal,
    deleteMappedSignal,
    getDevices,
    addDevice,
    updateDevice,
    deleteDevice,
    saveCalibrationHistory,
    getCalibrationHistory
};
