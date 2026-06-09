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

// Issue 3 fix: guard flag to prevent overlapping polling ticks.
let isTickRunning = false;

// Issue 1 fix: in-memory cache for mapped signals.
// Invalidated whenever a signal mapping mutation IPC is handled.
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

// Issue 7 fix: helper to safely decode a register-type bucket from a block-read result.
// Separates analog signals (which need 2 consecutive registers) from digital signals
// (which need exactly 1 register) so they never share an offset calculation.
function decodeBlockResults(bucket, blockData, minAddr, updates, key) {
    for (const b of bucket) {
        const offset = b.rawAddr - minAddr;
        let val;
        if (b.isAnalog) {
            // Analog: 2-register IEEE 754 float. Verify both registers are within the block.
            if (offset + 1 >= blockData.length) {
                log.error(`[Polling Block] ${key} | Signal: "${b.s.label}" (id=${b.s.id}) | SKIPPED — analog offset ${offset} overruns block length ${blockData.length}`);
                continue;
            }
            val = registersToFloat([blockData[offset], blockData[offset + 1]], b.s.encoding);
        } else {
            // Digital: single register / bit.
            val = blockData[offset];
        }
        updates.push({ signal_id: b.s.id, value: val, type: b.s.type });
        log.info(`[Polling Block] ${key} | Signal: "${b.s.label}" (id=${b.s.id}) | OrigAddr: ${b.origAddr} -> RawAddr: ${b.rawAddr} | offset=${offset} | encoding=${b.s.encoding || 'n/a'} | Value: ${val}`);
    }
}

async function startPollingLoop() {
    if (pollingTimer) {
        log.warn('[Polling] startPollingLoop called but timer already running — ignoring duplicate start');
        return;
    }
    log.info('[Polling] startPollingLoop: starting 500 ms interval');
    pollingTimer = setInterval(async () => {
        // --- Guard checks ---
        if (isSequenceActive) {
            log.info('[Polling] tick skipped — isSequenceActive=true (test sequence has exclusive Modbus access)');
            return;
        }
        if (!isNetworkEnabled) {
            log.info('[Polling] tick skipped — isNetworkEnabled=false (user has not connected yet)');
            return;
        }

        // Issue 3 fix: skip this tick if the previous one is still running.
        if (isTickRunning) {
            log.warn('[Polling] tick skipped — previous tick still running (slow device or large signal set)');
            return;
        }

        isTickRunning = true;
        const tickStart = Date.now();
        try {
            // Issue 1 fix: use cached signals instead of hitting DB every tick.
            const signals = await getCachedSignals();
            if (signals.length === 0) {
                log.info('[Polling] tick skipped — no mapped signals in database');
                isTickRunning = false;
                return;
            }
            log.info(`[Polling] tick start — ${signals.length} mapped signal(s) (from cache)`);

            // Group by IP/Port
            const groups = {};
            let unmappedCount = 0;
            signals.forEach(s => {
                if (!s.ip || !s.port) { unmappedCount++; return; }
                const key = `${s.ip}:${s.port}`;
                if (!groups[key]) groups[key] = { ip: s.ip, port: s.port, signals: [] };
                groups[key].signals.push(s);
            });
            const deviceKeys = Object.keys(groups);
            log.info(`[Polling] grouped into ${deviceKeys.length} device(s): [${deviceKeys.join(', ')}]${unmappedCount ? ` | ${unmappedCount} signal(s) skipped (no ip/port)` : ''}`);

            // Issue 4 fix: updates[] is local to this tick invocation.
            // Each tick creates its own array so overlapping ticks (now prevented by
            // isTickRunning) cannot share or corrupt each other's results.
            const updates = [];
            const promises = [];

            // Execute queued reads per device in parallel
            for (const key of deviceKeys) {
                const group = groups[key];

                // Silently skip disconnected devices to prevent log spam
                const connectionObj = modbusManager.connections.get(key);
                if (!connectionObj || !connectionObj.isConnected || !connectionObj.client || !connectionObj.client.isOpen) {
                    log.warn(`[Polling] ${key}: skipping — device not connected (connectionObj=${!!connectionObj}, isConnected=${connectionObj && connectionObj.isConnected}, isOpen=${connectionObj && connectionObj.client && connectionObj.client.isOpen})`);
                    continue;
                }
                log.info(`[Polling] ${key}: scheduling read for ${group.signals.length} signal(s)`);

                promises.push((async () => {
                    // Issue 4 fix: each device closure captures its own local array
                    // and merges into the tick-level updates[] only after all reads succeed.
                    const deviceUpdates = [];
                    try {
                        await modbusManager.enqueue(group.ip, group.port, async (client) => {
                            const buckets = {
                                holding: [],
                                input: [],
                                discrete: [],
                                coil: []
                            };

                            for (const s of group.signals) {
                                if (s.read_register == null) {
                                    log.warn(`[Polling] ${key}: signal "${s.label}" (id=${s.id}) has no read_register — skipping`);
                                    continue;
                                }
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
                            log.info(`[Polling] ${key}: buckets — holding=${buckets.holding.length}, input=${buckets.input.length}, discrete=${buckets.discrete.length}, coil=${buckets.coil.length}`);

                            // Process Holding Registers
                            if (buckets.holding.length > 0) {
                                try {
                                    const minAddr = Math.min(...buckets.holding.map(b => b.rawAddr));
                                    const maxAddr = Math.max(...buckets.holding.map(b => b.rawAddr + b.len - 1));
                                    const length = maxAddr - minAddr + 1;
                                    log.info(`[Polling] ${key}: holding block — rawAddr range [${minAddr}..${maxAddr}], span=${length} register(s)`);

                                    if (length <= 120) { // Modbus limit is 125 registers
                                        const t0 = Date.now();
                                        const res = await client.readHoldingRegisters(minAddr, length);
                                        log.info(`[Polling] ${key}: readHoldingRegisters(${minAddr}, ${length}) OK in ${Date.now() - t0} ms — raw data: [${res.data.join(',')}]`);
                                        // Issue 7 fix: use decodeBlockResults to safely handle mixed analog/digital
                                        decodeBlockResults(buckets.holding, res.data, minAddr, deviceUpdates, key);
                                    } else {
                                        log.warn(`[Polling] ${key}: holding span ${length} > 120 — falling back to individual reads`);
                                        // Fallback to individual reads if block is too large
                                        for (const b of buckets.holding) {
                                            const t0 = Date.now();
                                            const res = await client.readHoldingRegisters(b.rawAddr, b.len);
                                            const val = b.isAnalog ? registersToFloat(res.data, b.s.encoding) : res.data[0];
                                            deviceUpdates.push({ signal_id: b.s.id, value: val, type: b.s.type });
                                            log.info(`[Polling Indiv] ${key} | Signal: "${b.s.label}" (id=${b.s.id}) | OrigAddr: ${b.origAddr} -> RawAddr: ${b.rawAddr} | encoding=${b.s.encoding} | Value: ${val} | ${Date.now() - t0} ms`);
                                            await new Promise(r => setTimeout(r, 50)); // Pace individual reads
                                        }
                                    }
                                } catch (e) {
                                    log.error(`[Polling] ${key}: holding bucket FAILED — ${e.message}`);
                                }
                            }

                            // Process Input Registers
                            if (buckets.input.length > 0) {
                                try {
                                    const minAddr = Math.min(...buckets.input.map(b => b.rawAddr));
                                    const maxAddr = Math.max(...buckets.input.map(b => b.rawAddr + b.len - 1));
                                    const length = maxAddr - minAddr + 1;
                                    log.info(`[Polling] ${key}: input block — rawAddr range [${minAddr}..${maxAddr}], span=${length} register(s)`);

                                    if (length <= 120) {
                                        const t0 = Date.now();
                                        const res = await client.readInputRegisters(minAddr, length);
                                        log.info(`[Polling] ${key}: readInputRegisters(${minAddr}, ${length}) OK in ${Date.now() - t0} ms — raw data: [${res.data.join(',')}]`);
                                        // Issue 7 fix: use decodeBlockResults
                                        decodeBlockResults(buckets.input, res.data, minAddr, deviceUpdates, key);
                                    } else {
                                        log.warn(`[Polling] ${key}: input span ${length} > 120 — falling back to individual reads`);
                                        for (const b of buckets.input) {
                                            const t0 = Date.now();
                                            const res = await client.readInputRegisters(b.rawAddr, b.len);
                                            const val = b.isAnalog ? registersToFloat(res.data, b.s.encoding) : res.data[0];
                                            deviceUpdates.push({ signal_id: b.s.id, value: val, type: b.s.type });
                                            log.info(`[Polling Indiv] ${key} | Signal: "${b.s.label}" (id=${b.s.id}) | OrigAddr: ${b.origAddr} -> RawAddr: ${b.rawAddr} | encoding=${b.s.encoding} | Value: ${val} | ${Date.now() - t0} ms`);
                                            await new Promise(r => setTimeout(r, 50)); // Pace individual reads
                                        }
                                    }
                                } catch (e) {
                                    log.error(`[Polling] ${key}: input bucket FAILED — ${e.message}`);
                                }
                            }

                            // Process Discrete Inputs
                            if (buckets.discrete.length > 0) {
                                try {
                                    const minAddr = Math.min(...buckets.discrete.map(b => b.rawAddr));
                                    const maxAddr = Math.max(...buckets.discrete.map(b => b.rawAddr));
                                    const length = maxAddr - minAddr + 1;
                                    log.info(`[Polling] ${key}: discrete block — rawAddr range [${minAddr}..${maxAddr}], span=${length} bit(s)`);

                                    if (length <= 2000) {
                                        const t0 = Date.now();
                                        const res = await client.readDiscreteInputs(minAddr, length);
                                        log.info(`[Polling] ${key}: readDiscreteInputs(${minAddr}, ${length}) OK in ${Date.now() - t0} ms`);
                                        for (const b of buckets.discrete) {
                                            const offset = b.rawAddr - minAddr;
                                            const val = res.data[offset] ? 1 : 0;
                                            deviceUpdates.push({ signal_id: b.s.id, value: val, type: b.s.type });
                                            log.info(`[Polling Block] ${key} | Signal: "${b.s.label}" (id=${b.s.id}) | OrigAddr: ${b.origAddr} -> RawAddr: ${b.rawAddr} | offset=${offset} | Value: ${val}`);
                                        }
                                    } else {
                                        log.warn(`[Polling] ${key}: discrete span ${length} > 2000 — falling back to individual reads`);
                                        for (const b of buckets.discrete) {
                                            const t0 = Date.now();
                                            const res = await client.readDiscreteInputs(b.rawAddr, 1);
                                            const val = res.data[0] ? 1 : 0;
                                            deviceUpdates.push({ signal_id: b.s.id, value: val, type: b.s.type });
                                            log.info(`[Polling Indiv] ${key} | Signal: "${b.s.label}" (id=${b.s.id}) | OrigAddr: ${b.origAddr} -> RawAddr: ${b.rawAddr} | Value: ${val} | ${Date.now() - t0} ms`);
                                            await new Promise(r => setTimeout(r, 50)); // Pace individual reads
                                        }
                                    }
                                } catch (e) {
                                    log.error(`[Polling] ${key}: discrete bucket FAILED — ${e.message}`);
                                }
                            }

                            // Process Coils
                            if (buckets.coil.length > 0) {
                                try {
                                    const minAddr = Math.min(...buckets.coil.map(b => b.rawAddr));
                                    const maxAddr = Math.max(...buckets.coil.map(b => b.rawAddr));
                                    const length = maxAddr - minAddr + 1;
                                    log.info(`[Polling] ${key}: coil block — rawAddr range [${minAddr}..${maxAddr}], span=${length} bit(s)`);

                                    if (length <= 2000) {
                                        const t0 = Date.now();
                                        const res = await client.readCoils(minAddr, length);
                                        log.info(`[Polling] ${key}: readCoils(${minAddr}, ${length}) OK in ${Date.now() - t0} ms`);
                                        for (const b of buckets.coil) {
                                            const offset = b.rawAddr - minAddr;
                                            const val = res.data[offset] ? 1 : 0;
                                            deviceUpdates.push({ signal_id: b.s.id, value: val, type: b.s.type });
                                            log.info(`[Polling Block] ${key} | Signal: "${b.s.label}" (id=${b.s.id}) | OrigAddr: ${b.origAddr} -> RawAddr: ${b.rawAddr} | offset=${offset} | Value: ${val}`);
                                        }
                                    } else {
                                        log.warn(`[Polling] ${key}: coil span ${length} > 2000 — falling back to individual reads`);
                                        for (const b of buckets.coil) {
                                            const t0 = Date.now();
                                            const res = await client.readCoils(b.rawAddr, 1);
                                            const val = res.data[0] ? 1 : 0;
                                            deviceUpdates.push({ signal_id: b.s.id, value: val, type: b.s.type });
                                            log.info(`[Polling Indiv] ${key} | Signal: "${b.s.label}" (id=${b.s.id}) | OrigAddr: ${b.origAddr} -> RawAddr: ${b.rawAddr} | Value: ${val} | ${Date.now() - t0} ms`);
                                            await new Promise(r => setTimeout(r, 50)); // Pace individual reads
                                        }
                                    }
                                } catch (e) {
                                    log.error(`[Polling] ${key}: coil bucket FAILED — ${e.message}`);
                                }
                            }
                            // Merge device results inside enqueue so partial results are always kept
                            updates.push(...deviceUpdates);
                        });
                    } catch (e) {
                        // Log but continue polling other devices
                        log.error(`[Polling] ${key}: enqueue FAILED — ${e.message}`);
                    }
                })());
            }

            // Wait for all devices to finish their polling queues
            await Promise.all(promises);
            log.info(`[Polling] tick complete — ${updates.length} update(s) collected in ${Date.now() - tickStart} ms`);

            if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && updates.length > 0) {
                log.info(`[Polling] broadcasting state-update IPC with ${updates.length} signal value(s)`);
                mainWindow.webContents.send("state-update", updates);
            } else if (updates.length === 0) {
                log.info('[Polling] no updates to broadcast this tick');
            }

        } catch (e) {
            log.error(`[Polling] unhandled error in polling tick after ${Date.now() - tickStart} ms:`, e);
        } finally {
            // Issue 3 fix: always release the guard so the next tick can run.
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
    for (const dev of devices) {
        if (dev.ip && dev.port) {
            log.info(`[IPC] modbus:disconnectAll — disconnecting ${dev.ip}:${dev.port}`);
            // Issue 9 fix: disconnect() now awaits queue drain before closing socket.
            await modbusManager.disconnect(dev.ip, dev.port);
        }
    }
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
        // Issue 8 fix: use enqueueHighPriority so this write skips the 50 ms pace delay.
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
        // Issue 1 fix: use cached signals
        const signals = await getCachedSignals();
        const sig = signals.find(s => s.id === signal_id);

        if (!sig) {
            log.warn(`[IPC] modbus:preemptWrite — signal_id=${signal_id} not found in mapped signals`);
        } else if (!sig.ip || !sig.port || sig.read_register == null) {
            log.warn(`[IPC] modbus:preemptWrite — signal "${sig.label}" missing ip/port/read_register — skipping write`);
        } else {
            log.info(`[IPC] modbus:preemptWrite — writing ${value} to signal "${sig.label}" at ${sig.ip}:${sig.port} register=${sig.read_register} type=${sig.type} encoding=${sig.encoding}`);
            const t0 = Date.now();
            // Issue 8 fix: use enqueueHighPriority so this write skips the 50 ms pace delay.
            await modbusManager.enqueueHighPriority(sig.ip, sig.port, async (client) => {
                const rawAddr = toProtocolAddress(sig.read_register, sig.type);
                const origAddr = parseInt(sig.read_register);
                const isAnalog = sig.type.startsWith('analog');
                log.info(`[IPC] modbus:preemptWrite — rawAddr=${rawAddr} origAddr=${origAddr} isAnalog=${isAnalog}`);

                if (isAnalog) {
                    const regs = floatToRegisters(parseFloat(value), sig.encoding);
                    log.info(`[IPC] modbus:preemptWrite — floatToRegisters(${value}, ${sig.encoding}) => [${regs.join(',')}]`);
                    if (origAddr >= 40000 && origAddr < 50000) {
                        await client.writeRegisters(rawAddr, regs);
                        log.info(`[IPC] modbus:preemptWrite — writeRegisters(${rawAddr}, [${regs.join(',')}]) sent`);
                    } else {
                        throw new Error("Cannot write analog value to non-holding register");
                    }
                } else {
                    if (origAddr >= 40000 && origAddr < 50000) {
                        await client.writeRegister(rawAddr, parseInt(value));
                        log.info(`[IPC] modbus:preemptWrite — writeRegister(${rawAddr}, ${parseInt(value)}) sent`);
                    } else if (origAddr < 10000) {
                        await client.writeCoil(rawAddr, !!value);
                        log.info(`[IPC] modbus:preemptWrite — writeCoil(${rawAddr}, ${!!value}) sent`);
                    } else {
                        throw new Error("Cannot write to read-only address space");
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

// SQLite Database interactions
ipcMain.handle('db:getMappedSignals', async (event) => {
    return await db.getMappedSignals();
});

ipcMain.handle("db:addMappedSignal", async (event, signal) => {
    // Issue 1 fix: invalidate cache on any mutation
    invalidateSignalCache();
    return await db.addMappedSignal(signal);
});

ipcMain.handle("db:updateMappedSignal", async (event, signal) => {
    // Issue 1 fix: invalidate cache on any mutation
    invalidateSignalCache();
    return await db.updateMappedSignal(signal);
});

ipcMain.handle("db:deleteMappedSignal", async (event, id) => {
    // Issue 1 fix: invalidate cache on any mutation
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
        // Issue 1 fix: use cached signals
        const signals = await getCachedSignals();
        const sig = signals.find(s => s.label === label);
        if (!sig) {
            log.error(`[IPC] calibration:perform — signal "${label}" not found in mapped signals`);
            throw new Error("Signal mapping not found");
        }
        log.info(`[IPC] calibration:perform — found signal id=${sig.id} at ${sig.ip}:${sig.port} type=${sig.type} encoding=${sig.encoding}`);
        log.info(`[IPC] calibration:perform — cal registers: scale=${sig.cal_scale_reg} offset=${sig.cal_offset_reg} deadzone=${sig.cal_deadzone_reg}`);

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
        // Issue 8 fix: calibration writes are user-initiated — use high priority.
        await modbusManager.enqueueHighPriority(sig.ip, sig.port, async (client) => {
            const rawScale = toProtocolAddress(sig.cal_scale_reg, 'holding');
            log.info(`[IPC] calibration:perform — writeRegisters scale: reg=${sig.cal_scale_reg} rawAddr=${rawScale} regs=[${scaleRegs.join(',')}]`);
            await client.writeRegisters(rawScale, scaleRegs);

            const rawOffset = toProtocolAddress(sig.cal_offset_reg, 'holding');
            log.info(`[IPC] calibration:perform — writeRegisters offset: reg=${sig.cal_offset_reg} rawAddr=${rawOffset} regs=[${offsetRegs.join(',')}]`);
            await client.writeRegisters(rawOffset, offsetRegs);

            const rawDz = toProtocolAddress(sig.cal_deadzone_reg, 'holding');
            log.info(`[IPC] calibration:perform — writeRegisters deadzone: reg=${sig.cal_deadzone_reg} rawAddr=${rawDz} regs=[${deadzoneRegs.join(',')}]`);
            await client.writeRegisters(rawDz, deadzoneRegs);

            // Handshake
            if (dev.key1 !== null && dev.key2 !== null) {
                const rawKey1 = toProtocolAddress(dev.key1, 'holding');
                const rawKey2 = toProtocolAddress(dev.key2, 'holding');
                log.info(`[IPC] calibration:perform — handshake: writing 0x5555 to key1 reg=${dev.key1} rawAddr=${rawKey1}`);
                await client.writeRegister(rawKey1, 0x5555);
                log.info(`[IPC] calibration:perform — handshake: writing 0xDDDD to key2 reg=${dev.key2} rawAddr=${rawKey2}`);
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
