const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const log = require('electron-log');
const db = require('./db');
const { floatToRegisters, registersToFloat, toProtocolAddress } = require('./utils');
const modbusManager = require('./modbus-manager');

// Configure electron-log
log.transports.file.level = 'info';
log.transports.file.maxSize = 100 * 1024 * 1024; // 100MB
log.transports.console.level = false; // Disable console printing

// Add a specific polling log format if desired, but default file transport works well.
log.info('Application starting...');

// modbus-serial often throws unhandled promise rejections during socket cleanup (ECONNABORTED, ECONNRESET)
// Catch them here to prevent console spam and potential Node crashes.
process.on('unhandledRejection', (reason, promise) => {
    if (reason && reason.message && (
        reason.message.includes('ECONNABORTED') || 
        reason.message.includes('ECONNRESET') || 
        reason.message.includes('Timed Out') ||
        reason.message.includes('Port Not Open')
    )) {
        // Safe to ignore background socket cleanup errors
        return;
    }
    log.error('Unhandled Promise Rejection:', reason);
});

let mainWindow;
let isSequenceActive = false;
let isNetworkEnabled = false;
let pollingTimer = null;

async function startPollingLoop() {
    if (pollingTimer) return;
    pollingTimer = setInterval(async () => {
        if (isSequenceActive || !isNetworkEnabled) return; // Skip if locked out by sequence or network disabled

        try {
            const signals = await db.getMappedSignals();
            if(signals.length === 0) return;

            // Group by IP/Port
            const groups = {};
            signals.forEach(s => {
                if (!s.ip || !s.port) return;
                const key = `${s.ip}:${s.port}`;
                if(!groups[key]) groups[key] = { ip: s.ip, port: s.port, signals: [] };
                groups[key].signals.push(s);
            });

            const updates = [];
            const promises = [];

            // Execute queued reads per device in parallel
            for (const key of Object.keys(groups)) {
                const group = groups[key];
                
                // Silently skip disconnected devices to prevent log spam
                const connectionObj = modbusManager.connections.get(key);
                if (!connectionObj || !connectionObj.isConnected || !connectionObj.client || !connectionObj.client.isOpen) {
                    continue;
                }
                
                promises.push((async () => {
                    try {
                        await modbusManager.enqueue(group.ip, group.port, async (client) => {
                                const buckets = {
                                    holding: [],
                                    input: [],
                                    discrete: [],
                                    coil: []
                                };

                                for (const s of group.signals) {
                                    if (s.read_register == null) continue;
                                    const rawAddr = toProtocolAddress(s.read_register, s.type);
                                    const origAddr = parseInt(s.read_register);
                                    const isAnalog = s.type.startsWith('analog');
                                    const len = isAnalog ? 2 : 1;

                                    if (origAddr >= 40000 && origAddr < 50000) {
                                        buckets.holding.push({ s, rawAddr, origAddr, isAnalog, len });
                                    } else if (origAddr >= 30000 && origAddr < 40000) {
                                        buckets.input.push({ s, rawAddr, origAddr, isAnalog, len });
                                    } else if (origAddr >= 10000 && origAddr < 20000) {
                                        buckets.discrete.push({ s, rawAddr, origAddr, isAnalog, len });
                                    } else {
                                        buckets.coil.push({ s, rawAddr, origAddr, isAnalog, len });
                                    }
                                }

                                // Process Holding Registers
                                if (buckets.holding.length > 0) {
                                    const minAddr = Math.min(...buckets.holding.map(b => b.rawAddr));
                                    const maxAddr = Math.max(...buckets.holding.map(b => b.rawAddr + b.len - 1));
                                    const length = maxAddr - minAddr + 1;
                                    
                                    if (length <= 120) { // Modbus limit is 125 registers
                                        const res = await client.readHoldingRegisters(minAddr, length);
                                        for (const b of buckets.holding) {
                                            const offset = b.rawAddr - minAddr;
                                            const val = b.isAnalog 
                                                ? registersToFloat([res.data[offset], res.data[offset + 1]], b.s.encoding)
                                                : res.data[offset];
                                            updates.push({ signal_id: b.s.id, value: val, type: b.s.type });
                                            log.info(`[Polling Block] ${group.ip}:${group.port} | Signal: ${b.s.label} | OrigAddr: ${b.origAddr} -> RawAddr: ${b.rawAddr} | Value: ${val}`);
                                        }
                                    } else {
                                        // Fallback to individual reads if block is too large
                                        for (const b of buckets.holding) {
                                            const res = await client.readHoldingRegisters(b.rawAddr, b.len);
                                            const val = b.isAnalog ? registersToFloat(res.data, b.s.encoding) : res.data[0];
                                            updates.push({ signal_id: b.s.id, value: val, type: b.s.type });
                                            log.info(`[Polling Indiv] ${group.ip}:${group.port} | Signal: ${b.s.label} | OrigAddr: ${b.origAddr} -> RawAddr: ${b.rawAddr} | Value: ${val}`);
                                            await new Promise(r => setTimeout(r, 50)); // Pace individual reads
                                        }
                                    }
                                }

                                // Process Input Registers
                                if (buckets.input.length > 0) {
                                    const minAddr = Math.min(...buckets.input.map(b => b.rawAddr));
                                    const maxAddr = Math.max(...buckets.input.map(b => b.rawAddr + b.len - 1));
                                    const length = maxAddr - minAddr + 1;
                                    
                                    if (length <= 120) {
                                        const res = await client.readInputRegisters(minAddr, length);
                                        for (const b of buckets.input) {
                                            const offset = b.rawAddr - minAddr;
                                            const val = b.isAnalog 
                                                ? registersToFloat([res.data[offset], res.data[offset + 1]], b.s.encoding)
                                                : res.data[offset];
                                            updates.push({ signal_id: b.s.id, value: val, type: b.s.type });
                                            log.info(`[Polling Block] ${group.ip}:${group.port} | Signal: ${b.s.label} | OrigAddr: ${b.origAddr} -> RawAddr: ${b.rawAddr} | Value: ${val}`);
                                        }
                                    } else {
                                        for (const b of buckets.input) {
                                            const res = await client.readInputRegisters(b.rawAddr, b.len);
                                            const val = b.isAnalog ? registersToFloat(res.data, b.s.encoding) : res.data[0];
                                            updates.push({ signal_id: b.s.id, value: val, type: b.s.type });
                                            log.info(`[Polling Indiv] ${group.ip}:${group.port} | Signal: ${b.s.label} | OrigAddr: ${b.origAddr} -> RawAddr: ${b.rawAddr} | Value: ${val}`);
                                            await new Promise(r => setTimeout(r, 50)); // Pace individual reads
                                        }
                                    }
                                }

                                // Process Discrete Inputs
                                if (buckets.discrete.length > 0) {
                                    const minAddr = Math.min(...buckets.discrete.map(b => b.rawAddr));
                                    const maxAddr = Math.max(...buckets.discrete.map(b => b.rawAddr));
                                    const length = maxAddr - minAddr + 1;
                                    
                                    if (length <= 2000) {
                                        const res = await client.readDiscreteInputs(minAddr, length);
                                        for (const b of buckets.discrete) {
                                            const offset = b.rawAddr - minAddr;
                                            const val = res.data[offset] ? 1 : 0;
                                            updates.push({ signal_id: b.s.id, value: val, type: b.s.type });
                                            log.info(`[Polling Block] ${group.ip}:${group.port} | Signal: ${b.s.label} | OrigAddr: ${b.origAddr} -> RawAddr: ${b.rawAddr} | Value: ${val}`);
                                        }
                                    } else {
                                        for (const b of buckets.discrete) {
                                            const res = await client.readDiscreteInputs(b.rawAddr, 1);
                                            const val = res.data[0] ? 1 : 0;
                                            updates.push({ signal_id: b.s.id, value: val, type: b.s.type });
                                            log.info(`[Polling Indiv] ${group.ip}:${group.port} | Signal: ${b.s.label} | OrigAddr: ${b.origAddr} -> RawAddr: ${b.rawAddr} | Value: ${val}`);
                                            await new Promise(r => setTimeout(r, 50)); // Pace individual reads
                                        }
                                    }
                                }

                                // Process Coils
                                if (buckets.coil.length > 0) {
                                    const minAddr = Math.min(...buckets.coil.map(b => b.rawAddr));
                                    const maxAddr = Math.max(...buckets.coil.map(b => b.rawAddr));
                                    const length = maxAddr - minAddr + 1;
                                    
                                    if (length <= 2000) {
                                        const res = await client.readCoils(minAddr, length);
                                        for (const b of buckets.coil) {
                                            const offset = b.rawAddr - minAddr;
                                            const val = res.data[offset] ? 1 : 0;
                                            updates.push({ signal_id: b.s.id, value: val, type: b.s.type });
                                            log.info(`[Polling Block] ${group.ip}:${group.port} | Signal: ${b.s.label} | OrigAddr: ${b.origAddr} -> RawAddr: ${b.rawAddr} | Value: ${val}`);
                                        }
                                    } else {
                                        for (const b of buckets.coil) {
                                            const res = await client.readCoils(b.rawAddr, 1);
                                            const val = res.data[0] ? 1 : 0;
                                            updates.push({ signal_id: b.s.id, value: val, type: b.s.type });
                                            log.info(`[Polling Indiv] ${group.ip}:${group.port} | Signal: ${b.s.label} | OrigAddr: ${b.origAddr} -> RawAddr: ${b.rawAddr} | Value: ${val}`);
                                            await new Promise(r => setTimeout(r, 50)); // Pace individual reads
                                        }
                                    }
                                }
                        });
                    } catch (e) {
                        // Log but continue polling other devices
                        log.error(`Polling error for ${group.ip}:${group.port}:`, e.message);
                    }
                })());
            }

            // Wait for all devices to finish their polling queues
            await Promise.all(promises);

            if(mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && updates.length > 0) {
                log.info(`[DEBUG] Broadcasting state-update for ${updates.length} signals.`);
                mainWindow.webContents.send("state-update", updates);
            }

        } catch(e) {
            log.error("Polling loop error", e);
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

    // Start a lightweight network status broadcaster
    setInterval(() => {
        if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
            mainWindow.webContents.send("network-update", modbusManager.getConnectionStatuses());
        }
    }, 1000);
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
ipcMain.handle('modbus:connectAll', async () => {
    log.info("Explicit connection requested by user");
    const devices = await db.getDevices();
    
    // Kick off connection initialization asynchronously in the background.
    // Do NOT await this, so the UI instantly becomes responsive and the polling loop starts.
    modbusManager.initDevices(devices).catch(e => log.error("Init devices failed", e));
    
    isNetworkEnabled = true;
    return { success: true };
});

ipcMain.handle('modbus:disconnectAll', async () => {
    log.info("Explicit disconnect requested by user");
    isNetworkEnabled = false;
    const devices = await db.getDevices();
    for (const dev of devices) {
        if (dev.ip && dev.port) {
            modbusManager.disconnect(dev.ip, dev.port);
        }
    }
    return { success: true };
});

ipcMain.handle('modbus:refreshConnections', async () => {
    log.info("Explicit connection refresh requested by user");
    const devices = await db.getDevices();
    
    // Find devices that are currently disconnected and force an immediate reconnect attempt
    const offlineDevices = devices.filter(d => {
        const key = `${d.ip}:${d.port}`;
        const obj = modbusManager.connections.get(key);
        return !obj || !obj.isConnected || !obj.client || !obj.client.isOpen;
    });
    
    if (offlineDevices.length > 0) {
        modbusManager.initDevices(offlineDevices).catch(e => log.error("Refresh failed", e));
    }
    
    return { success: true };
});

ipcMain.handle('modbus:readRegisters', async (event, { deviceIp, port, startAddress, length }) => {
    log.info(`Reading registers from ${deviceIp}:${port}`);
    try {
        const res = await modbusManager.enqueue(deviceIp, port, async (client) => {
            const rawAddr = toProtocolAddress(startAddress, 'holding');
            return await client.readHoldingRegisters(rawAddr, parseInt(length));
        });
        return { success: true, data: res.data };
    } catch (e) {
        log.error("Read Error:", e);
        return { success: false, error: e.message };
    }
});

ipcMain.handle('modbus:writeRegister', async (event, { deviceIp, port, address, value, type }) => {
    log.info(`Writing to ${deviceIp}:${port} addr ${address} (type: ${type}) val: ${value}`);
    try {
        await modbusManager.enqueue(deviceIp, port, async (client) => {
            const rawAddr = toProtocolAddress(address, type);
            if (type.includes('coil')) {
                await client.writeCoil(rawAddr, !!value);
            } else {
                await client.writeRegister(rawAddr, parseInt(value));
            }
        });
        return { success: true };
    } catch (e) {
        log.error("Write Error:", e);
        return { success: false, error: e.message };
    }
});

ipcMain.handle('modbus:readRawRegister', async (event, { deviceIp, port, address, type }) => {
    log.info(`Reading ${type} from ${deviceIp}:${port} at ${address}`);
    try {
        let val;
        await modbusManager.enqueue(deviceIp, port, async (client) => {
            const rawAddr = toProtocolAddress(address, type);
            log.info(`[DEBUG] Attempting to read Modbus type '${type}' using raw address: ${rawAddr}. If this is a Data Model address (e.g. 40201), it will fail without translation.`);
            if (type.includes('coil')) {
                const res = await client.readCoils(rawAddr, 1);
                val = res.data[0] ? 1 : 0;
            } else if (type.includes('discrete')) {
                const res = await client.readDiscreteInputs(rawAddr, 1);
                val = res.data[0] ? 1 : 0;
            } else if (type.includes('input')) {
                const res = await client.readInputRegisters(rawAddr, 1);
                val = res.data[0];
            } else {
                // holding register
                const res = await client.readHoldingRegisters(rawAddr, 1);
                val = res.data[0];
            }
        });
        return { success: true, value: val };
    } catch (e) {
        log.error("Read Error:", e);
        return { success: false, error: e.message };
    }
});

ipcMain.handle("modbus:preemptWrite", async (event, { signal_id, value }) => {
    log.info(`Preempting read loop to write value ${value} to signal ${signal_id}`);
    
    try {
        const signals = await db.getMappedSignals();
        const sig = signals.find(s => s.id === signal_id);
        
        if (sig && sig.ip && sig.port && sig.read_register != null) {
            log.info(`Writing ${value} to ${sig.ip}:${sig.port} at register ${sig.read_register}`);
            
            await modbusManager.enqueue(sig.ip, sig.port, async (client) => {
                const rawAddr = toProtocolAddress(sig.read_register, sig.type);
                const origAddr = parseInt(sig.read_register);
                const isAnalog = sig.type.startsWith('analog');

                if (isAnalog) {
                    const regs = floatToRegisters(parseFloat(value), sig.encoding);
                    if (origAddr >= 40000 && origAddr < 50000) {
                        await client.writeRegisters(rawAddr, regs);
                    } else {
                        throw new Error("Cannot write analog value to non-holding register");
                    }
                } else {
                    if (origAddr >= 40000 && origAddr < 50000) {
                        await client.writeRegister(rawAddr, parseInt(value));
                    } else if (origAddr < 10000) {
                        await client.writeCoil(rawAddr, !!value);
                    } else {
                        throw new Error("Cannot write to read-only address space");
                    }
                }
            });
        }
        return { success: true };
    } catch(e) {
        log.error("Write Error:", e);
        return { success: false, error: e.message };
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
    const res = await db.addDevice(device);
    if (res.success && device.ip && device.port) {
        modbusManager.connect(device.ip, device.port).catch(e => log.error("Auto-connect failed", e));
    }
	return res;
});

ipcMain.handle("db:updateDevice", async (event, device) => {
    // If IP/Port changed, we might need to disconnect the old one.
    // For simplicity, just reconnect the new one.
    const res = await db.updateDevice(device);
    if (res.success && device.ip && device.port) {
        modbusManager.connect(device.ip, device.port).catch(e => log.error("Auto-connect failed", e));
    }
	return res;
});

ipcMain.handle("db:deleteDevice", async (event, id) => {
    // Find device to get IP/port before deletion
    const devices = await db.getDevices();
    const dev = devices.find(d => d.id === id);
    
    const res = await db.deleteDevice(id);
    if (res.success && dev && dev.ip && dev.port) {
        modbusManager.disconnect(dev.ip, dev.port);
    }
	return res;
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
    isSequenceActive = true;
    return { success: true };
});

ipcMain.handle('sequence:stop', async (event) => {
    log.info('Stopping sequence');
    isSequenceActive = false;
    return { success: true };
});

// Hardware Calibration
ipcMain.handle('calibration:perform', async (event, { label, scale, offset, deadzone }) => {
    log.info(`Performing calibration for ${label}: scale=${scale}, offset=${offset}, dz=${deadzone}`);
    
    try {
        const signals = await db.getMappedSignals();
        const sig = signals.find(s => s.label === label);
        if (!sig) throw new Error("Signal mapping not found");

        const devices = await db.getDevices();
        const dev = devices.find(d => d.ip === sig.ip && d.port === sig.port);
        if (!dev) throw new Error("Device not found in registry for this signal's IP/Port");

        const scaleRegs = floatToRegisters(scale, sig.encoding);
        const offsetRegs = floatToRegisters(offset, sig.encoding);
        const deadzoneRegs = floatToRegisters(deadzone, sig.encoding);

        await modbusManager.enqueue(sig.ip, sig.port, async (client) => {
            const rawScale = toProtocolAddress(sig.cal_scale_reg, 'holding');
            log.info(`Writing Scale [${scaleRegs}] to register ${sig.cal_scale_reg} (Raw: ${rawScale})`);
            await client.writeRegisters(rawScale, scaleRegs);
            
            const rawOffset = toProtocolAddress(sig.cal_offset_reg, 'holding');
            log.info(`Writing Offset [${offsetRegs}] to register ${sig.cal_offset_reg} (Raw: ${rawOffset})`);
            await client.writeRegisters(rawOffset, offsetRegs);
            
            const rawDz = toProtocolAddress(sig.cal_deadzone_reg, 'holding');
            log.info(`Writing Deadzone [${deadzoneRegs}] to register ${sig.cal_deadzone_reg} (Raw: ${rawDz})`);
            await client.writeRegisters(rawDz, deadzoneRegs);

            // 5. Handshake
            if (dev.key1 !== null && dev.key2 !== null) {
                const rawKey1 = toProtocolAddress(dev.key1, 'holding');
                const rawKey2 = toProtocolAddress(dev.key2, 'holding');
                log.info(`Writing Handshake keys to registers ${dev.key1} and ${dev.key2} (Raw: ${rawKey1}, ${rawKey2})`);
                await client.writeRegister(rawKey1, 0x5555);
                await client.writeRegister(rawKey2, 0xDDDD);
            } else {
                log.warn("Skipping Handshake: Device keys not configured in registry.");
            }
        });

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
