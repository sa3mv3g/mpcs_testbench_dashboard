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

                db.run(`CREATE TABLE IF NOT EXISTS manual_desired_state (
                    guiId TEXT PRIMARY KEY,
                    value REAL
                )`);

                db.run(`CREATE TABLE IF NOT EXISTS device_registers (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    device_id INTEGER,
                    type TEXT,
                    address INTEGER,
                    description TEXT,
                    FOREIGN KEY(device_id) REFERENCES device_registry(id) ON DELETE CASCADE
                )`);

                db.run(`CREATE TABLE IF NOT EXISTS manual_test_metadata (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    mpcs_serial_number TEXT,
                    loco_number TEXT,
                    tested_by TEXT,
                    tester_id TEXT,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )`);

                db.run(`CREATE TABLE IF NOT EXISTS manual_recording_sessions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    mpcs_serial_number TEXT,
                    loco_number TEXT,
                    tested_by TEXT,
                    tester_id TEXT,
                    start_time DATETIME DEFAULT CURRENT_TIMESTAMP,
                    end_time DATETIME,
                    total_samples INTEGER DEFAULT 0,
                    status TEXT DEFAULT 'RECORDING'
                )`);

                db.run(`CREATE TABLE IF NOT EXISTS manual_recording_samples (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    session_id INTEGER,
                    sample_index INTEGER,
                    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                    data_json TEXT,
                    FOREIGN KEY(session_id) REFERENCES manual_recording_sessions(id) ON DELETE CASCADE
                )`, (err) => {
                    if (err) log.error("Error creating tables", err);
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

function clearLayout() {
    return new Promise((resolve, reject) => {
        db.run('DELETE FROM manual_dashboard_layout', function (err) {
            if (err) resolve({ success: false, error: err.message });
            else resolve({ success: true });
        });
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

// --- Manual Desired State Operations ---
function getDesiredStates() {
    return new Promise((resolve, reject) => {
        if (!db) return resolve({});
        db.all("SELECT * FROM manual_desired_state", (err, rows) => {
            if (err) {
                log.error("Error fetching desired states", err);
                resolve({});
            } else {
                const states = {};
                rows.forEach(r => states[r.guiId] = r.value);
                resolve(states);
            }
        });
    });
}

function setDesiredState(guiId, value) {
    return new Promise((resolve, reject) => {
        db.run(
            `INSERT INTO manual_desired_state (guiId, value) VALUES (?, ?)
             ON CONFLICT(guiId) DO UPDATE SET value=excluded.value`,
            [guiId, value],
            function (err) {
                if (err) {
                    log.error("Error setting desired state", err);
                    resolve({ success: false, error: err.message });
                } else {
                    resolve({ success: true });
                }
            }
        );
    });
}

const ALL_OUTPUT_GUI_IDS = [];
for (let i = 1; i <= 8; i++) {
    for (let j = 0; j < 16; j++) {
        ALL_OUTPUT_GUI_IDS.push(`do-${i}-${j}`);
    }
}
ALL_OUTPUT_GUI_IDS.push('ao-1-0', 'ao-1-3', 'ao-1-6', 'ao-1-9');


function resetAllDesiredStates() {
    return new Promise((resolve, reject) => {
        const stmt = db.prepare(
            `INSERT INTO manual_desired_state (guiId, value) VALUES (?, ?)
             ON CONFLICT(guiId) DO UPDATE SET value=excluded.value`
        );
        db.serialize(() => {
            db.run('BEGIN TRANSACTION');
            for (const guiId of ALL_OUTPUT_GUI_IDS) {
                stmt.run(guiId, 0);
            }
            stmt.finalize((err) => {
                if (err) {
                    db.run('ROLLBACK');
                    log.error('Failed to finalize resetAllDesiredStates transaction', err);
                    return resolve({ success: false, error: err.message });
                }
                db.run('COMMIT', (commitErr) => {
                    if (commitErr) {
                        log.error('Failed to commit resetAllDesiredStates transaction', commitErr);
                        resolve({ success: false, error: commitErr.message });
                    } else {
                        log.info(`resetAllDesiredStates successfully upserted 0 for ${ALL_OUTPUT_GUI_IDS.length} outputs.`);
                        resolve({ success: true });
                    }
                });
            });
        });
    });
}

// --- Manual Test Metadata Operations ---
function getTestMetadata() {
    return new Promise((resolve) => {
        if (!db) return resolve({ mpcs_serial_number: '', loco_number: '', tested_by: '', tester_id: '' });
        db.get("SELECT * FROM manual_test_metadata WHERE id = 1", (err, row) => {
            if (err || !row) {
                resolve({ mpcs_serial_number: '', loco_number: '', tested_by: '', tester_id: '' });
            } else {
                resolve({
                    mpcs_serial_number: row.mpcs_serial_number || '',
                    loco_number: row.loco_number || '',
                    tested_by: row.tested_by || '',
                    tester_id: row.tester_id || ''
                });
            }
        });
    });
}

function saveTestMetadata(metadata) {
    return new Promise((resolve) => {
        if (!db) return resolve({ success: false, error: 'Database not initialized' });
        const { mpcs_serial_number, loco_number, tested_by, tester_id } = metadata || {};
        db.run(
            `INSERT INTO manual_test_metadata (id, mpcs_serial_number, loco_number, tested_by, tester_id, updated_at)
             VALUES (1, ?, ?, ?, ?, CURRENT_TIMESTAMP)
             ON CONFLICT(id) DO UPDATE SET 
                mpcs_serial_number=excluded.mpcs_serial_number,
                loco_number=excluded.loco_number,
                tested_by=excluded.tested_by,
                tester_id=excluded.tester_id,
                updated_at=CURRENT_TIMESTAMP`,
            [mpcs_serial_number || '', loco_number || '', tested_by || '', tester_id || ''],
            function (err) {
                if (err) {
                    log.error("Error saving test metadata", err);
                    resolve({ success: false, error: err.message });
                } else {
                    resolve({ success: true });
                }
            }
        );
    });
}

// --- Manual Recording Sessions & Samples Operations ---
function createRecordingSession(metadata) {
    return new Promise((resolve) => {
        if (!db) return resolve({ success: false, error: 'Database not initialized' });
        const { mpcs_serial_number, loco_number, tested_by, tester_id } = metadata || {};
        db.run(
            `INSERT INTO manual_recording_sessions (mpcs_serial_number, loco_number, tested_by, tester_id, start_time, status)
             VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, 'RECORDING')`,
            [mpcs_serial_number || '', loco_number || '', tested_by || '', tester_id || ''],
            function (err) {
                if (err) {
                    log.error("Error creating recording session", err);
                    resolve({ success: false, error: err.message });
                } else {
                    resolve({ success: true, sessionId: this.lastID });
                }
            }
        );
    });
}

function addRecordingSample({ sessionId, sampleIndex, timestamp, data }) {
    return new Promise((resolve) => {
        if (!db) return resolve({ success: false, error: 'Database not initialized' });
        const dataJson = typeof data === 'string' ? data : JSON.stringify(data);
        db.run(
            `INSERT INTO manual_recording_samples (session_id, sample_index, timestamp, data_json)
             VALUES (?, ?, ?, ?)`,
            [sessionId, sampleIndex, timestamp || new Date().toISOString(), dataJson],
            function (err) {
                if (err) {
                    log.error("Error adding recording sample", err);
                    resolve({ success: false, error: err.message });
                } else {
                    resolve({ success: true, sampleId: this.lastID });
                }
            }
        );
    });
}

function finishRecordingSession({ sessionId, totalSamples }) {
    return new Promise((resolve) => {
        if (!db) return resolve({ success: false, error: 'Database not initialized' });
        db.run(
            `UPDATE manual_recording_sessions 
             SET end_time = CURRENT_TIMESTAMP, total_samples = ?, status = 'COMPLETED'
             WHERE id = ?`,
            [totalSamples || 0, sessionId],
            function (err) {
                if (err) {
                    log.error("Error finishing recording session", err);
                    resolve({ success: false, error: err.message });
                } else {
                    resolve({ success: true });
                }
            }
        );
    });
}

function getRecordingSession(sessionId) {
    return new Promise((resolve) => {
        if (!db) return resolve(null);
        db.get("SELECT * FROM manual_recording_sessions WHERE id = ?", [sessionId], (err, session) => {
            if (err || !session) return resolve(null);
            db.all("SELECT * FROM manual_recording_samples WHERE session_id = ? ORDER BY sample_index ASC", [sessionId], (err2, samples) => {
                if (err2) return resolve({ ...session, samples: [] });
                const parsedSamples = samples.map(s => {
                    let parsedData = s.data_json;
                    try { parsedData = JSON.parse(s.data_json); } catch (e) {}
                    return {
                        id: s.id,
                        sample_index: s.sample_index,
                        timestamp: s.timestamp,
                        data: parsedData
                    };
                });
                resolve({ ...session, samples: parsedSamples });
            });
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
    clearLayout,
    getDeviceRegisters,
    addDeviceRegister,
    updateDeviceRegister,
    deleteDeviceRegister,
    getDesiredStates,
    setDesiredState,
    resetAllDesiredStates,
    getTestMetadata,
    saveTestMetadata,
    createRecordingSession,
    addRecordingSample,
    finishRecordingSession,
    getRecordingSession
};
