const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

const assetsDir = path.join(__dirname, 'assets');
if (!fs.existsSync(assetsDir)) {
    fs.mkdirSync(assetsDir);
}

const dbPath = path.join(assetsDir, 'seed.db');
if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath); // start fresh
}

const db = new sqlite3.Database(dbPath);

// Read registers definition
const registersPath = path.join(__dirname, 'tests', 'resource', 'jerry_registers.json');
const registersData = JSON.parse(fs.readFileSync(registersPath, 'utf8'));

db.serialize(() => {
    // 1. Create tables
    db.run(`CREATE TABLE IF NOT EXISTS device_registry (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        display_name TEXT,
        ip TEXT,
        port INTEGER,
        key1 INTEGER,
        key2 INTEGER
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS device_registers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        device_id INTEGER,
        type TEXT,
        address INTEGER,
        description TEXT,
        FOREIGN KEY(device_id) REFERENCES device_registry(id) ON DELETE CASCADE
    )`);

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
        FOREIGN KEY(device_id) REFERENCES device_registry(id) ON DELETE CASCADE
    )`);

    // 2. Insert dummy data for 8 devices
    const stmtDevice = db.prepare(`INSERT INTO device_registry (display_name, ip, port) VALUES (?, ?, ?)`);
    const stmtRegister = db.prepare(`INSERT INTO device_registers (device_id, type, address, description) VALUES (?, ?, ?, ?)`);
    
    for (let i = 1; i <= 8; i++) {
        // Different IPs, e.g., 192.168.1.100, 192.168.1.101, ...
        stmtDevice.run(`Controller ${i}`, `192.168.1.${99 + i}`, 502);
        
        // Add registers for this device based on jerry_registers.json
        const types = {
            'coils': { dbType: 'coil', offset: 1 },
            'discrete_inputs': { dbType: 'discrete', offset: 10001 },
            'holding_registers': { dbType: 'holding', offset: 40001 },
            'input_registers': { dbType: 'input', offset: 30001 }
        };

        for (const [jsonType, config] of Object.entries(types)) {
            const regs = registersData.registers[jsonType] || [];
            for (const reg of regs) {
                const finalAddress = reg.address + config.offset;
                stmtRegister.run(i, config.dbType, finalAddress, reg.description || reg.name);
            }
        }
    }
    
    stmtDevice.finalize();
    stmtRegister.finalize();

    // Add a mapped signal
    db.run(`INSERT INTO mapped_signals (label, type, encoding, device_id, read_reg_id) VALUES ('Temp C', 'analog', 'float32', 1, 1)`);
    
    console.log("seed.db created successfully with default data!");
});

db.close();
