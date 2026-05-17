const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const log = require('electron-log');
const db = require('./db');
const { floatToRegisters } = require('./utils');

// Configure electron-log
log.transports.file.level = 'info';
log.info('Application starting...');

let mainWindow;

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
    try {
        await db.initDatabase(dbPath);
    } catch (error) {
        log.error("Database initialization failed", error);
    }

    createWindow();

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
    // TODO: Implement actual Modbus TCP read logic using modbus-serial
    return { success: true, data: [0, 0] }; // Mock data
});

ipcMain.handle('modbus:writeRegister', async (event, { deviceIp, port, address, value }) => {
    log.info(`Writing register to ${deviceIp}:${port}`);
    // TODO: Implement actual Modbus TCP write logic
    return { success: true };
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

// Test Sequence execution
ipcMain.handle('sequence:start', async (event, sequenceId) => {
    log.info(`Starting sequence ${sequenceId}`);
    // TODO: Start sequence engine execution
    return { success: true };
});

ipcMain.handle('sequence:stop', async (event) => {
    log.info('Stopping sequence');
    // TODO: Stop sequence engine execution
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
