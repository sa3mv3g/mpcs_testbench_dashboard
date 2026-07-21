const ModbusRTU = require('modbus-serial');
const log = require('electron-log');
const EventEmitter = require('events');

class ModbusManager extends EventEmitter {
    constructor() {
        super();
        /*
         * Map of connection keys (e.g., '192.168.1.100:502') to connectionObj.
         * connectionObj shape:
         *   client          — ModbusRTU instance
         *   readQueue       — Array<{op, resolve, reject}> — polling reads (lower priority)
         *   writeQueue      — Array<{op, resolve, reject}> — user writes (higher priority)
         *   isRunning       — boolean — true while _drain() is executing
         *   isConnected     — boolean
         *   reconnectTimer  — setTimeout handle | null
         *   retryCount      — number of consecutive reconnect attempts
         *   aborted         — boolean — set by disconnect() to abort pending reconnects
         */
        this.connections = new Map();
    }

    _getKey(ip, port) {
        return `${ip}:${port}`;
    }

    /**
     * Initializes connections for a list of devices in parallel.
     * Connect attempts are staggered with per-device jitter to avoid thundering-herd.
     * retryCount is reset when explicitly re-initialising a device.
     */
    async initDevices(devices) {
        const valid = devices.filter(d => d.ip && d.port);
        log.info(`[ModbusManager] initDevices: initialising ${valid.length} device(s): ${valid.map(d => `${d.ip}:${d.port}`).join(', ')}`);

        /*
         * If a device is already tracked (e.g. reconnect after failure), reset its
         * retryCount so the fast 1 s retry path is available again.
         */
        for (const device of valid) {
            const key = this._getKey(device.ip, device.port);
            const existing = this.connections.get(key);
            if (existing) {
                existing.retryCount = 0;
                log.info(`[ModbusManager] initDevices: reset retryCount for ${key}`);
            }
        }

        /*
         * Stagger parallel connect attempts by 50–200 ms jitter per device
         * to avoid all TCP SYNs hitting the network simultaneously.
         */
        await Promise.allSettled(valid.map((device, idx) => {
            const jitter = idx * 50 + Math.floor(Math.random() * 50);
            return new Promise(resolve => setTimeout(resolve, jitter))
                .then(() => this.connect(device.ip, device.port, device.id));
        }));

        log.info(`[ModbusManager] initDevices: done. Connection map size = ${this.connections.size}`);
    }

    /**
     * Connects to a device and stores it in the manager.
     * Emits 'statusChanged' on successful connection.
     */
    async connect(ip, port, unitId = 1) {
        const key = this._getKey(ip, port);
        if (this.connections.has(key)) {
            log.info(`[ModbusManager] connect(${key}): already tracked, skipping duplicate connect`);
            return this.connections.get(key);
        }

        log.info(`[ModbusManager] connect(${key}): creating new connection object`);
        const client = new ModbusRTU();
        client.setTimeout(5000); // 5s timeout to ensure slow devices have time to connect

        const connectionObj = {
            client,
            unitId,
            readQueue:  [],    // polling reads — lower priority
            writeQueue: [],    // user writes  — higher priority
            isRunning:  false, // true while _drain() is executing
            isConnected: false,
            reconnectTimer: null,
            retryCount: 0,
            aborted: false,    // set by disconnect() to abort pending reconnects
        };

        this.connections.set(key, connectionObj);

        const attachListeners = (c) => {
            c.removeAllListeners('error');
            c.removeAllListeners('close');

            c.on('error', (err) => {
                log.error(`[ModbusManager] SOCKET ERROR on ${key}: ${err.message || err}`);
                if (connectionObj.isConnected) {
                    log.warn(`[ModbusManager] ${key}: was connected — triggering disconnect handler`);
                    this._handleDisconnect(ip, port);
                }
            });
            c.on('close', () => {
                log.warn(`[ModbusManager] SOCKET CLOSED on ${key} (isConnected=${connectionObj.isConnected})`);
                if (connectionObj.isConnected) {
                    this._handleDisconnect(ip, port);
                }
            });
        };

        attachListeners(client);

        try {
            log.info(`[ModbusManager] connect(${key}): calling connectTCP...`);
            const t0 = Date.now();
            await client.connectTCP(ip, { port: parseInt(port) });
            connectionObj.isConnected = true;
            connectionObj.retryCount = 0;
            log.info(`[ModbusManager] connect(${key}): TCP connected in ${Date.now() - t0} ms`);
            this.emit('connected', { ip, port: parseInt(port) });
            this.emit('statusChanged', this.getConnectionStatuses());
        } catch (err) {
            log.error(`[ModbusManager] connect(${key}): connectTCP FAILED — ${err.message || err}`);
            this._handleDisconnect(ip, port);
        }

        return connectionObj;
    }

    /**
     * Handles disconnection and schedules a reconnect attempt.
     * Per-device jitter is added to the reconnect delay to avoid thundering herd.
     * Emits 'statusChanged' when the device is marked disconnected.
     */
    _handleDisconnect(ip, port) {
        const key = this._getKey(ip, port);
        const connectionObj = this.connections.get(key);

        if (!connectionObj) {
            log.warn(`[ModbusManager] _handleDisconnect(${key}): no connection object found — nothing to do`);
            return;
        }

        if (connectionObj.reconnectTimer) {
            log.warn(`[ModbusManager] _handleDisconnect(${key}): reconnect timer already pending — skipping duplicate`);
            return;
        }

        connectionObj.isConnected = false;
        log.warn(`[ModbusManager] _handleDisconnect(${key}): marked disconnected, closing old socket`);
        try { connectionObj.client.close(); } catch (e) {
            log.warn(`[ModbusManager] _handleDisconnect(${key}): error closing old socket — ${e.message}`);
        }

        // Notify UI immediately that this device is offline
        this.emit('statusChanged', this.getConnectionStatuses());

        /*
         * Add random jitter (0–500 ms) to stagger reconnect attempts across
         * multiple offline devices so they don't all fire simultaneously.
         */
        const baseDelay = connectionObj.retryCount === 0 ? 1000 : 5000;
        const jitter = Math.floor(Math.random() * 500);
        const retryDelay = baseDelay + jitter;
        connectionObj.retryCount++;
        log.info(`[ModbusManager] _handleDisconnect(${key}): scheduling reconnect attempt #${connectionObj.retryCount} in ${retryDelay} ms (base=${baseDelay} jitter=${jitter})`);

        connectionObj.reconnectTimer = setTimeout(async () => {
            connectionObj.reconnectTimer = null;

            // Bail immediately if disconnect() was called while we were waiting
            if (connectionObj.aborted) {
                log.info(`[ModbusManager] reconnect(${key}): aborted — skipping`);
                return;
            }

            if (!this.connections.has(key) || this.connections.get(key).isConnected) {
                log.info(`[ModbusManager] reconnect(${key}): skipped — device removed or already connected`);
                return;
            }

            log.info(`[ModbusManager] reconnect(${key}): attempt #${connectionObj.retryCount} starting...`);
            try {
                const newClient = new ModbusRTU();
                newClient.setTimeout(5000);

                // Attach listeners to the new instance BEFORE connecting
                newClient.on('error', (err) => {
                    log.error(`[ModbusManager] SOCKET ERROR on ${key} (new client): ${err.message || err}`);
                    if (connectionObj.isConnected) this._handleDisconnect(ip, port);
                });
                newClient.on('close', () => {
                    log.warn(`[ModbusManager] SOCKET CLOSED on ${key} (new client)`);
                    if (connectionObj.isConnected) this._handleDisconnect(ip, port);
                });

                const t0 = Date.now();
                await newClient.connectTCP(ip, { port: parseInt(port) });

                /*
                 * Check the aborted flag AGAIN after the async TCP handshake gap.
                 * disconnect() may have been called while connectTCP was awaiting.
                 * If so, close the new socket immediately to prevent a zombie.
                 */
                if (connectionObj.aborted) {
                    log.warn(`[ModbusManager] reconnect(${key}): aborted during connectTCP — closing orphaned socket`);
                    try { newClient.close(); } catch (_) {}
                    return;
                }

                // Replace the old client
                connectionObj.client = newClient;
                connectionObj.isConnected = true;
                connectionObj.retryCount = 0;

                log.info(`[ModbusManager] reconnect(${key}): SUCCESS in ${Date.now() - t0} ms`);
                this.emit('connected', { ip, port: parseInt(port) });
                this.emit('statusChanged', this.getConnectionStatuses());
            } catch (e) {
                log.error(`[ModbusManager] reconnect(${key}): FAILED — ${e.message || e} — will retry`);
                if (!connectionObj.aborted) {
                    this._handleDisconnect(ip, port); // Trigger another retry only if not aborted
                }
            }
        }, retryDelay);
    }

    /**
     * Disconnects a specific device cleanly.
     *
     * Sets the aborted flag BEFORE removing from the map so any in-flight
     * connectTCP (in a reconnect timer) will see it and close the new socket
     * rather than leaving a zombie.
     *
     * Rejects all queued operations immediately, then waits up to 200 ms for
     * any currently-executing operation to finish before force-closing the socket.
     */
    async disconnect(ip, port) {
        const key = this._getKey(ip, port);
        const connectionObj = this.connections.get(key);
        if (!connectionObj) {
            log.warn(`[ModbusManager] disconnect(${key}): no connection object found — already disconnected?`);
            return;
        }

        log.info(`[ModbusManager] disconnect(${key}): initiating clean disconnect`);

        // Signal all pending reconnect timers to abort
        connectionObj.aborted = true;
        connectionObj.isConnected = false;

        // Remove from map so auto-reconnect stops and new enqueue() calls are rejected
        this.connections.delete(key);

        // Cancel any pending reconnect timer
        if (connectionObj.reconnectTimer) {
            log.info(`[ModbusManager] disconnect(${key}): cancelling pending reconnect timer`);
            clearTimeout(connectionObj.reconnectTimer);
            connectionObj.reconnectTimer = null;
        }

        // Reject all queued (not yet started) operations immediately
        const pendingOps = [...connectionObj.writeQueue, ...connectionObj.readQueue];
        connectionObj.writeQueue = [];
        connectionObj.readQueue = [];
        for (const item of pendingOps) {
            item.reject(new Error(`Device at ${ip}:${port} was disconnected`));
        }
        if (pendingOps.length > 0) {
            log.info(`[ModbusManager] disconnect(${key}): rejected ${pendingOps.length} queued operation(s)`);
        }

        /*
         * Wait up to 200 ms for any currently-executing operation (_drain isRunning)
         * to finish before force-closing the socket.  This prevents a closed-port
         * error on the in-flight frame while still bounding the disconnect time.
         */
        if (connectionObj.isRunning) {
            log.info(`[ModbusManager] disconnect(${key}): waiting up to 200 ms for in-flight operation to finish`);
            await Promise.race([
                new Promise(resolve => {
                    const poll = setInterval(() => {
                        if (!connectionObj.isRunning) { clearInterval(poll); resolve(); }
                    }, 10);
                }),
                new Promise(resolve => setTimeout(resolve, 200)),
            ]);
        }

        try {
            connectionObj.client.close();
            log.info(`[ModbusManager] disconnect(${key}): socket closed cleanly`);
        } catch (e) {
            log.error(`[ModbusManager] disconnect(${key}): error closing socket — ${e.message}`);
        }

        this.emit('statusChanged', this.getConnectionStatuses());
    }

    /**
     * Returns an array of current connection statuses.
     */
    getConnectionStatuses() {
        const statuses = [];
        for (const [key, obj] of this.connections.entries()) {
            const [ip, port] = key.split(':');
            const actuallyConnected = obj.isConnected && obj.client && obj.client.isOpen;
            statuses.push({
                ip,
                port,
                isConnected: actuallyConnected,
                retryCount: obj.retryCount,
                queueDepth: obj.readQueue.length + obj.writeQueue.length + (obj.isRunning ? 1 : 0),
                error: obj.error
            });
        }
        return statuses;
    }

    /**
     * Internal queue runner.
     *
     * Drains writeQueue (user writes) before readQueue (polling reads) so that
     * user-initiated writes always execute as soon as the current Modbus frame
     * completes — they never wait behind a full poll block.
     *
     * Only one _drain() runs per device at a time (isRunning guard).
     */
    async _drain(connectionObj, ip, port) {
        if (connectionObj.isRunning) return;
        connectionObj.isRunning = true;

        const key = this._getKey(ip, port);

        while (connectionObj.writeQueue.length > 0 || connectionObj.readQueue.length > 0) {
            // Always service writes before reads
            const item = connectionObj.writeQueue.shift() || connectionObj.readQueue.shift();

            // Abort if the device was disconnected while we were waiting
            if (!connectionObj.isConnected) {
                log.warn(`[ModbusManager] _drain(${key}): device disconnected — aborting queued operation`);
                item.reject(new Error(`Device at ${ip}:${port} was disconnected`));
                continue;
            }

            // Double-check socket openness right before executing
            if (!connectionObj.client || !connectionObj.client.isOpen) {
                log.error(`[ModbusManager] _drain(${key}): socket closed just before execution — triggering reconnect`);
                this._handleDisconnect(ip, port);
                item.reject(new Error('Port Not Open'));
                continue;
            }

            const t0 = Date.now();
            try {
                const result = await item.op(connectionObj.client);
                log.info(`[ModbusManager] _drain(${key}): operation completed in ${Date.now() - t0} ms`);
                item.resolve(result);
            } catch (err) {
                log.error(`[ModbusManager] _drain(${key}): operation FAILED after ${Date.now() - t0} ms — ${err.message}`);
                item.reject(err);
            }
        }

        connectionObj.isRunning = false;
    }

    /**
     * Enqueues a Modbus operation in the read queue (lower priority).
     * Used by the polling loop.
     *
     * @param {string} ip
     * @param {number} port
     * @param {function} operation - Async function taking the ModbusRTU client.
     */
    enqueue(ip, port, operation) {
        const key = this._getKey(ip, port);
        let connectionObj = this.connections.get(key);

        if (!connectionObj) {
            log.warn(`[ModbusManager] enqueue(${key}): no connection object — device not initialised`);
            return Promise.reject(new Error(`Device at ${ip}:${port} is not connected`));
        }

        if (!connectionObj.isConnected || (connectionObj.client && !connectionObj.client.isOpen)) {
            if (connectionObj.isConnected) {
                log.warn(`[ModbusManager] enqueue(${key}): isConnected=true but socket is closed — triggering reconnect`);
                this._handleDisconnect(ip, port);
            } else {
                log.warn(`[ModbusManager] enqueue(${key}): device not connected — rejecting operation`);
            }
            return Promise.reject(new Error(`Device at ${ip}:${port} is not connected or port is closed`));
        }

        const depth = connectionObj.readQueue.length + connectionObj.writeQueue.length + (connectionObj.isRunning ? 1 : 0);
        if (depth > 0) {
            log.warn(`[ModbusManager] enqueue(${key}): read queue depth=${connectionObj.readQueue.length} — operations backing up`);
        } else {
            log.info(`[ModbusManager] enqueue(${key}): queuing read operation`);
        }

        return new Promise((resolve, reject) => {
            connectionObj.readQueue.push({ op: operation, resolve, reject });
            this._drain(connectionObj, ip, port);
        });
    }

    /**
     * Enqueues a Modbus operation in the write queue (higher priority).
     * Used for user-initiated writes and calibration.
     * The write will execute before any pending read operations.
     *
     * @param {string} ip
     * @param {number} port
     * @param {function} operation - Async function taking the ModbusRTU client.
     */
    enqueueHighPriority(ip, port, operation) {
        const key = this._getKey(ip, port);
        let connectionObj = this.connections.get(key);

        if (!connectionObj) {
            log.warn(`[ModbusManager] enqueueHighPriority(${key}): no connection object — device not initialised`);
            return Promise.reject(new Error(`Device at ${ip}:${port} is not connected`));
        }

        if (!connectionObj.isConnected || (connectionObj.client && !connectionObj.client.isOpen)) {
            if (connectionObj.isConnected) {
                log.warn(`[ModbusManager] enqueueHighPriority(${key}): isConnected=true but socket is closed — triggering reconnect`);
                this._handleDisconnect(ip, port);
            } else {
                log.warn(`[ModbusManager] enqueueHighPriority(${key}): device not connected — rejecting operation`);
            }
            return Promise.reject(new Error(`Device at ${ip}:${port} is not connected or port is closed`));
        }

        log.info(`[ModbusManager] enqueueHighPriority(${key}): queuing high-priority write operation`);

        return new Promise((resolve, reject) => {
            connectionObj.writeQueue.push({ op: operation, resolve, reject });
            this._drain(connectionObj, ip, port);
        });
    }
}

const instance = new ModbusManager();
instance.ModbusManager = ModbusManager;
module.exports = instance;
