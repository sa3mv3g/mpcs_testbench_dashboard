const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const log = require('electron-log');
const db = require('./db');

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
    log.info(`Performing calibration for ${label}`);
    // TODO: Implement hardware calibration protocol (Zeroing, Writing, Handshake)
    return { success: true };
});
