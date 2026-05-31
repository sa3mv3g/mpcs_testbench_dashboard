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
    // 0. Drop existing tables if any
    db.run(`DROP TABLE IF EXISTS manual_dashboard_layout`);
    db.run(`DROP TABLE IF EXISTS mapped_signals`);
    db.run(`DROP TABLE IF EXISTS device_registers`);
    db.run(`DROP TABLE IF EXISTS device_registry`);

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

    db.run(`CREATE TABLE IF NOT EXISTS manual_dashboard_layout (
        signal_id INTEGER PRIMARY KEY,
        pos_x INTEGER DEFAULT 0,
        pos_y INTEGER DEFAULT 0,
        FOREIGN KEY(signal_id) REFERENCES mapped_signals(id) ON DELETE CASCADE
    )`);

    const stmtDevice = db.prepare(`INSERT INTO device_registry (display_name, ip, port) VALUES (?, ?, ?)`);
    const stmtRegister = db.prepare(`INSERT INTO device_registers (device_id, type, address, description) VALUES (?, ?, ?, ?)`);
    
    for (let i = 1; i <= 8; i++) {
        // Different IPs, e.g., 192.168.1.100, 192.168.1.101, ...
        stmtDevice.run(`Controller ${i}`, `169.254.4.${99 + i}`, 502);
        
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


const signalMappings = [
  { label: '1.2 A (I-0)', type: 'digital-out', device_id: 1, reg_address: 1, pos_x: 100, pos_y: 50 },
  { label: '1.2 B (I-1)', type: 'digital-out', device_id: 1, reg_address: 2, pos_x: 200, pos_y: 50 },
  { label: '1.2 C (I-2)', type: 'digital-out', device_id: 1, reg_address: 3, pos_x: 300, pos_y: 50 },
  { label: '1.2 D (I-3)', type: 'digital-out', device_id: 1, reg_address: 4, pos_x: 400, pos_y: 50 },
  { label: '1.2 E (I-4)', type: 'digital-out', device_id: 1, reg_address: 5, pos_x: 500, pos_y: 50 },
  { label: '1.2 F (I-5)', type: 'digital-out', device_id: 1, reg_address: 6, pos_x: 600, pos_y: 50 },
  { label: '1.2 G (I-6)', type: 'digital-out', device_id: 1, reg_address: 7, pos_x: 700, pos_y: 50 },
  { label: '1.2 H (I-7)', type: 'digital-out', device_id: 1, reg_address: 8, pos_x: 800, pos_y: 50 },
  { label: '1.3 A (I-8)', type: 'digital-out', device_id: 1, reg_address: 9, pos_x: 900, pos_y: 50 },
  { label: '1.3 B (I-9)', type: 'digital-out', device_id: 1, reg_address: 10, pos_x: 1000, pos_y: 50 },
  { label: '1.3 C (I-10)', type: 'digital-out', device_id: 1, reg_address: 11, pos_x: 1100, pos_y: 50 },
  { label: '1.3 D (I-11)', type: 'digital-out', device_id: 1, reg_address: 12, pos_x: 1200, pos_y: 50 },
  { label: '1.3 E (I-12)', type: 'digital-out', device_id: 1, reg_address: 13, pos_x: 1300, pos_y: 50 },
  { label: '1.3 F (I-13)', type: 'digital-out', device_id: 1, reg_address: 14, pos_x: 1400, pos_y: 50 },
  { label: '1.3 G (I-14)', type: 'digital-out', device_id: 1, reg_address: 15, pos_x: 1500, pos_y: 50 },
  { label: '1.3 H (I-15)', type: 'digital-out', device_id: 1, reg_address: 16, pos_x: 1600, pos_y: 50 },
  { label: '1.1 D0 (O-0)', type: 'digital-in', device_id: 1, reg_address: 17, pos_x: 100, pos_y: 190 },
  { label: '1.1 D1 (O-1)', type: 'digital-in', device_id: 1, reg_address: 18, pos_x: 200, pos_y: 190 },
  { label: '1.1 D2 (O-2)', type: 'digital-in', device_id: 1, reg_address: 19, pos_x: 300, pos_y: 190 },
  { label: '1.1 D3 (O-3)', type: 'digital-in', device_id: 1, reg_address: 20, pos_x: 400, pos_y: 190 },
  { label: '1.1 D4 (O-4)', type: 'digital-in', device_id: 1, reg_address: 21, pos_x: 500, pos_y: 190 },
  { label: '1.1 D5 (O-5)', type: 'digital-in', device_id: 1, reg_address: 22, pos_x: 600, pos_y: 190 },
  { label: '1.1 D6 (O-6)', type: 'digital-in', device_id: 1, reg_address: 23, pos_x: 700, pos_y: 190 },
  { label: '1.1 D7 (O-7)', type: 'digital-in', device_id: 1, reg_address: 24, pos_x: 800, pos_y: 190 },
  { label: '2.2 A (I-16)', type: 'digital-out', device_id: 2, reg_address: 1, pos_x: 100, pos_y: 260 },
  { label: '2.2 B (I-17)', type: 'digital-out', device_id: 2, reg_address: 2, pos_x: 200, pos_y: 260 },
  { label: '2.2 C (I-18)', type: 'digital-out', device_id: 2, reg_address: 3, pos_x: 300, pos_y: 260 },
  { label: '2.2 D (I-19)', type: 'digital-out', device_id: 2, reg_address: 4, pos_x: 400, pos_y: 260 },
  { label: '2.2 E (I-20)', type: 'digital-out', device_id: 2, reg_address: 5, pos_x: 500, pos_y: 260 },
  { label: '2.2 F (I-21)', type: 'digital-out', device_id: 2, reg_address: 6, pos_x: 600, pos_y: 260 },
  { label: '2.2 G (I-22)', type: 'digital-out', device_id: 2, reg_address: 7, pos_x: 700, pos_y: 260 },
  { label: '2.2 H (I-23)', type: 'digital-out', device_id: 2, reg_address: 8, pos_x: 800, pos_y: 260 },
  { label: '2.3 A (I-24)', type: 'digital-out', device_id: 2, reg_address: 9, pos_x: 900, pos_y: 260 },
  { label: '2.3 B (I-25)', type: 'digital-out', device_id: 2, reg_address: 10, pos_x: 1000, pos_y: 260 },
  { label: '2.3 C (I-26)', type: 'digital-out', device_id: 2, reg_address: 11, pos_x: 1100, pos_y: 260 },
  { label: '2.3 D (I-27)', type: 'digital-out', device_id: 2, reg_address: 12, pos_x: 1200, pos_y: 260 },
  { label: '2.3 E (I-28)', type: 'digital-out', device_id: 2, reg_address: 13, pos_x: 1300, pos_y: 260 },
  { label: '2.3 F (I-29)', type: 'digital-out', device_id: 2, reg_address: 14, pos_x: 1400, pos_y: 260 },
  { label: '2.3 G (I-30)', type: 'digital-out', device_id: 2, reg_address: 15, pos_x: 1500, pos_y: 260 },
  { label: '2.3 H (I-31)', type: 'digital-out', device_id: 2, reg_address: 16, pos_x: 1600, pos_y: 260 },
  { label: '2.1 D0 (O-8)', type: 'digital-in', device_id: 2, reg_address: 17, pos_x: 100, pos_y: 400 },
  { label: '2.1 D1 (O-9)', type: 'digital-in', device_id: 2, reg_address: 18, pos_x: 200, pos_y: 400 },
  { label: '2.1 D2 (O-10)', type: 'digital-in', device_id: 2, reg_address: 19, pos_x: 300, pos_y: 400 },
  { label: '2.1 D3 (O-11)', type: 'digital-in', device_id: 2, reg_address: 20, pos_x: 400, pos_y: 400 },
  { label: '2.1 D4 (O-12)', type: 'digital-in', device_id: 2, reg_address: 21, pos_x: 500, pos_y: 400 },
  { label: '2.1 D5 (O-13)', type: 'digital-in', device_id: 2, reg_address: 22, pos_x: 600, pos_y: 400 },
  { label: '2.1 D6 (O-14)', type: 'digital-in', device_id: 2, reg_address: 23, pos_x: 700, pos_y: 400 },
  { label: '2.1 D7 (O-15)', type: 'digital-in', device_id: 2, reg_address: 24, pos_x: 800, pos_y: 400 },
  { label: '3.2 A (I-32)', type: 'digital-out', device_id: 3, reg_address: 1, pos_x: 100, pos_y: 470 },
  { label: '3.2 B (I-33)', type: 'digital-out', device_id: 3, reg_address: 2, pos_x: 200, pos_y: 470 },
  { label: '3.2 C (I-34)', type: 'digital-out', device_id: 3, reg_address: 3, pos_x: 300, pos_y: 470 },
  { label: '3.2 D (I-35)', type: 'digital-out', device_id: 3, reg_address: 4, pos_x: 400, pos_y: 470 },
  { label: '3.2 E (I-36)', type: 'digital-out', device_id: 3, reg_address: 5, pos_x: 500, pos_y: 470 },
  { label: '3.2 F (I-37)', type: 'digital-out', device_id: 3, reg_address: 6, pos_x: 600, pos_y: 470 },
  { label: '3.2 G (I-38)', type: 'digital-out', device_id: 3, reg_address: 7, pos_x: 700, pos_y: 470 },
  { label: '3.2 H (I-39)', type: 'digital-out', device_id: 3, reg_address: 8, pos_x: 800, pos_y: 470 },
  { label: '3.3 A (I-40)', type: 'digital-out', device_id: 3, reg_address: 9, pos_x: 900, pos_y: 470 },
  { label: '3.3 B (I-41)', type: 'digital-out', device_id: 3, reg_address: 10, pos_x: 1000, pos_y: 470 },
  { label: '3.3 C (I-42)', type: 'digital-out', device_id: 3, reg_address: 11, pos_x: 1100, pos_y: 470 },
  { label: '3.3 D (I-43)', type: 'digital-out', device_id: 3, reg_address: 12, pos_x: 1200, pos_y: 470 },
  { label: '3.3 E (I-44)', type: 'digital-out', device_id: 3, reg_address: 13, pos_x: 1300, pos_y: 470 },
  { label: '3.3 F (I-45)', type: 'digital-out', device_id: 3, reg_address: 14, pos_x: 1400, pos_y: 470 },
  { label: '3.3 G (I-46)', type: 'digital-out', device_id: 3, reg_address: 15, pos_x: 1500, pos_y: 470 },
  { label: '3.3 H (I-47)', type: 'digital-out', device_id: 3, reg_address: 16, pos_x: 1600, pos_y: 470 },
  { label: '3.1 D0 (O-16)', type: 'digital-in', device_id: 3, reg_address: 17, pos_x: 100, pos_y: 610 },
  { label: '3.1 D1 (O-17)', type: 'digital-in', device_id: 3, reg_address: 18, pos_x: 200, pos_y: 610 },
  { label: '3.1 D2 (O-18)', type: 'digital-in', device_id: 3, reg_address: 19, pos_x: 300, pos_y: 610 },
  { label: '3.1 D3 (O-19)', type: 'digital-in', device_id: 3, reg_address: 20, pos_x: 400, pos_y: 610 },
  { label: '3.1 D4 (O-20)', type: 'digital-in', device_id: 3, reg_address: 21, pos_x: 500, pos_y: 610 },
  { label: '3.1 D5 (O-21)', type: 'digital-in', device_id: 3, reg_address: 22, pos_x: 600, pos_y: 610 },
  { label: '3.1 D6 (O-22)', type: 'digital-in', device_id: 3, reg_address: 23, pos_x: 700, pos_y: 610 },
  { label: '3.1 D7 (O-23)', type: 'digital-in', device_id: 3, reg_address: 24, pos_x: 800, pos_y: 610 },
  { label: '4.2 A (I-48)', type: 'digital-out', device_id: 4, reg_address: 1, pos_x: 100, pos_y: 680 },
  { label: '4.2 B (I-49)', type: 'digital-out', device_id: 4, reg_address: 2, pos_x: 200, pos_y: 680 },
  { label: '4.2 C (I-50)', type: 'digital-out', device_id: 4, reg_address: 3, pos_x: 300, pos_y: 680 },
  { label: '4.2 D (I-51)', type: 'digital-out', device_id: 4, reg_address: 4, pos_x: 400, pos_y: 680 },
  { label: '4.2 E (I-52)', type: 'digital-out', device_id: 4, reg_address: 5, pos_x: 500, pos_y: 680 },
  { label: '4.2 F (I-53)', type: 'digital-out', device_id: 4, reg_address: 6, pos_x: 600, pos_y: 680 },
  { label: '4.2 G (I-54)', type: 'digital-out', device_id: 4, reg_address: 7, pos_x: 700, pos_y: 680 },
  { label: '4.2 H (I-55)', type: 'digital-out', device_id: 4, reg_address: 8, pos_x: 800, pos_y: 680 },
  { label: '4.3 A (I-56)', type: 'digital-out', device_id: 4, reg_address: 9, pos_x: 900, pos_y: 680 },
  { label: '4.3 B (I-57)', type: 'digital-out', device_id: 4, reg_address: 10, pos_x: 1000, pos_y: 680 },
  { label: '4.3 C (I-58)', type: 'digital-out', device_id: 4, reg_address: 11, pos_x: 1100, pos_y: 680 },
  { label: '4.3 D (I-59)', type: 'digital-out', device_id: 4, reg_address: 12, pos_x: 1200, pos_y: 680 },
  { label: '4.3 E (I-60)', type: 'digital-out', device_id: 4, reg_address: 13, pos_x: 1300, pos_y: 680 },
  { label: '4.3 F (I-61)', type: 'digital-out', device_id: 4, reg_address: 14, pos_x: 1400, pos_y: 680 },
  { label: '4.3 G (I-62)', type: 'digital-out', device_id: 4, reg_address: 15, pos_x: 1500, pos_y: 680 },
  { label: '4.3 H (I-63)', type: 'digital-out', device_id: 4, reg_address: 16, pos_x: 1600, pos_y: 680 },
  { label: '4.1 D0 (O-24)', type: 'digital-in', device_id: 4, reg_address: 17, pos_x: 100, pos_y: 750 },
  { label: '4.1 D1 (O-25)', type: 'digital-in', device_id: 4, reg_address: 18, pos_x: 200, pos_y: 750 },
  { label: '4.1 D2 (O-26)', type: 'digital-in', device_id: 4, reg_address: 19, pos_x: 300, pos_y: 750 },
  { label: '4.1 D3 (O-27)', type: 'digital-in', device_id: 4, reg_address: 20, pos_x: 400, pos_y: 750 },
  { label: '4.1 D4 (O-28)', type: 'digital-in', device_id: 4, reg_address: 21, pos_x: 500, pos_y: 750 },
  { label: '4.1 D5 (O-29)', type: 'digital-in', device_id: 4, reg_address: 22, pos_x: 600, pos_y: 750 },
  { label: '4.1 D6 (O-30)', type: 'digital-in', device_id: 4, reg_address: 23, pos_x: 700, pos_y: 750 },
  { label: '4.1 D7 (O-31)', type: 'digital-in', device_id: 4, reg_address: 24, pos_x: 800, pos_y: 750 },
  { label: '5.2 A (I-64)', type: 'digital-out', device_id: 5, reg_address: 1, pos_x: 100, pos_y: 820 },
  { label: '5.2 B (I-65)', type: 'digital-out', device_id: 5, reg_address: 2, pos_x: 200, pos_y: 820 },
  { label: '5.2 C (I-66)', type: 'digital-out', device_id: 5, reg_address: 3, pos_x: 300, pos_y: 820 },
  { label: '5.2 D (I-67)', type: 'digital-out', device_id: 5, reg_address: 4, pos_x: 400, pos_y: 820 },
  { label: '5.2 E (I-68)', type: 'digital-out', device_id: 5, reg_address: 5, pos_x: 500, pos_y: 820 },
  { label: '5.2 F (I-69)', type: 'digital-out', device_id: 5, reg_address: 6, pos_x: 600, pos_y: 820 },
  { label: '5.2 G (I-70)', type: 'digital-out', device_id: 5, reg_address: 7, pos_x: 700, pos_y: 820 },
  { label: '5.2 H (I-71)', type: 'digital-out', device_id: 5, reg_address: 8, pos_x: 800, pos_y: 820 },
  { label: '5.3 A (I-72)', type: 'digital-out', device_id: 5, reg_address: 9, pos_x: 900, pos_y: 820 },
  { label: '5.3 B (I-73)', type: 'digital-out', device_id: 5, reg_address: 10, pos_x: 1000, pos_y: 820 },
  { label: '5.3 C (I-74)', type: 'digital-out', device_id: 5, reg_address: 11, pos_x: 1100, pos_y: 820 },
  { label: '5.3 D (I-75)', type: 'digital-out', device_id: 5, reg_address: 12, pos_x: 1200, pos_y: 820 },
  { label: '5.3 E (I-76)', type: 'digital-out', device_id: 5, reg_address: 13, pos_x: 1300, pos_y: 820 },
  { label: '5.3 F (I-77)', type: 'digital-out', device_id: 5, reg_address: 14, pos_x: 1400, pos_y: 820 },
  { label: '5.3 G (I-78)', type: 'digital-out', device_id: 5, reg_address: 15, pos_x: 1500, pos_y: 820 },
  { label: '5.3 H (I-79)', type: 'digital-out', device_id: 5, reg_address: 16, pos_x: 1600, pos_y: 820 },
  { label: '5.1 D0 (O-32)', type: 'digital-in', device_id: 5, reg_address: 17, pos_x: 100, pos_y: 890 },
  { label: '5.1 D1 (O-33)', type: 'digital-in', device_id: 5, reg_address: 18, pos_x: 200, pos_y: 890 },
  { label: '5.1 D2 (O-34)', type: 'digital-in', device_id: 5, reg_address: 19, pos_x: 300, pos_y: 890 },
  { label: '5.1 D3 (O-35)', type: 'digital-in', device_id: 5, reg_address: 20, pos_x: 400, pos_y: 890 },
  { label: '5.1 D4 (O-36)', type: 'digital-in', device_id: 5, reg_address: 21, pos_x: 500, pos_y: 890 },
  { label: '5.1 D5 (O-37)', type: 'digital-in', device_id: 5, reg_address: 22, pos_x: 600, pos_y: 890 },
  { label: '5.1 D6 (O-38)', type: 'digital-in', device_id: 5, reg_address: 23, pos_x: 700, pos_y: 890 },
  { label: '5.1 D7 (O-39)', type: 'digital-in', device_id: 5, reg_address: 24, pos_x: 800, pos_y: 890 },
  { label: '6.2 A (I-80)', type: 'digital-out', device_id: 6, reg_address: 1, pos_x: 100, pos_y: 960 },
  { label: '6.2 B (I-81)', type: 'digital-out', device_id: 6, reg_address: 2, pos_x: 200, pos_y: 960 },
  { label: '6.2 C (I-82)', type: 'digital-out', device_id: 6, reg_address: 3, pos_x: 300, pos_y: 960 },
  { label: '6.2 D (I-83)', type: 'digital-out', device_id: 6, reg_address: 4, pos_x: 400, pos_y: 960 },
  { label: '6.2 E (I-84)', type: 'digital-out', device_id: 6, reg_address: 5, pos_x: 500, pos_y: 960 },
  { label: '6.2 F (I-85)', type: 'digital-out', device_id: 6, reg_address: 6, pos_x: 600, pos_y: 960 },
  { label: '6.2 G (I-86)', type: 'digital-out', device_id: 6, reg_address: 7, pos_x: 700, pos_y: 960 },
  { label: '6.2 H (I-87)', type: 'digital-out', device_id: 6, reg_address: 8, pos_x: 800, pos_y: 960 },
  { label: '6.3 A (I-88)', type: 'digital-out', device_id: 6, reg_address: 9, pos_x: 900, pos_y: 960 },
  { label: '6.3 B (I-89)', type: 'digital-out', device_id: 6, reg_address: 10, pos_x: 1000, pos_y: 960 },
  { label: '6.3 C (I-90)', type: 'digital-out', device_id: 6, reg_address: 11, pos_x: 1100, pos_y: 960 },
  { label: '6.3 D (I-91)', type: 'digital-out', device_id: 6, reg_address: 12, pos_x: 1200, pos_y: 960 },
  { label: '6.3 E (I-92)', type: 'digital-out', device_id: 6, reg_address: 13, pos_x: 1300, pos_y: 960 },
  { label: '6.3 F (I-93)', type: 'digital-out', device_id: 6, reg_address: 14, pos_x: 1400, pos_y: 960 },
  { label: '6.3 G (I-94)', type: 'digital-out', device_id: 6, reg_address: 15, pos_x: 1500, pos_y: 960 },
  { label: '6.3 H (I-95)', type: 'digital-out', device_id: 6, reg_address: 16, pos_x: 1600, pos_y: 960 },
  { label: '6.1 D0 (O-40)', type: 'digital-in', device_id: 6, reg_address: 17, pos_x: 100, pos_y: 1030 },
  { label: '6.1 D1 (O-41)', type: 'digital-in', device_id: 6, reg_address: 18, pos_x: 200, pos_y: 1030 },
  { label: '6.1 D2 (O-42)', type: 'digital-in', device_id: 6, reg_address: 19, pos_x: 300, pos_y: 1030 },
  { label: '6.1 D3 (O-43)', type: 'digital-in', device_id: 6, reg_address: 20, pos_x: 400, pos_y: 1030 },
  { label: '6.1 D4 (O-44)', type: 'digital-in', device_id: 6, reg_address: 21, pos_x: 500, pos_y: 1030 },
  { label: '6.1 D5 (O-45)', type: 'digital-in', device_id: 6, reg_address: 22, pos_x: 600, pos_y: 1030 },
  { label: '6.1 D6 (O-46)', type: 'digital-in', device_id: 6, reg_address: 23, pos_x: 700, pos_y: 1030 },
  { label: '6.1 D7 (O-47)', type: 'digital-in', device_id: 6, reg_address: 24, pos_x: 800, pos_y: 1030 },
  { label: '7.2 A (I-96)', type: 'digital-out', device_id: 7, reg_address: 1, pos_x: 100, pos_y: 1100 },
  { label: '7.2 B (I-97)', type: 'digital-out', device_id: 7, reg_address: 2, pos_x: 200, pos_y: 1100 },
  { label: '7.2 C (I-98)', type: 'digital-out', device_id: 7, reg_address: 3, pos_x: 300, pos_y: 1100 },
  { label: '7.2 D (I-99)', type: 'digital-out', device_id: 7, reg_address: 4, pos_x: 400, pos_y: 1100 },
  { label: '7.2 E (I-100)', type: 'digital-out', device_id: 7, reg_address: 5, pos_x: 500, pos_y: 1100 },
  { label: '7.2 F (I-101)', type: 'digital-out', device_id: 7, reg_address: 6, pos_x: 600, pos_y: 1100 },
  { label: '7.2 G (I-102)', type: 'digital-out', device_id: 7, reg_address: 7, pos_x: 700, pos_y: 1100 },
  { label: '7.2 H (I-103)', type: 'digital-out', device_id: 7, reg_address: 8, pos_x: 800, pos_y: 1100 },
  { label: '7.3 A (I-104)', type: 'digital-out', device_id: 7, reg_address: 9, pos_x: 900, pos_y: 1100 },
  { label: '7.3 B (I-105)', type: 'digital-out', device_id: 7, reg_address: 10, pos_x: 1000, pos_y: 1100 },
  { label: '7.3 C (I-106)', type: 'digital-out', device_id: 7, reg_address: 11, pos_x: 1100, pos_y: 1100 },
  { label: '7.3 D (I-107)', type: 'digital-out', device_id: 7, reg_address: 12, pos_x: 1200, pos_y: 1100 },
  { label: '7.3 E (I-108)', type: 'digital-out', device_id: 7, reg_address: 13, pos_x: 1300, pos_y: 1100 },
  { label: '7.3 F (I-109)', type: 'digital-out', device_id: 7, reg_address: 14, pos_x: 1400, pos_y: 1100 },
  { label: '7.3 G (I-110)', type: 'digital-out', device_id: 7, reg_address: 15, pos_x: 1500, pos_y: 1100 },
  { label: '7.3 H (I-111)', type: 'digital-out', device_id: 7, reg_address: 16, pos_x: 1600, pos_y: 1100 },
  { label: '7.1 D0 (O-48)', type: 'digital-in', device_id: 7, reg_address: 17, pos_x: 100, pos_y: 1170 },
  { label: '7.1 D1 (O-49)', type: 'digital-in', device_id: 7, reg_address: 18, pos_x: 200, pos_y: 1170 },
  { label: '7.1 D2 (O-50)', type: 'digital-in', device_id: 7, reg_address: 19, pos_x: 300, pos_y: 1170 },
  { label: '7.1 D3 (O-51)', type: 'digital-in', device_id: 7, reg_address: 20, pos_x: 400, pos_y: 1170 },
  { label: '7.1 D4 (O-52)', type: 'digital-in', device_id: 7, reg_address: 21, pos_x: 500, pos_y: 1170 },
  { label: '7.1 D5 (O-53)', type: 'digital-in', device_id: 7, reg_address: 22, pos_x: 600, pos_y: 1170 },
  { label: '7.1 D6 (O-54)', type: 'digital-in', device_id: 7, reg_address: 23, pos_x: 700, pos_y: 1170 },
  { label: '7.1 D7 (O-55)', type: 'digital-in', device_id: 7, reg_address: 24, pos_x: 800, pos_y: 1170 },
  { label: '8.2 A (I-112)', type: 'digital-out', device_id: 8, reg_address: 1, pos_x: 100, pos_y: 1240 },
  { label: '8.2 B (I-113)', type: 'digital-out', device_id: 8, reg_address: 2, pos_x: 200, pos_y: 1240 },
  { label: '8.2 C (I-114)', type: 'digital-out', device_id: 8, reg_address: 3, pos_x: 300, pos_y: 1240 },
  { label: '8.2 D (I-115)', type: 'digital-out', device_id: 8, reg_address: 4, pos_x: 400, pos_y: 1240 },
  { label: '8.2 E (I-116)', type: 'digital-out', device_id: 8, reg_address: 5, pos_x: 500, pos_y: 1240 },
  { label: '8.2 F (I-117)', type: 'digital-out', device_id: 8, reg_address: 6, pos_x: 600, pos_y: 1240 },
  { label: '8.2 G (I-118)', type: 'digital-out', device_id: 8, reg_address: 7, pos_x: 700, pos_y: 1240 },
  { label: '8.2 H (I-119)', type: 'digital-out', device_id: 8, reg_address: 8, pos_x: 800, pos_y: 1240 },
  { label: '8.3 A (I-120)', type: 'digital-out', device_id: 8, reg_address: 9, pos_x: 900, pos_y: 1240 },
  { label: '8.3 B (I-121)', type: 'digital-out', device_id: 8, reg_address: 10, pos_x: 1000, pos_y: 1240 },
  { label: '8.3 C (I-122)', type: 'digital-out', device_id: 8, reg_address: 11, pos_x: 1100, pos_y: 1240 },
  { label: '8.3 D (I-123)', type: 'digital-out', device_id: 8, reg_address: 12, pos_x: 1200, pos_y: 1240 },
  { label: '8.3 E (I-124)', type: 'digital-out', device_id: 8, reg_address: 13, pos_x: 1300, pos_y: 1240 },
  { label: '8.3 F (I-125)', type: 'digital-out', device_id: 8, reg_address: 14, pos_x: 1400, pos_y: 1240 },
  { label: '8.3 G (I-126)', type: 'digital-out', device_id: 8, reg_address: 15, pos_x: 1500, pos_y: 1240 },
  { label: '8.3 H (I-127)', type: 'digital-out', device_id: 8, reg_address: 16, pos_x: 1600, pos_y: 1240 },
  { label: '8.1 D0 (O-56)', type: 'digital-in', device_id: 8, reg_address: 17, pos_x: 100, pos_y: 1310 },
  { label: '8.1 D1 (O-57)', type: 'digital-in', device_id: 8, reg_address: 18, pos_x: 200, pos_y: 1310 },
  { label: '8.1 D2 (O-58)', type: 'digital-in', device_id: 8, reg_address: 19, pos_x: 300, pos_y: 1310 },
  { label: '8.1 D3 (O-59)', type: 'digital-in', device_id: 8, reg_address: 20, pos_x: 400, pos_y: 1310 },
  { label: '8.1 D4 (O-60)', type: 'digital-in', device_id: 8, reg_address: 21, pos_x: 500, pos_y: 1310 },
  { label: '8.1 D5 (O-61)', type: 'digital-in', device_id: 8, reg_address: 22, pos_x: 600, pos_y: 1310 },
  { label: '8.1 D6 (O-62)', type: 'digital-in', device_id: 8, reg_address: 23, pos_x: 700, pos_y: 1310 },
  { label: '8.1 D7 (O-63)', type: 'digital-in', device_id: 8, reg_address: 24, pos_x: 800, pos_y: 1310 },
  { label: '40-110 VAC 50HZ', type: 'analog-out', device_id: 1, reg_address: 40001, pos_x: 1100, pos_y: 190 },
  { label: '0-5 AMP AC 50HZ', type: 'analog-out', device_id: 1, reg_address: 40004, pos_x: 1200, pos_y: 190 },
  { label: '4-20 mA DC', type: 'analog-out', device_id: 1, reg_address: 40007, pos_x: 1300, pos_y: 190 },
  { label: '0-10 VDC', type: 'analog-out', device_id: 1, reg_address: 40010, pos_x: 1400, pos_y: 190 },
  { label: '40-110 VAC 50HZ', type: 'analog-in', device_id: 2, reg_address: 30001, scale_address: 40105, offset_address: 40107, deadzone_address: 40109, pos_x: 1100, pos_y: 400 },
  { label: '40-110 VAC 50HZ', type: 'analog-in', device_id: 2, reg_address: 30002, scale_address: 40111, offset_address: 40113, deadzone_address: 40115, pos_x: 1200, pos_y: 400 },
  { label: '0-5 AMP AC 50HZ', type: 'analog-in', device_id: 2, reg_address: 30003, scale_address: 40117, offset_address: 40119, deadzone_address: 40121, pos_x: 1300, pos_y: 400 },
  { label: '0-5 AMP AC 50HZ', type: 'analog-in', device_id: 2, reg_address: 30004, scale_address: 40123, offset_address: 40125, deadzone_address: 40127, pos_x: 1400, pos_y: 400 },
  { label: '0-10 VDC', type: 'analog-in', device_id: 3, reg_address: 30001, scale_address: 40105, offset_address: 40107, deadzone_address: 40109, pos_x: 1100, pos_y: 610 },
  { label: '0-10 VDC', type: 'analog-in', device_id: 3, reg_address: 30002, scale_address: 40111, offset_address: 40113, deadzone_address: 40115, pos_x: 1200, pos_y: 610 },
  { label: '4-20 mA DC', type: 'analog-in', device_id: 3, reg_address: 30003, scale_address: 40117, offset_address: 40119, deadzone_address: 40121, pos_x: 1300, pos_y: 610 },
  { label: '4-20 mA DC', type: 'analog-in', device_id: 3, reg_address: 30004, scale_address: 40123, offset_address: 40125, deadzone_address: 40127, pos_x: 1400, pos_y: 610 },
];
    // Fetch device registers to dynamically assign read_reg_id
    db.all(`
        SELECT id, device_id, type, address, description 
        FROM device_registers 
        WHERE (type = 'coil' AND (description LIKE 'Digital output%' OR description LIKE 'Digital input%')) 
           OR (type = 'holding' AND (description LIKE 'PWM channel % duty cycle%' OR description LIKE 'ADC channel %'))
           OR (type = 'input' AND description LIKE 'ADC channel % raw value (12-bit%')
        ORDER BY device_id, address
    `, (err, rows) => {
        if (err) throw err;
        
        signalMappings.forEach(mapping => {
            const reg = rows.find(r => r.device_id === mapping.device_id && r.address === mapping.reg_address);
            
            let scaleRegId = null;
            let offsetRegId = null;
            let deadzoneRegId = null;
            
            if (mapping.scale_address) {
                const sr = rows.find(r => r.device_id === mapping.device_id && r.address === mapping.scale_address);
                if (sr) scaleRegId = sr.id;
            }
            if (mapping.offset_address) {
                const or = rows.find(r => r.device_id === mapping.device_id && r.address === mapping.offset_address);
                if (or) offsetRegId = or.id;
            }
            if (mapping.deadzone_address) {
                const dr = rows.find(r => r.device_id === mapping.device_id && r.address === mapping.deadzone_address);
                if (dr) deadzoneRegId = dr.id;
            }

            if (reg) {
                db.run(`INSERT INTO mapped_signals (label, type, encoding, device_id, read_reg_id, cal_scale_reg_id, cal_offset_reg_id, cal_deadzone_reg_id) VALUES (?, ?, 'ABCD', ?, ?, ?, ?, ?)`, 
                    [mapping.label, mapping.type, mapping.device_id, reg.id, scaleRegId, offsetRegId, deadzoneRegId], 
                    function (err) {
                        if (err) {
                            console.error(err);
                        } else {
                            const signalId = this.lastID;
                            if (mapping.pos_x !== undefined && mapping.pos_y !== undefined) {
                                db.run(`INSERT INTO manual_dashboard_layout (signal_id, pos_x, pos_y) VALUES (?, ?, ?)`,
                                    [signalId, mapping.pos_x, mapping.pos_y]);
                            }
                        }
                    }
                );
            } else {
                console.warn(`Warning: Could not find register for mapping ${mapping.label}`);
            }
        });
        
        console.log("seed.db created successfully with default data!");
        db.close();
    });
});

