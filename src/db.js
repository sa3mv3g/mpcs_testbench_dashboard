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
                db.run('DROP TABLE IF EXISTS mapped_signals'); // Force recreate for new schema in dev
                db.run(`CREATE TABLE IF NOT EXISTS mapped_signals (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    label TEXT,
                    type TEXT,
                    encoding TEXT,
                    device_id INTEGER,
                    read_reg_id INTEGER,
                    cal_scale_reg_id INTEGER,
                    cal_offset_reg_id INTEGER,
                    cal_deadzone_reg_id INTEGER,
                    FOREIGN KEY(device_id) REFERENCES device_registry(id) ON DELETE CASCADE,
                    FOREIGN KEY(read_reg_id) REFERENCES device_registers(id) ON DELETE SET NULL,
                    FOREIGN KEY(cal_scale_reg_id) REFERENCES device_registers(id) ON DELETE SET NULL,
                    FOREIGN KEY(cal_offset_reg_id) REFERENCES device_registers(id) ON DELETE SET NULL,
                    FOREIGN KEY(cal_deadzone_reg_id) REFERENCES device_registers(id) ON DELETE SET NULL
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

                db.run(`CREATE TABLE IF NOT EXISTS manual_dashboard_layout (
                    signal_id INTEGER PRIMARY KEY,
                    pos_x INTEGER DEFAULT 0,
                    pos_y INTEGER DEFAULT 0,
                    FOREIGN KEY(signal_id) REFERENCES mapped_signals(id) ON DELETE CASCADE
                )`);

                db.run(`CREATE TABLE IF NOT EXISTS device_registers (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    device_id INTEGER,
                    type TEXT,
                    address INTEGER,
                    description TEXT,
                    FOREIGN KEY(device_id) REFERENCES device_registry(id) ON DELETE CASCADE
                )`, (err) => {
                    if (err) log.error("Error creating device_registers", err);
                    resolve();
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
        const query = `
            SELECT 
                m.*,
                d.ip,
                d.port,
                rr.address as read_register,
                sr.address as cal_scale_reg,
                or_reg.address as cal_offset_reg,
                dr.address as cal_deadzone_reg
            FROM mapped_signals m
            JOIN device_registry d ON m.device_id = d.id
            LEFT JOIN device_registers rr ON m.read_reg_id = rr.id
            LEFT JOIN device_registers sr ON m.cal_scale_reg_id = sr.id
            LEFT JOIN device_registers or_reg ON m.cal_offset_reg_id = or_reg.id
            LEFT JOIN device_registers dr ON m.cal_deadzone_reg_id = dr.id
        `;
        db.all(query, (err, rows) => {
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
        const { label, type, encoding, device_id, read_reg_id, cal_scale_reg_id, cal_offset_reg_id, cal_deadzone_reg_id } = signal;
        db.run(
            `INSERT INTO mapped_signals (label, type, encoding, device_id, read_reg_id, cal_scale_reg_id, cal_offset_reg_id, cal_deadzone_reg_id) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [label, type, encoding, device_id, read_reg_id || null, cal_scale_reg_id || null, cal_offset_reg_id || null, cal_deadzone_reg_id || null],
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
        const { id, label, type, encoding, device_id, read_reg_id, cal_scale_reg_id, cal_offset_reg_id, cal_deadzone_reg_id } = signal;
        db.run(
            `UPDATE mapped_signals SET label = ?, type = ?, encoding = ?, device_id = ?, 
             read_reg_id = ?, cal_scale_reg_id = ?, cal_offset_reg_id = ?, cal_deadzone_reg_id = ? WHERE id = ?`,
            [label, type, encoding, device_id, read_reg_id || null, cal_scale_reg_id || null, cal_offset_reg_id || null, cal_deadzone_reg_id || null, id],
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

function getLayout() {
    return new Promise((resolve, reject) => {
        if (!db) return resolve([]);
        db.all("SELECT * FROM manual_dashboard_layout", (err, rows) => {
            if (err) resolve([]);
            else resolve(rows);
        });
    });
}

function saveLayoutPosition(signal_id, pos_x, pos_y) {
    return new Promise((resolve, reject) => {
        db.run(
            `INSERT INTO manual_dashboard_layout (signal_id, pos_x, pos_y) 
             VALUES (?, ?, ?) 
             ON CONFLICT(signal_id) DO UPDATE SET pos_x=excluded.pos_x, pos_y=excluded.pos_y`,
            [signal_id, pos_x, pos_y],
            function (err) {
                if (err) resolve({ success: false, error: err.message });
                else resolve({ success: true });
            }
        );
    });
}

// --- Device Registers Operations ---
function getDeviceRegisters(device_id) {
    return new Promise((resolve, reject) => {
        if (!db) return resolve([]);
        const query = device_id 
            ? "SELECT * FROM device_registers WHERE device_id = ? ORDER BY address ASC" 
            : "SELECT * FROM device_registers ORDER BY address ASC";
        const params = device_id ? [device_id] : [];
        
        db.all(query, params, (err, rows) => {
            if (err) {
                log.error("Error fetching device registers", err);
                resolve([]);
            } else {
                resolve(rows);
            }
        });
    });
}

function addDeviceRegister(reg) {
    return new Promise((resolve, reject) => {
        const { device_id, type, address, description } = reg;
        db.run(
            "INSERT INTO device_registers (device_id, type, address, description) VALUES (?, ?, ?, ?)",
            [device_id, type, address, description],
            function (err) {
                if (err) resolve({ success: false, error: err.message });
                else resolve({ success: true, id: this.lastID });
            }
        );
    });
}

function updateDeviceRegister(reg) {
    return new Promise((resolve, reject) => {
        const { id, type, address, description } = reg;
        db.run(
            "UPDATE device_registers SET type = ?, address = ?, description = ? WHERE id = ?",
            [type, address, description, id],
            function (err) {
                if (err) resolve({ success: false, error: err.message });
                else resolve({ success: true, changes: this.changes });
            }
        );
    });
}

function deleteDeviceRegister(id) {
    return new Promise((resolve, reject) => {
        db.run("DELETE FROM device_registers WHERE id = ?", [id], function (err) {
            if (err) resolve({ success: false, error: err.message });
            else resolve({ success: true, changes: this.changes });
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
    getCalibrationHistory,
    getLayout,
    saveLayoutPosition,
    getDeviceRegisters,
    addDeviceRegister,
    updateDeviceRegister,
    deleteDeviceRegister
};
