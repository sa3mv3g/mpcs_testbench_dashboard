const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const log = require('electron-log');
const db = require('./db');
const { floatToRegisters } = require('./utils');
const ModbusRTU = require('modbus-serial');

// Configure electron-log
log.transports.file.level = 'info';
log.info('Application starting...');

let mainWindow;
let isSequenceActive = false;
let isPreempted = false;
let pollingTimer = null;

// Mock Modbus logic for the continuous loop
async function startPollingLoop() {
    if (pollingTimer) return;
    pollingTimer = setInterval(async () => {
        if (isPreempted || isSequenceActive) return; // Skip if preempted or locked out

        try {
            const signals = await db.getMappedSignals();
            if(signals.length === 0) return;

            // Group by IP/Port
            const groups = {};
            signals.forEach(s => {
                const key = `${s.ip}:${s.port}`;
                if(!groups[key]) groups[key] = [];
                groups[key].push(s);
            });

            const updates = [];

            // Execute block reads per device
            for (const key of Object.keys(groups)) {
                const devSignals = groups[key];
                // In a real app, find min/max register, read them via ModbusRTU,
                // and slice the buffer. Here we mock it.
                
                devSignals.forEach(s => {
                    let val;
                    if(s.type.includes('digital')) val = Math.random() > 0.5 ? 1 : 0;
                    else val = (Math.random() * 100).toFixed(2);
                    updates.push({ signal_id: s.id, value: val, type: s.type });
                });
            }

            if(mainWindow && mainWindow.webContents) {
                mainWindow.webContents.send("state-update", updates);
            }

        } catch(e) {
            log.error("Polling error", e);
        }

    }, 500);
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

    // Open the DevTools.
    // mainWindow.webContents.openDevTools();
}

app.whenReady().then(async () => {
    const dbPath = path.join(app.getPath('userData'), 'database.sqlite');
    // Copy seed database on fresh install
    if (!fs.existsSync(dbPath)) {
        const seedDbPath = app.isPackaged 
            ? path.join(process.resourcesPath, 'assets', 'seed.db')
            : path.join(__dirname, '..', 'assets', 'seed.db');
            
        try {
            if (fs.existsSync(seedDbPath)) {
                fs.copyFileSync(seedDbPath, dbPath);
                log.info("Seed database copied successfully to " + dbPath);
            } else {
                log.warn("Seed database not found at " + seedDbPath);
            }
        } catch (err) {
            log.error("Failed to copy seed database", err);
        }
    }

    try {
        await db.initDatabase(dbPath);
    } catch (error) {
        log.error("Database initialization failed", error);
    }

    createWindow();
    startPollingLoop();

    app.on('activate', function () {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', function () {
    db.closeDatabase();
    if (process.platform !== 'darwin') app.quit();
});

// --- High Level IPC Handlers ---

// Modbus interactions
ipcMain.handle('modbus:readRegisters', async (event, { deviceIp, port, startAddress, length }) => {
    log.info(`Reading registers from ${deviceIp}:${port}`);
    const client = new ModbusRTU();
    try {
        await client.connectTCP(deviceIp, { port: parseInt(port) });
        const res = await client.readHoldingRegisters(parseInt(startAddress), parseInt(length));
        return { success: true, data: res.data };
    } catch (e) {
        log.error("Read Error:", e);
        return { success: false, error: e.message };
    } finally {
        client.close();
    }
});

ipcMain.handle('modbus:writeRegister', async (event, { deviceIp, port, address, value, type }) => {
    log.info(`Writing to ${deviceIp}:${port} addr ${address} (type: ${type}) val: ${value}`);
    const client = new ModbusRTU();
    try {
        await client.connectTCP(deviceIp, { port: parseInt(port) });
        if (type.includes('coil')) {
            await client.writeCoil(parseInt(address), !!value);
        } else {
            await client.writeRegister(parseInt(address), parseInt(value));
        }
        return { success: true };
    } catch (e) {
        log.error("Write Error:", e);
        return { success: false, error: e.message };
    } finally {
        client.close();
    }
});

ipcMain.handle('modbus:readRawRegister', async (event, { deviceIp, port, address, type }) => {
    log.info(`Reading ${type} from ${deviceIp}:${port} at ${address}`);
    const client = new ModbusRTU();
    try {
        await client.connectTCP(deviceIp, { port: parseInt(port) });
        let val;
        if (type.includes('coil')) {
            const res = await client.readCoils(parseInt(address), 1);
            val = res.data[0] ? 1 : 0;
        } else if (type.includes('discrete')) {
            const res = await client.readDiscreteInputs(parseInt(address), 1);
            val = res.data[0] ? 1 : 0;
        } else if (type.includes('input')) {
            const res = await client.readInputRegisters(parseInt(address), 1);
            val = res.data[0];
        } else {
            // holding register
            const res = await client.readHoldingRegisters(parseInt(address), 1);
            val = res.data[0];
        }
        return { success: true, value: val };
    } catch (e) {
        log.error("Read Error:", e);
        return { success: false, error: e.message };
    } finally {
        client.close();
    }
});

ipcMain.handle("modbus:preemptWrite", async (event, { signal_id, value }) => {
    log.info(`Preempting read loop to write value ${value} to signal ${signal_id}`);
    isPreempted = true; // Lock the polling loop
    
    try {
        // Fetch signal details
        const signals = await db.getMappedSignals();
        const sig = signals.find(s => s.id === signal_id);
        
        if (sig) {
            log.info(`Writing ${value} to ${sig.ip}:${sig.port} at register ${sig.read_register}`);
            // Mock the Modbus write delay
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        return { success: true };
    } catch(e) {
        log.error("Write Error:", e);
        return { success: false, error: e.message };
    } finally {
        isPreempted = false; // Release the lock
    }
});

// SQLite Database interactions
ipcMain.handle('db:getMappedSignals', async (event) => {
    return await db.getMappedSignals();
});

ipcMain.handle("db:addMappedSignal", async (event, signal) => {
	return await db.addMappedSignal(signal);
});

ipcMain.handle("db:updateMappedSignal", async (event, signal) => {
	return await db.updateMappedSignal(signal);
});

ipcMain.handle("db:deleteMappedSignal", async (event, id) => {
	return await db.deleteMappedSignal(id);
});

ipcMain.handle("db:saveManualSnapshot", async (event, data) => {
	log.info("Saving manual snapshot");
	// TODO: Insert into SQLite
	return { success: true };
});

ipcMain.handle("db:getLayout", async (event) => {
	return await db.getLayout();
});

ipcMain.handle("db:saveLayoutPosition", async (event, { signal_id, pos_x, pos_y }) => {
	return await db.saveLayoutPosition(signal_id, pos_x, pos_y);
});

ipcMain.handle("db:clearLayout", async (event) => {
	return await db.clearLayout();
});

// Device Registry interactions
ipcMain.handle("db:getDevices", async () => {
	return await db.getDevices();
});

ipcMain.handle("db:addDevice", async (event, device) => {
	return await db.addDevice(device);
});

ipcMain.handle("db:updateDevice", async (event, device) => {
	return await db.updateDevice(device);
});

ipcMain.handle("db:deleteDevice", async (event, id) => {
	return await db.deleteDevice(id);
});

// Device Registers interactions
ipcMain.handle("db:getDeviceRegisters", async (event, device_id) => {
	return await db.getDeviceRegisters(device_id);
});

ipcMain.handle("db:addDeviceRegister", async (event, reg) => {
	return await db.addDeviceRegister(reg);
});

ipcMain.handle("db:updateDeviceRegister", async (event, reg) => {
	return await db.updateDeviceRegister(reg);
});

ipcMain.handle("db:deleteDeviceRegister", async (event, id) => {
	return await db.deleteDeviceRegister(id);
});

// Test Sequence execution
ipcMain.handle('sequence:start', async (event, sequenceId) => {
    log.info(`Starting sequence ${sequenceId}`);
    isSequenceActive = true; // Lockout manual dashboard
    return { success: true };
});

ipcMain.handle('sequence:stop', async (event) => {
    log.info('Stopping sequence');
    isSequenceActive = false; // Release lockout
    return { success: true };
});

// Hardware Calibration
ipcMain.handle('calibration:perform', async (event, { label, scale, offset, deadzone }) => {
    log.info(`Performing calibration for ${label}: scale=${scale}, offset=${offset}, dz=${deadzone}`);
    
    try {
        // 1. Fetch signal mapping
        const signals = await db.getMappedSignals();
        const sig = signals.find(s => s.label === label);
        if (!sig) throw new Error("Signal mapping not found");

        // 2. Fetch device registry to get key1 and key2 addresses
        const devices = await db.getDevices();
        const dev = devices.find(d => d.ip === sig.ip && d.port === sig.port);
        if (!dev) throw new Error("Device not found in registry for this signal's IP/Port");

        // 3. Connect to Modbus (Mocked here since we don't have the modbus-serial instance globally managed yet)
        log.info(`Connecting to Modbus device at ${sig.ip}:${sig.port}...`);
        // const client = new ModbusRTU();
        // await client.connectTCP(sig.ip, { port: sig.port });
        // client.setID(1);

        // 4. Encode f32 values to u16 arrays
        const scaleRegs = floatToRegisters(scale, sig.encoding);
        const offsetRegs = floatToRegisters(offset, sig.encoding);
        const deadzoneRegs = floatToRegisters(deadzone, sig.encoding);

        log.info(`Writing Scale [${scaleRegs}] to register ${sig.cal_scale_reg}`);
        log.info(`Writing Offset [${offsetRegs}] to register ${sig.cal_offset_reg}`);
        log.info(`Writing Deadzone [${deadzoneRegs}] to register ${sig.cal_deadzone_reg}`);

        // await client.writeRegisters(sig.cal_scale_reg, scaleRegs);
        // await client.writeRegisters(sig.cal_offset_reg, offsetRegs);
        // await client.writeRegisters(sig.cal_deadzone_reg, deadzoneRegs);

        // 5. Handshake
        if (dev.key1 !== null && dev.key2 !== null) {
            log.info(`Writing Handshake keys to registers ${dev.key1} (0x5555) and ${dev.key2} (0xDDDD)`);
            // await client.writeRegister(dev.key1, 0x5555);
            // await client.writeRegister(dev.key2, 0xDDDD);
        } else {
            log.warn("Skipping Handshake: Device keys not configured in registry.");
        }

        // client.close();
        return { success: true };
    } catch (error) {
        log.error("Calibration Error:", error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('db:saveCalibrationHistory', async (event, history) => {
    return await db.saveCalibrationHistory(history);
});

ipcMain.handle('db:getCalibrationHistory', async (event, signal_label) => {
    return await db.getCalibrationHistory(signal_label);
});
