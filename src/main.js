const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const log = require('electron-log');
const winston = require('winston');
const db = require('./db');
const { floatToRegisters, registersToFloat, toProtocolAddress } = require('./utils');
const modbusManager = require('./jerry-device');
const ModbusDiscovery = require('./discovery');

require('winston-syslog').Syslog;

const isFactory = process.env.APP_ENV === 'factory';

// Configure electron-log
log.transports.file.level = 'info';
log.transports.file.maxSize = 100 * 1024 * 1024; // 100MB
log.transports.console.level = 'debug'; // Disable console printing
// Disable console in production
log.transports.console.level = isFactory ? 'debug' : false;

if (isFactory) {
  const syslogger = winston.createLogger({
    transports: [
      new winston.transports.Syslog({
        host: '192.168.0.1',   // or your syslog server IP
        port: 514,
        protocol: 'udp4',
        facility: 'local0',
        app_name: 'mpcs-testbench-dashboard'
      })
    ]
  });

  // Hook electron-log into syslog
  log.hooks.push((message) => {
    const text = message.data.join(' ');
    switch (message.level) {
      case 'error': syslogger.error(text); break;
      case 'warn':  syslogger.warn(text);  break;
      default:      syslogger.info(text);  break;
    }
    return message;  // must return message to continue the chain
  });
}


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
let activeInterfaceIp = null;
let pollingTimer = null;   // setTimeout handle for the self-scheduling polling loop
let isPollingActive = false; // true while the self-scheduling loop is running
let activeDashboard = '';
let outputStateCache = {}; // Replaces desiredStateCache

// Handle configuration writes on device connection
modbusManager.on('connected', async ({ ip, port }) => {
    try {
        const devices = await db.getDevices();
        const dev = devices.find(d => d.ip === ip && d.port === port);
        if (!dev) return;

        if (activeInterfaceIp) {
            const parts = activeInterfaceIp.split('.').map(Number);
            if (parts.length === 4 && !parts.some(isNaN)) {
                await modbusManager.enqueueHighPriority(ip, port, async (client) => {
                    const reg1 = (parts[2] << 8) | parts[3];
                    const reg2 = (parts[0] << 8) | parts[1];
                    await client.writeRegisters(305, [reg1, reg2]);
                    await client.writeCoil(31, true);
                });
                log.info(`[Main] Wrote SNTP server IP (${activeInterfaceIp}) to device ${dev.id}`);
            }
        }

        if (dev.id === 2 || dev.id === 4) {
            log.info(`[Main] Device ${dev.id} (${ip}:${port}) connected. Writing configuration data...`);
            await modbusManager.enqueueHighPriority(ip, port, async (client) => {
                await client.writeRegister(1, 65535);
            });
            log.info(`[Main] Configuration data written successfully to device ${dev.id}`);
        }
    } catch (err) {
        log.error(`[Main] Failed to write configuration data to device at ${ip}:${port}: ${err.message}`);
    }
});

const CONFIRMATION_GRACE_MS = 1500; // 3 polls
const MAX_CONSECUTIVE_FAILS = 3;

ipcMain.on('app:setActiveDashboard', (event, tabName) => {
    log.info(`[IPC Main] Active dashboard set to: ${tabName}`);
    activeDashboard = tabName;
});

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
 * Self-scheduling polling loop — replaces setInterval.
 *
 * The next tick is only scheduled AFTER the current tick's Promise.all resolves,
 * making it structurally impossible for two ticks to overlap.  This eliminates
 * the isTickRunning guard and the UI-blackout problem it caused.
 *
 * Cadence: next tick fires max(0, 500 - tickDuration) ms after the current tick
 * completes, maintaining a ~500 ms wall-clock cadence under normal conditions.
 * Under slow/timing-out devices the cadence degrades gracefully (no blackout).
 */
function startPollingLoop() {
    if (isPollingActive) {
        log.warn('[Polling] startPollingLoop called but already active — ignoring duplicate start');
        return;
    }
    isPollingActive = true;
    log.info('[Polling] startPollingLoop: starting self-scheduling loop');
    scheduleTick();
}

function stopPollingLoop() {
    isPollingActive = false;
    if (pollingTimer) {
        clearTimeout(pollingTimer);
        pollingTimer = null;
    }
    log.info('[Polling] stopPollingLoop: loop stopped');
}

async function scheduleTick() {
    if (!isPollingActive) return;

    // Skip conditions — reschedule immediately rather than returning
    if (isSequenceActive || !isNetworkEnabled || activeDashboard !== 'manual-dashboard-v2') {
        pollingTimer = setTimeout(scheduleTick, 500);
        return;
    }

    const tickStart = Date.now();
    /*
     * Fresh updates array per tick — never shared between ticks since the next
     * tick cannot start until this one's await Promise.all resolves.
     */
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
         * Devices 1–4:
         *   readHoldingRegisters(0, 1)
         *     offset 0 → ao-{d}-0  (PWM0 duty, uint16)
         *
         * Devices 1–4:
         *   readInputRegisters(4, 4)
         *     offsets 0+1 → ai-{d}-4   (ADC0 calibrated, float32 CDAB)
         *     offsets 2+3 → ai-{d}-6   (ADC1 calibrated, float32 CDAB)
         */
        const activeDevices = await db.getDevices();
        const promises = activeDevices.filter(d => d.ip && d.port).map(dev => (async () => {
            const key = `${dev.ip}:${dev.port}`;
            const conn = modbusManager.connections.get(key);
            if (!conn || !conn.isConnected || !conn.client || !conn.client.isOpen) {
                log.warn(`[Polling] ${key}: skipping — not connected`);
                return;
            }

            const unitId = dev.id;

            /* ── Coils (0–23): digital outputs + digital input mirrors ── */
            try {
                await modbusManager.enqueue(dev.ip, dev.port, async (client) => {
                    client.setID(unitId);
                    const t0 = Date.now();
                    const res = await client.readCoils(0, 24);
                    log.info(`[Polling] ${key}: readCoils(0,24) OK in ${Date.now() - t0} ms ${res.data}`);
                    for (let i = 0; i < 16; i++) {
                        const guiId = `do-${dev.id}-${i}`;
                        const processValue = res.data[i] ? 1 : 0;

                        const state = outputStateCache[guiId] || { setpoint: 0, confirmationState: 'SYNCED', consecutiveFails: 0 };

                        if (processValue === state.setpoint) {
                            state.confirmationState = 'SYNCED';
                            state.pendingUntil = null;
                            state.consecutiveFails = 0;
                        } else {
                            if (state.confirmationState === 'FAULT') {
                                // Do nothing, already in terminal fault state
                            } else if (state.confirmationState !== 'PENDING' || (state.pendingUntil && Date.now() > state.pendingUntil)) {
                                state.confirmationState = 'MISMATCH';
                                log.warn(`[Polling] MISMATCH on ${guiId}: PV=${processValue} but Setpoint=${state.setpoint}. Re-enforcing.`);
                                modbusManager.enqueueHighPriority(dev.ip, dev.port, async (c) => {
                                    c.setID(unitId);
                                    await c.writeCoil(i, !!state.setpoint);
                                }).catch(e => {
                                    log.error(`[Polling] Mismatch correction failed for ${guiId}:`, e);
                                    state.consecutiveFails = (state.consecutiveFails || 0) + 1;
                                    if (state.consecutiveFails >= MAX_CONSECUTIVE_FAILS) {
                                        state.confirmationState = 'FAULT';
                                        log.error(`[Polling] FAULT on ${guiId}: write failed ${state.consecutiveFails} times. Disabling further writes.`);
                                    }
                                });
                            }
                        }
                        outputStateCache[guiId] = state;
                        updates.push({ guiId, processValue, confirmationState: state.confirmationState });
                    }
                    for (let i = 16; i < 24; i++) {
                        updates.push({ guiId: `di-${dev.id}-${i}`, processValue: res.data[i] ? 1 : 0 });
                    }
                });
            } catch (e) {
                log.error(`[Polling] ${key}: readCoils FAILED — ${e.message}`);
            }

            /* ── PWM duty cycles — devices 1–4 ── */
            if (dev.id >= 1 && dev.id <= 4) {
                try {
                    await modbusManager.enqueue(dev.ip, dev.port, async (client) => {
                        client.setID(unitId);
                        const t0 = Date.now();
                        const res = await client.readHoldingRegisters(0, 1);
                        log.info(`[Polling] ${key}: readHoldingRegisters(0,1) OK in ${Date.now() - t0} ms`);
                        const guiId = `ao-${dev.id}-0`;
                        const processValue = res.data[0];
                        const state = outputStateCache[guiId] || { setpoint: 0, confirmationState: 'SYNCED', consecutiveFails: 0 };

                        if (processValue === state.setpoint) {
                            state.confirmationState = 'SYNCED';
                            state.pendingUntil = null;
                            state.consecutiveFails = 0;
                        } else {
                            if (state.confirmationState === 'FAULT') {
                                // Do nothing
                            } else if (state.confirmationState !== 'PENDING' || (state.pendingUntil && Date.now() > state.pendingUntil)) {
                                state.confirmationState = 'MISMATCH';
                                log.warn(`[Polling] MISMATCH on ${guiId}: PV=${processValue} but Setpoint=${state.setpoint}. Re-enforcing.`);
                                modbusManager.enqueueHighPriority(dev.ip, dev.port, async (c) => {
                                    c.setID(unitId);
                                    await c.writeRegister(0, parseInt(state.setpoint));
                                }).catch(e => {
                                    log.error(`[Polling] Mismatch correction failed for ${guiId}:`, e);
                                    state.consecutiveFails = (state.consecutiveFails || 0) + 1;
                                    if (state.consecutiveFails >= MAX_CONSECUTIVE_FAILS) {
                                        state.confirmationState = 'FAULT';
                                        log.error(`[Polling] FAULT on ${guiId}: write failed ${state.consecutiveFails} times. Disabling further writes.`);
                                    }
                                });
                            }
                        }
                        outputStateCache[guiId] = state;
                        updates.push({ guiId, processValue, confirmationState: state.confirmationState });
                    });
                } catch (e) {
                    log.error(`[Polling] ${key}: readHoldingRegisters FAILED — ${e.message}`);
                }
            }

            /* ── Input registers (4–7): ADC calibrated floats — devices 1 to 4 ── */
            if (dev.id >= 1 && dev.id <= 4) {
                try {
                    await modbusManager.enqueue(dev.ip, dev.port, async (client) => {
                        client.setID(unitId);
                        const t0 = Date.now();
                        const res = await client.readInputRegisters(4, 4);
                        log.info(`[Polling] ${key}: readInputRegisters(4,4) OK in ${Date.now() - t0} ms`);
                        updates.push({ guiId: `ai-${dev.id}-4`,  processValue: registersToFloat([res.data[0], res.data[1]], 'CDAB') });
                        updates.push({ guiId: `ai-${dev.id}-6`,  processValue: registersToFloat([res.data[2], res.data[3]], 'CDAB') });
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
        /*
         * Schedule the next tick only after this one fully completes.
         * Maintain ~500 ms wall-clock cadence by subtracting elapsed time.
         */
        if (isPollingActive) {
            const elapsed = Date.now() - tickStart;
            const delay = Math.max(0, 500 - elapsed);
            pollingTimer = setTimeout(scheduleTick, delay);
        }
    }
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
}

/*
 * Event-driven network status broadcast (C6).
 * ModbusManager emits 'statusChanged' whenever a device connects, disconnects,
 * or completes a reconnect attempt.  We push the update to the renderer
 * immediately — no polling, no 1 Hz setInterval, no log spam.
 */
modbusManager.on('statusChanged', (statuses) => {
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
        mainWindow.webContents.send('network-update', statuses);
    }
});

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

    // Initialize the setpoints from the database
    try {
        const initialSetpoints = await db.getDesiredStates();
        for (const [guiId, setpoint] of Object.entries(initialSetpoints)) {
            outputStateCache[guiId] = { setpoint, confirmationState: 'SYNCED', pendingUntil: null };
        }
        log.info(`[App] Initialized outputStateCache with ${Object.keys(outputStateCache).length} items`);
    } catch (e) {
        log.error("Failed to fetch initial setpoints", e);
    }

    createWindow();
    startPollingLoop();

    app.on('activate', function () {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', function () {
    stopPollingLoop();
    db.closeDatabase();
    if (process.platform !== 'darwin') app.quit();
});

// --- High Level IPC Handlers ---

ipcMain.handle('system:getNetworkInterfaces', () => {
    const interfaces = os.networkInterfaces();
    const result = [];
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                result.push({ name, address: iface.address });
            }
        }
    }
    return result;
});

// Modbus interactions
ipcMain.handle('modbus:connectAll', async (event, interfaceIp) => {
    log.info(`[IPC] modbus:connectAll — user requested connect all using interface ${interfaceIp}`);
    
    if (!interfaceIp) {
        log.error('[IPC] modbus:connectAll — No interface IP provided');
        return { success: false, error: 'No network interface selected.' };
    }

    activeInterfaceIp = interfaceIp;

    try {
        const discovery = new ModbusDiscovery(interfaceIp);
        
        // Forward found devices to the renderer so the UI updates live
        discovery.on('device-found', (device) => {
            if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
                mainWindow.webContents.send('discovery:device-found', device);
            }
        });

        // Run discovery for 3 seconds
        const discoveredDevices = await discovery.startDiscovery(3000);
        log.info(`[IPC] modbus:connectAll — Discovery finished, found ${discoveredDevices.length} devices.`);

        if (discoveredDevices.length === 0) {
            return { success: false, error: 'No Modbus devices found on the selected network.' };
        }

        const dbDevices = await db.getDevices();
        
        // Update database with discovery results
        for (const dev of dbDevices) {
            // Match DB id (1-8) with extracted Modbus id (0-7) + 1
            const found = discoveredDevices.find(d => (d.id + 1) === dev.id);
            if (found) {
                // Device discovered, update its IP and port
                dev.ip = found.ip;
                dev.port = found.port;
                await db.updateDevice(dev);
                log.info(`[IPC] modbus:connectAll — Updated device ${dev.id} with discovered IP ${dev.ip}:${dev.port}`);
            } else {
                // Device not discovered, clear its IP to prevent zombie retries
                if (dev.ip || dev.port) {
                    log.warn(`[IPC] modbus:connectAll — Device ${dev.id} not found in discovery. Clearing its IP and disconnecting.`);
                    // First disconnect the old IP cleanly if it exists
                    if (dev.ip && dev.port) {
                        await modbusManager.disconnect(dev.ip, dev.port).catch(e => log.error(`[IPC] modbus:connectAll — error disconnecting offline device ${dev.id}: ${e.message}`));
                    }
                    dev.ip = null;
                    dev.port = null;
                    await db.updateDevice(dev);
                }
            }
        }

        // Get the updated list of devices
        const updatedDevices = await db.getDevices();
        
        // Kick off connection initialization asynchronously in the background.
        modbusManager.initDevices(updatedDevices).catch(e => log.error('[IPC] modbus:connectAll — initDevices failed:', e));

        isNetworkEnabled = true;
        log.info('[IPC] modbus:connectAll — isNetworkEnabled set to true, polling loop will now execute ticks');
        
        return { success: true };
    } catch (e) {
        log.error('[IPC] modbus:connectAll — Discovery or Connection failed:', e);
        return { success: false, error: `Discovery failed: ${e.message}` };
    }
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

ipcMain.handle("db:getDesiredStates", async (event) => {
    return await db.getDesiredStates();
});

ipcMain.handle("db:setDesiredState", async (event, { guiId, value }) => {
    if (!outputStateCache[guiId]) {
        outputStateCache[guiId] = {};
    }
    // If we're in a FAULT state, a new user interaction should re-enable writes.
    if (outputStateCache[guiId].confirmationState === 'FAULT') {
        outputStateCache[guiId].consecutiveFails = 0;
    }
    outputStateCache[guiId].setpoint = value;
    outputStateCache[guiId].confirmationState = 'PENDING';
    outputStateCache[guiId].pendingUntil = Date.now() + CONFIRMATION_GRACE_MS;
    
    return await db.setDesiredState(guiId, value);
});

ipcMain.handle("db:resetAllDesiredStates", async (event) => {
    const res = await db.resetAllDesiredStates();
    if (res.success) {
        const now = Date.now();
        const guiIds = Object.keys(outputStateCache);
        for (const guiId of guiIds) {
            outputStateCache[guiId].setpoint = 0;
            outputStateCache[guiId].confirmationState = 'PENDING';
            outputStateCache[guiId].pendingUntil = now + CONFIRMATION_GRACE_MS;
        }
        log.info(`[IPC] resetAllDesiredStates: set ${guiIds.length} outputs to 0 and marked as PENDING.`);
    }
    return res;
});

// Device Registry interactions
ipcMain.handle("db:getDevices", async () => {
    return await db.getDevices();
});

ipcMain.handle("db:addDevice", async (event, device) => {
    const res = await db.addDevice(device);
    if (res.success && device.ip && device.port) {
        modbusManager.connect(device.ip, device.port, device.id).catch(e => log.error("Auto-connect failed", e));
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
            modbusManager.connect(device.ip, device.port, device.id).catch(e => log.error("Auto-connect failed", e));
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
ipcMain.handle('calibration:perform', async (event, { id, scale, offset, deadzone }) => {
    log.info(`[IPC] calibration:perform — id=${id} scale=${scale} offset=${offset} deadzone=${deadzone}`);

    try {
        /* Use cached signals instead of hitting DB on every calibration request. */
        const signals = await getCachedSignals();
        const sig = signals.find(s => s.id === id);
        if (!sig) {
            log.error(`[IPC] calibration:perform — signal id=${id} not found in mapped signals`);
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
                const rawKey1 = 128; // Hardcoded handshake key 1 register address
                const rawKey2 = 129; // Hardcoded handshake key 2 register address
                log.debug(`[IPC] calibration:perform — handshake: writing 0x${dev.key1.toString(16).toUpperCase()} to key1 rawAddr=${rawKey1}`);
                log.debug(`[DEBUG] Writing handshake key1. Raw address: ${rawKey1}, Value: 0x${dev.key1.toString(16).toUpperCase()}`);
                await client.writeRegister(rawKey1, dev.key1);
                log.debug(`[IPC] calibration:perform — handshake: writing 0x${dev.key2.toString(16).toUpperCase()} to key2 rawAddr=${rawKey2}`);
                log.debug(`[DEBUG] Writing handshake key2. Raw address: ${rawKey2}, Value: 0x${dev.key2.toString(16).toUpperCase()}`);
                await client.writeRegister(rawKey2, dev.key2);
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
