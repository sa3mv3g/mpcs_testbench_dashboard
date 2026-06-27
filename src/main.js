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
log.transports.console.level = 'debug'; // Disable console printing

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
let activeDashboard = '';

ipcMain.on('app:setActiveDashboard', (event, tabName) => {
    log.info(`[IPC Main] Active dashboard set to: ${tabName}`);
    activeDashboard = tabName;
});

/* Guard flag to prevent overlapping polling ticks. */
let isTickRunning = false;

/*
 * In-memory cache for mapped signals.
 * Invalidated whenever a signal mapping mutation IPC is handled.
 */
let _signalCache = null;
let _signalCacheTime = 0;
const SIGNAL_CACHE_TTL_MS = 2000; // re-fetch from DB at most every 2 s

function invalidateSignalCache() {
    _signalCache = null;
    _signalCacheTime = 0;
    log.info('[Cache] signal cache invalidated');
}

async function getCachedSignals() {
    const now = Date.now();
    if (_signalCache && (now - _signalCacheTime) < SIGNAL_CACHE_TTL_MS) {
        return _signalCache;
    }
    _signalCache = await db.getMappedSignals();
    _signalCacheTime = now;
    log.info(`[Cache] signal cache refreshed — ${_signalCache.length} signal(s)`);
    return _signalCache;
}

/*
 * Static device table for the Manual Dashboard v2 polling loop.
 * Each entry maps a device_id (1-based, matching create-seed.js) to its
 * network address. All 8 controllers share the same jerry register map.
 */
const JERRY_DEVICES = [
    { id: 1, ip: '169.254.4.100', port: 502, unitId: 1 },
    { id: 2, ip: '169.254.4.101', port: 502, unitId: 2 },
    { id: 3, ip: '169.254.4.102', port: 502, unitId: 3 },
    { id: 4, ip: '169.254.4.103', port: 502, unitId: 4 },
    { id: 5, ip: '169.254.4.104', port: 502, unitId: 5 },
    { id: 6, ip: '169.254.4.105', port: 502, unitId: 6 },
    { id: 7, ip: '169.254.4.106', port: 502, unitId: 7 },
    { id: 8, ip: '169.254.4.107', port: 502, unitId: 8 },
];

async function startPollingLoop() {
    if (pollingTimer) {
        log.warn('[Polling] startPollingLoop called but timer already running — ignoring duplicate start');
        return;
    }
    log.info('[Polling] startPollingLoop: starting 500 ms interval');

    pollingTimer = setInterval(async () => {
        if (isSequenceActive) {
            log.info('[Polling] tick skipped — isSequenceActive=true');
            return;
        }
        if (!isNetworkEnabled) {
            log.info('[Polling] tick skipped — isNetworkEnabled=false');
            return;
        }
        if (activeDashboard !== 'manual-dashboard-v2') {
            log.info(`[Polling] tick skipped — manual dashboard (v2) not active (current: ${activeDashboard})`);
            return;
        }
        /* Skip this tick if the previous one is still running. */
        if (isTickRunning) {
            log.warn('[Polling] tick skipped — previous tick still running');
            return;
        }

        isTickRunning = true;
        const tickStart = Date.now();
        const updates = [];

        try {
            /*
             * Static polling plan — Manual Dashboard v2.
             *
             * Per device (all 8):
             *   readCoils(0, 24)
             *     offsets  0–15 → digital outputs  do-{d}-0  .. do-{d}-15
             *     offsets 16–23 → digital inputs   di-{d}-16 .. di-{d}-23
             *
             * Device 1 only:
             *   readHoldingRegisters(0, 10)
             *     offset 0 → ao-1-0  (PWM0 duty, uint16)
             *     offset 3 → ao-1-3  (PWM1 duty, uint16)
             *     offset 6 → ao-1-6  (PWM2 duty, uint16)
             *     offset 9 → ao-1-9  (PWM3 duty, uint16)
             *
             * Devices 1 and 3:
             *   readInputRegisters(4, 8)
             *     offsets 0+1 → ai-{d}-4   (ADC0 calibrated, float32 CDAB)
             *     offsets 2+3 → ai-{d}-6   (ADC1 calibrated, float32 CDAB)
             *     offsets 4+5 → ai-{d}-8   (ADC2 calibrated, float32 CDAB)
             *     offsets 6+7 → ai-{d}-10  (ADC3 calibrated, float32 CDAB)
             */
            const promises = JERRY_DEVICES.map(dev => (async () => {
                const key = `${dev.ip}:${dev.port}`;
                const conn = modbusManager.connections.get(key);
                if (!conn || !conn.isConnected || !conn.client || !conn.client.isOpen) {
                    log.warn(`[Polling] ${key}: skipping — not connected`);
                    return;
                }

                /* ── Coils (0–23): digital outputs + digital input mirrors ── */
                try {
                    await modbusManager.enqueue(dev.ip, dev.port, async (client) => {
                        client.setID(dev.unitId);
                        const t0 = Date.now();
                        const res = await client.readCoils(0, 24);
                        log.info(`[Polling] ${key}: readCoils(0,24) OK in ${Date.now() - t0} ms ${res.data}`);
                        for (let i = 0; i < 16; i++) {
                            updates.push({ guiId: `do-${dev.id}-${i}`, value: res.data[i] ? 1 : 0 });
                        }
                        for (let i = 16; i < 24; i++) {
                            updates.push({ guiId: `di-${dev.id}-${i}`, value: res.data[i] ? 1 : 0 });
                        }
                    });
                } catch (e) {
                    log.error(`[Polling] ${key}: readCoils FAILED — ${e.message}`);
                }

                /* ── Holding registers (0–9): PWM duty cycles — device 1 only ── */
                if (dev.id === 1) {
                    try {
                        await modbusManager.enqueue(dev.ip, dev.port, async (client) => {
                            client.setID(dev.unitId);
                            const t0 = Date.now();
                            const res = await client.readHoldingRegisters(0, 10);
                            log.info(`[Polling] ${key}: readHoldingRegisters(0,10) OK in ${Date.now() - t0} ms`);
                            updates.push({ guiId: 'ao-1-0', value: res.data[0] });
                            updates.push({ guiId: 'ao-1-3', value: res.data[3] });
                            updates.push({ guiId: 'ao-1-6', value: res.data[6] });
                            updates.push({ guiId: 'ao-1-9', value: res.data[9] });
                        });
                    } catch (e) {
                        log.error(`[Polling] ${key}: readHoldingRegisters FAILED — ${e.message}`);
                    }
                }

                /* ── Input registers (4–11): ADC calibrated floats — devices 1 and 3 ── */
                if (dev.id === 1 || dev.id === 3) {
                    try {
                        await modbusManager.enqueue(dev.ip, dev.port, async (client) => {
                            client.setID(dev.unitId);
                            const t0 = Date.now();
                            const res = await client.readInputRegisters(4, 8);
                            log.info(`[Polling] ${key}: readInputRegisters(4,8) OK in ${Date.now() - t0} ms`);
                            updates.push({ guiId: `ai-${dev.id}-4`,  value: registersToFloat([res.data[0], res.data[1]], 'CDAB') });
                            updates.push({ guiId: `ai-${dev.id}-6`,  value: registersToFloat([res.data[2], res.data[3]], 'CDAB') });
                            updates.push({ guiId: `ai-${dev.id}-8`,  value: registersToFloat([res.data[4], res.data[5]], 'CDAB') });
                            updates.push({ guiId: `ai-${dev.id}-10`, value: registersToFloat([res.data[6], res.data[7]], 'CDAB') });
                        });
                    } catch (e) {
                        log.error(`[Polling] ${key}: readInputRegisters FAILED — ${e.message}`);
                    }
                }
            })());

            await Promise.all(promises);
            log.info(`[Polling] tick complete — ${updates.length} update(s) in ${Date.now() - tickStart} ms`);

            if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && updates.length > 0) {
                mainWindow.webContents.send('state-update', updates);
            }

        } catch (e) {
            log.error(`[Polling] unhandled error in tick after ${Date.now() - tickStart} ms:`, e);
        } finally {
            /* Always release the guard so the next tick can run. */
            isTickRunning = false;
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
    log.info('[IPC] modbus:connectAll — user requested connect all');
    const devices = await db.getDevices();
    log.info(`[IPC] modbus:connectAll — found ${devices.length} device(s) in registry: ${devices.map(d => `${d.ip}:${d.port}`).join(', ')}`);

    // Kick off connection initialization asynchronously in the background.
    // Do NOT await this, so the UI instantly becomes responsive and the polling loop starts.
    modbusManager.initDevices(devices).catch(e => log.error('[IPC] modbus:connectAll — initDevices failed:', e));

    isNetworkEnabled = true;
    log.info('[IPC] modbus:connectAll — isNetworkEnabled set to true, polling loop will now execute ticks');
    return { success: true };
});

ipcMain.handle('modbus:disconnectAll', async () => {
    log.info('[IPC] modbus:disconnectAll — user requested disconnect all');
    isNetworkEnabled = false;
    log.info('[IPC] modbus:disconnectAll — isNetworkEnabled set to false, polling ticks will be skipped');
    const devices = await db.getDevices();

    /*
     * Disconnect all devices in parallel so a single slow or unresponsive device
     * does not block the teardown of all others.  Each disconnect is wrapped in
     * its own catch so one failure cannot prevent the remaining devices from
     * being disconnected.
     */
    await Promise.all(
        devices
            .filter(dev => dev.ip && dev.port)
            .map(dev => {
                log.info(`[IPC] modbus:disconnectAll — disconnecting ${dev.ip}:${dev.port}`);
                return modbusManager.disconnect(dev.ip, dev.port).catch(e =>
                    log.error(`[IPC] modbus:disconnectAll — error disconnecting ${dev.ip}:${dev.port}: ${e.message}`)
                );
            })
    );

    log.info('[IPC] modbus:disconnectAll — done');
    return { success: true };
});

ipcMain.handle('modbus:refreshConnections', async () => {
    log.info('[IPC] modbus:refreshConnections — user requested refresh');
    const devices = await db.getDevices();

    // Find devices that are currently disconnected and force an immediate reconnect attempt
    const offlineDevices = devices.filter(d => {
        const key = `${d.ip}:${d.port}`;
        const obj = modbusManager.connections.get(key);
        return !obj || !obj.isConnected || !obj.client || !obj.client.isOpen;
    });

    log.info(`[IPC] modbus:refreshConnections — ${offlineDevices.length} offline device(s) found: [${offlineDevices.map(d => `${d.ip}:${d.port}`).join(', ')}]`);
    if (offlineDevices.length > 0) {
        modbusManager.initDevices(offlineDevices).catch(e => log.error('[IPC] modbus:refreshConnections — initDevices failed:', e));
    }

    return { success: true };
});

ipcMain.handle('modbus:readRegisters', async (event, { deviceIp, port, startAddress, length }) => {
    log.info(`[IPC] modbus:readRegisters — ${deviceIp}:${port} startAddress=${startAddress} length=${length}`);
    try {
        const t0 = Date.now();
        const res = await modbusManager.enqueue(deviceIp, port, async (client) => {
            const rawAddr = toProtocolAddress(startAddress, 'holding');
            log.info(`[IPC] modbus:readRegisters — readHoldingRegisters(rawAddr=${rawAddr}, length=${length})`);
            return await client.readHoldingRegisters(rawAddr, parseInt(length));
        });
        log.info(`[IPC] modbus:readRegisters — success in ${Date.now() - t0} ms, data=[${res.data.join(',')}]`);
        return { success: true, data: res.data };
    } catch (e) {
        log.error(`[IPC] modbus:readRegisters — FAILED: ${e.message}`);
        return { success: false, error: e.message };
    }
});

ipcMain.handle('modbus:writeRegister', async (event, { deviceIp, port, address, value, type }) => {
    log.info(`[IPC] modbus:writeRegister — ${deviceIp}:${port} address=${address} type=${type} value=${value}`);
    try {
        const t0 = Date.now();
        /* Use enqueueHighPriority so this write skips the 50 ms pace delay. */
        await modbusManager.enqueueHighPriority(deviceIp, port, async (client) => {
            const rawAddr = toProtocolAddress(address, type);
            log.info(`[IPC] modbus:writeRegister — rawAddr=${rawAddr} type=${type}`);
            if (type.includes('coil')) {
                await client.writeCoil(rawAddr, !!value);
                log.info(`[IPC] modbus:writeRegister — writeCoil(${rawAddr}, ${!!value}) sent`);
            } else {
                await client.writeRegister(rawAddr, parseInt(value));
                log.info(`[IPC] modbus:writeRegister — writeRegister(${rawAddr}, ${parseInt(value)}) sent`);
            }
        });
        log.info(`[IPC] modbus:writeRegister — success in ${Date.now() - t0} ms`);
        return { success: true };
    } catch (e) {
        log.error(`[IPC] modbus:writeRegister — FAILED: ${e.message}`);
        return { success: false, error: e.message };
    }
});

ipcMain.handle('modbus:readRawRegister', async (event, { deviceIp, port, address, type }) => {
    log.info(`[IPC] modbus:readRawRegister — ${deviceIp}:${port} address=${address} type=${type}`);
    try {
        let val;
        const t0 = Date.now();
        await modbusManager.enqueue(deviceIp, port, async (client) => {
            const rawAddr = toProtocolAddress(address, type);
            log.info(`[IPC] modbus:readRawRegister — rawAddr=${rawAddr} type=${type} (data-model address ${address} translated)`);
            if (type.includes('coil')) {
                const res = await client.readCoils(rawAddr, 1);
                val = res.data[0] ? 1 : 0;
                log.info(`[IPC] modbus:readRawRegister — readCoils(${rawAddr}) => ${val}`);
            } else if (type.includes('discrete')) {
                const res = await client.readDiscreteInputs(rawAddr, 1);
                val = res.data[0] ? 1 : 0;
                log.info(`[IPC] modbus:readRawRegister — readDiscreteInputs(${rawAddr}) => ${val}`);
            } else if (type.includes('input')) {
                const res = await client.readInputRegisters(rawAddr, 1);
                val = res.data[0];
                log.info(`[IPC] modbus:readRawRegister — readInputRegisters(${rawAddr}) => ${val}`);
            } else {
                // holding register
                const res = await client.readHoldingRegisters(rawAddr, 1);
                val = res.data[0];
                log.info(`[IPC] modbus:readRawRegister — readHoldingRegisters(${rawAddr}) => ${val}`);
            }
        });
        log.info(`[IPC] modbus:readRawRegister — success in ${Date.now() - t0} ms, value=${val}`);
        return { success: true, value: val };
    } catch (e) {
        log.error(`[IPC] modbus:readRawRegister — FAILED: ${e.message}`);
        return { success: false, error: e.message };
    }
});

ipcMain.handle("modbus:preemptWrite", async (event, { signal_id, value }) => {
    log.info(`[IPC] modbus:preemptWrite — signal_id=${signal_id} value=${value}`);

    try {
        /* Use cached signals instead of hitting DB on every write. */
        const signals = await getCachedSignals();
        const sig = signals.find(s => s.id === signal_id);

        if (!sig) {
            log.warn(`[IPC] modbus:preemptWrite — signal_id=${signal_id} not found in mapped signals`);
        } else if (!sig.ip || !sig.port || sig.read_register == null) {
            log.warn(`[IPC] modbus:preemptWrite — signal "${sig.label}" missing ip/port/read_register — skipping write`);
        } else {
            log.info(`[IPC] modbus:preemptWrite — writing ${value} to signal "${sig.label}" at ${sig.ip}:${sig.port} register=${sig.read_register} type=${sig.type} encoding=${sig.encoding}`);
            const t0 = Date.now();
            /* Use enqueueHighPriority so this write skips the 50 ms pace delay. */
            await modbusManager.enqueueHighPriority(sig.ip, sig.port, async (client) => {
                const rawAddr = toProtocolAddress(sig.read_register, sig.type);
                const origAddr = parseInt(sig.read_register);
                const isAnalog = sig.type.startsWith('analog');
                log.info(`[IPC] modbus:preemptWrite — rawAddr=${rawAddr} origAddr=${origAddr} isAnalog=${isAnalog}`);

                if (isAnalog) {
                    /*
                     * Analog writes always target holding registers regardless of whether
                     * the address is a 5-digit data-model address or a raw protocol address.
                     * Use sig.type to decide, not origAddr numerical thresholds.
                     */
                    if (sig.type === 'analog-out' || sig.type.includes('holding')) {
                        const regs = floatToRegisters(parseFloat(value), sig.encoding);
                        log.info(`[IPC] modbus:preemptWrite — floatToRegisters(${value}, ${sig.encoding}) => [${regs.join(',')}]`);
                        await client.writeRegisters(rawAddr, regs);
                        log.info(`[IPC] modbus:preemptWrite — writeRegisters(${rawAddr}, [${regs.join(',')}]) sent`);
                    } else {
                        throw new Error(`Cannot write analog value to non-holding register type "${sig.type}"`);
                    }
                } else {
                    /*
                     * Use sig.type to select writeCoil vs writeRegister.
                     * The old origAddr < 10000 check incorrectly triggered writeCoil for
                     * holding registers configured with raw protocol addresses (e.g. 15).
                     */
                    if (sig.type === 'digital-out' || sig.type.includes('coil')) {
                        await client.writeCoil(rawAddr, !!value);
                        log.info(`[IPC] modbus:preemptWrite — writeCoil(${rawAddr}, ${!!value}) sent`);
                    } else if (sig.type.includes('holding') || sig.type === 'analog-out') {
                        await client.writeRegister(rawAddr, parseInt(value));
                        log.info(`[IPC] modbus:preemptWrite — writeRegister(${rawAddr}, ${parseInt(value)}) sent`);
                    } else {
                        throw new Error(`Cannot write to read-only signal type "${sig.type}"`);
                    }
                }
            });
            log.info(`[IPC] modbus:preemptWrite — success in ${Date.now() - t0} ms`);
        }
        return { success: true };
    } catch (e) {
        log.error(`[IPC] modbus:preemptWrite — FAILED: ${e.message}`);
        return { success: false, error: e.message };
    }
});

/*
 * Direct Modbus write for Manual Dashboard v2.
 * Accepts an explicit { ip, port, fc, address, value, encoding? } payload so
 * the renderer does not need to look up signal metadata from the DB.
 *
 * Supported fc values:
 *   'writeCoil'      → client.writeCoil(address, !!value)
 *   'writeRegister'  → client.writeRegister(address, parseInt(value))
 *   'writeRegisters' → client.writeRegisters(address, floatToRegisters(value, encoding))
 */
ipcMain.handle('modbus:directWrite', async (event, { ip, port, fc, address, value, encoding, unitId }) => {
    log.info(`[IPC] modbus:directWrite — ${ip}:${port} fc=${fc} addr=${address} value=${value} encoding=${encoding || 'n/a'} unitId=${unitId || 1}`);
    try {
        const t0 = Date.now();
        await modbusManager.enqueueHighPriority(ip, port, async (client) => {
            if (unitId) client.setID(unitId);
            if (fc === 'writeCoil') {
                await client.writeCoil(address, !!value);
                log.info(`[IPC] modbus:directWrite — writeCoil(${address}, ${!!value}) sent`);
            } else if (fc === 'writeRegister') {
                await client.writeRegister(address, parseInt(value));
                log.info(`[IPC] modbus:directWrite — writeRegister(${address}, ${parseInt(value)}) sent`);
            } else if (fc === 'writeRegisters') {
                const regs = floatToRegisters(parseFloat(value), encoding || 'CDAB');
                await client.writeRegisters(address, regs);
                log.info(`[IPC] modbus:directWrite — writeRegisters(${address}, [${regs.join(',')}]) sent`);
            } else {
                throw new Error(`Unknown fc: "${fc}"`);
            }
        });
        log.info(`[IPC] modbus:directWrite — success in ${Date.now() - t0} ms`);
        return { success: true };
    } catch (e) {
        log.error(`[IPC] modbus:directWrite — FAILED: ${e.message}`);
        return { success: false, error: e.message };
    }
});

// SQLite Database interactions
ipcMain.handle('db:getMappedSignals', async (event) => {
    return await db.getMappedSignals();
});

ipcMain.handle("db:addMappedSignal", async (event, signal) => {
    /* Invalidate signal cache on any mutation */
    invalidateSignalCache();
    return await db.addMappedSignal(signal);
});

ipcMain.handle("db:updateMappedSignal", async (event, signal) => {
    /* Invalidate signal cache on any mutation */
    invalidateSignalCache();
    return await db.updateMappedSignal(signal);
});

ipcMain.handle("db:deleteMappedSignal", async (event, id) => {
    /* Invalidate signal cache on any mutation */
    invalidateSignalCache();
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
    /*
     * Fetch the old device record BEFORE updating so we can disconnect the old
     * IP/Port if it changed, preventing a connection and socket leak.
     */
    const oldDevices = await db.getDevices();
    const oldDev = oldDevices.find(d => d.id === device.id);

    const res = await db.updateDevice(device);
    if (res.success) {
        // Disconnect the old IP/Port if it differs from the new one
        if (oldDev && oldDev.ip && oldDev.port) {
            const oldKey = `${oldDev.ip}:${oldDev.port}`;
            const newKey = `${device.ip}:${device.port}`;
            if (oldKey !== newKey) {
                log.info(`[IPC] db:updateDevice — IP/Port changed from ${oldKey} to ${newKey}, disconnecting old connection`);
                await modbusManager.disconnect(oldDev.ip, oldDev.port).catch(e =>
                    log.error(`[IPC] db:updateDevice — failed to disconnect old ${oldKey}: ${e.message}`)
                );
            }
        }
        // Connect to the new IP/Port
        if (device.ip && device.port) {
            modbusManager.connect(device.ip, device.port).catch(e => log.error("Auto-connect failed", e));
        }
    }
    return res;
});

ipcMain.handle("db:deleteDevice", async (event, id) => {
    // Find device to get IP/port before deletion
    const devices = await db.getDevices();
    const dev = devices.find(d => d.id === id);

    const res = await db.deleteDevice(id);
    /*
     * Await the disconnect so the socket is fully closed and the queue is drained
     * before returning success to the UI.  Errors are caught and logged so they
     * don't crash the IPC handler or block the DB deletion response.
     */
    if (res.success && dev && dev.ip && dev.port) {
        try {
            await modbusManager.disconnect(dev.ip, dev.port);
            log.info(`[IPC] db:deleteDevice — socket for ${dev.ip}:${dev.port} closed cleanly`);
        } catch (e) {
            log.error(`[IPC] db:deleteDevice — error disconnecting ${dev.ip}:${dev.port}: ${e.message}`);
        }
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
    log.info(`[IPC] sequence:start — sequenceId=${sequenceId} | isSequenceActive: false -> true (polling loop suppressed)`);
    isSequenceActive = true;
    return { success: true };
});

ipcMain.handle('sequence:stop', async (event) => {
    log.info('[IPC] sequence:stop — isSequenceActive: true -> false (polling loop will resume on next tick)');
    isSequenceActive = false;
    return { success: true };
});

// Hardware Calibration
ipcMain.handle('calibration:perform', async (event, { label, scale, offset, deadzone }) => {
    log.info(`[IPC] calibration:perform — label="${label}" scale=${scale} offset=${offset} deadzone=${deadzone}`);

    try {
        /* Use cached signals instead of hitting DB on every calibration request. */
        const signals = await getCachedSignals();
        const sig = signals.find(s => s.label === label);
        if (!sig) {
            log.error(`[IPC] calibration:perform — signal "${label}" not found in mapped signals`);
            throw new Error("Signal mapping not found");
        }
        log.info(`[IPC] calibration:perform — found signal id=${sig.id} at ${sig.ip}:${sig.port} type=${sig.type} encoding=${sig.encoding}`);
        log.info(`[IPC] calibration:perform — cal registers: scale=${sig.cal_scale_reg} offset=${sig.cal_offset_reg} deadzone=${sig.cal_deadzone_reg}`);

        log.info(`[IPC] calibration:perform — cal registers BEFORE db join fetch: scale=${sig.cal_scale_reg} offset=${sig.cal_offset_reg} deadzone=${sig.cal_deadzone_reg}`);
        log.info(`[IPC] calibration:perform — sig object: ${JSON.stringify(sig)}`);
        if (sig.cal_scale_reg == null || sig.cal_offset_reg == null || sig.cal_deadzone_reg == null) {
            log.error(`[IPC] calibration:perform — missing calibration registers for signal ${label}`);
            throw new Error(`Signal mapping for "${label}" is missing calibration registers (scale, offset, or deadzone).`);
        }

        const devices = await db.getDevices();
        const dev = devices.find(d => d.ip === sig.ip && d.port === sig.port);
        if (!dev) {
            log.error(`[IPC] calibration:perform — no device in registry for ${sig.ip}:${sig.port}`);
            throw new Error("Device not found in registry for this signal's IP/Port");
        }
        log.info(`[IPC] calibration:perform — device found: id=${dev.id} key1=${dev.key1} key2=${dev.key2}`);

        const scaleRegs = floatToRegisters(scale, sig.encoding);
        const offsetRegs = floatToRegisters(offset, sig.encoding);
        const deadzoneRegs = floatToRegisters(deadzone, sig.encoding);
        log.info(`[IPC] calibration:perform — encoded regs: scale=[${scaleRegs.join(',')}] offset=[${offsetRegs.join(',')}] deadzone=[${deadzoneRegs.join(',')}]`);

        const t0 = Date.now();
        /* Calibration writes are user-initiated — use high priority to skip the pace delay. */
        await modbusManager.enqueueHighPriority(sig.ip, sig.port, async (client) => {
            const rawScale = toProtocolAddress(sig.cal_scale_reg, 'holding');
            log.debug(`[IPC] calibration:perform — writeRegisters scale: reg=${sig.cal_scale_reg} rawAddr=${rawScale} regs=[${scaleRegs.join(',')}]`);
            log.debug(`[DEBUG] Writing scale. Raw address: ${rawScale}, Values: [${scaleRegs.join(', ')}]`);
            await client.writeRegisters(rawScale, scaleRegs);

            const rawOffset = toProtocolAddress(sig.cal_offset_reg, 'holding');
            log.debug(`[IPC] calibration:perform — writeRegisters offset: reg=${sig.cal_offset_reg} rawAddr=${rawOffset} regs=[${offsetRegs.join(',')}]`);
            log.debug(`[DEBUG] Writing offset. Raw address: ${rawOffset}, Values: [${offsetRegs.join(', ')}]`);
            await client.writeRegisters(rawOffset, offsetRegs);

            const rawDz = toProtocolAddress(sig.cal_deadzone_reg, 'holding');
            log.debug(`[IPC] calibration:perform — writeRegisters deadzone: reg=${sig.cal_deadzone_reg} rawAddr=${rawDz} regs=[${deadzoneRegs.join(',')}]`);
            log.debug(`[DEBUG] Writing deadzone. Raw address: ${rawDz}, Values: [${deadzoneRegs.join(', ')}]`);
            await client.writeRegisters(rawDz, deadzoneRegs);

            // Handshake
            if (dev.key1 !== null && dev.key2 !== null) {
                const rawKey1 = toProtocolAddress(dev.key1, 'holding');
                const rawKey2 = toProtocolAddress(dev.key2, 'holding');
                log.debug(`[IPC] calibration:perform — handshake: writing 0x5555 to key1 reg=${dev.key1} rawAddr=${rawKey1}`);
                log.debug(`[DEBUG] Writing handshake key1. Raw address: ${rawKey1}, Value: 0x5555`);
                await client.writeRegister(rawKey1, 0x5555);
                log.debug(`[IPC] calibration:perform — handshake: writing 0xDDDD to key2 reg=${dev.key2} rawAddr=${rawKey2}`);
                log.debug(`[DEBUG] Writing handshake key2. Raw address: ${rawKey2}, Value: 0xDDDD`);
                await client.writeRegister(rawKey2, 0xDDDD);
                log.info(`[IPC] calibration:perform — handshake complete`);
            } else {
                log.warn(`[IPC] calibration:perform — handshake SKIPPED: device key1=${dev.key1} key2=${dev.key2} not configured`);
            }
        });
        log.info(`[IPC] calibration:perform — all writes complete in ${Date.now() - t0} ms`);

        return { success: true };
    } catch (error) {
        log.error(`[IPC] calibration:perform — FAILED: ${error.message}`);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('db:saveCalibrationHistory', async (event, history) => {
    return await db.saveCalibrationHistory(history);
});

ipcMain.handle('db:getCalibrationHistory', async (event, signal_label) => {
    return await db.getCalibrationHistory(signal_label);
});
