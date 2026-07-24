const ModbusRTU = require('modbus-serial');
const log = require('electron-log');
const EventEmitter = require('events');
const { attachTidGuard } = require('./tid-guard');

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
         *   isConnected     — boolean (legacy, mapped from state === 'LIVE'/'PROBATION')
         *   state           — string ('DISCONNECTED'|'CONNECTING'|'PROBATION'|'LIVE'|'DYING'|'BACKOFF'|'DRAINING')
         *   reconnectTimer  — setTimeout handle | null
         *   backoffIndex    — number (index into backoff ladder, replaces retryCount)
         *   generation      — number (increments on reconnect to drop stale timer callbacks)
         *   aborted         — boolean — set by disconnect()/shutdownAll() to abort pending reconnects
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
            if (existing && existing.reconnectTimer) {
                // Short-circuit backoff to connect immediately
                log.info(`[ModbusManager] initDevices: fast-forwarding backoff for ${key}`);
                clearTimeout(existing.reconnectTimer);
                existing.reconnectTimer = null;
                this._doReconnect(device.ip, device.port, existing);
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
            state: 'DISCONNECTED',
            reconnectTimer: null,
            backoffIndex: 0,
            generation: 0,
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
            this._logTransition(key, connectionObj.state, 'CONNECTING', 'initial connect');
            connectionObj.state = 'CONNECTING';
            log.info(`[ModbusManager] connect(${key}): calling connectTCP...`);
            const t0 = Date.now();
            await client.connectTCP(ip, { port: parseInt(port) });

            if (connectionObj.aborted) {
                log.warn(`[ModbusManager] connect(${key}): aborted during connectTCP`);
                try { client.close(); } catch (_) {}
                return connectionObj;
            }

            // TCP Keepalive backstop
            try {
                if (client._port && client._port._client && typeof client._port._client.setKeepAlive === 'function') {
                    client._port._client.setKeepAlive(true, 15000);
                } else {
                    log.warn(`[ModbusManager] connect(${key}): Could not set TCP KeepAlive - internal modbus-serial structure changed?`);
                }
            } catch (e) {
                log.warn(`[ModbusManager] connect(${key}): Error setting TCP KeepAlive - ${e.message}`);
            }

            connectionObj.isConnected = true; // Legacy flag, mostly means 'TCP is up'
            this._logTransition(key, 'CONNECTING', 'PROBATION', `TCP connected in ${Date.now() - t0} ms`);
            connectionObj.state = 'PROBATION';

            attachTidGuard(client, ip, port, this);

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
        
        // Strict single socket: Must fully destroy old socket before connecting a new one.
        // The actual reconnect logic is separated into an async flow below.
        this._executeDisconnectAndReconnect(key, ip, port, connectionObj);
    }

    async _executeDisconnectAndReconnect(key, ip, port, connectionObj) {
        if (connectionObj.state !== 'DYING') {
            this._logTransition(key, connectionObj.state, 'DYING', '_handleDisconnect');
            connectionObj.state = 'DYING';
        }

        log.warn(`[ModbusManager] _executeDisconnectAndReconnect(${key}): closing old socket`);
        if (connectionObj.client && (connectionObj.client.isOpen || connectionObj.client.isOpen === undefined)) {
            const closePromise = new Promise(resolve => {
                const handler = () => { connectionObj.client.removeListener('close', handler); resolve(); };
                connectionObj.client.once('close', handler);
            });
            try { connectionObj.client.close(); } catch (e) { log.warn(`[ModbusManager] error closing old socket — ${e.message}`); }

            // Bounded wait for full close
            await Promise.race([
                closePromise,
                new Promise(r => setTimeout(() => {
                    log.warn(`[ModbusManager] _executeDisconnectAndReconnect ${key}: force-destroying hanging socket`);
                    try { connectionObj.client._port._client.destroy(); } catch (_) {}
                    r();
                }, 1000))
            ]);
        }
        
        if (connectionObj.aborted) {
            log.info(`[ModbusManager] _executeDisconnectAndReconnect(${key}): aborted — stopping here`);
            return;
        }

        this._logTransition(key, 'DYING', 'BACKOFF', 'socket destroyed');
        connectionObj.state = 'BACKOFF';
        
        // Notify UI immediately that this device is offline
        this.emit('statusChanged', this.getConnectionStatuses());

        const backoffLadder = [1000, 2000, 5000, 10000];
        const baseDelay = backoffLadder[Math.min(connectionObj.backoffIndex, backoffLadder.length - 1)];
        const jitter = Math.floor(Math.random() * (baseDelay * 0.2)); // 20% jitter
        const retryDelay = baseDelay + jitter;
        
        // Only advance backoff AFTER using the current slot
        if (connectionObj.backoffIndex < backoffLadder.length - 1) {
            connectionObj.backoffIndex++;
        }

        log.info(`[ModbusManager] _executeDisconnectAndReconnect(${key}): scheduling reconnect attempt in ${retryDelay} ms (base=${baseDelay})`);

        connectionObj.generation++;
        const currentGen = connectionObj.generation;

        connectionObj.reconnectTimer = setTimeout(() => {
            if (connectionObj.generation !== currentGen) return; // Stale timer
            connectionObj.reconnectTimer = null;
            this._doReconnect(ip, port, connectionObj);
        }, retryDelay);
    }

    async _doReconnect(ip, port, connectionObj) {
        const key = this._getKey(ip, port);
        
        if (connectionObj.aborted || !this.connections.has(key)) {
            log.info(`[ModbusManager] reconnect(${key}): aborted — skipping`);
            return;
        }

        this._logTransition(key, connectionObj.state, 'CONNECTING', 'reconnect timer fired');
        connectionObj.state = 'CONNECTING';

        try {
            const newClient = new ModbusRTU();
            newClient.setTimeout(5000);

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

            if (connectionObj.aborted) {
                log.warn(`[ModbusManager] reconnect(${key}): aborted during connectTCP — closing orphaned socket`);
                try { newClient.close(); } catch (_) {}
                return;
            }

            // TCP Keepalive backstop
            try {
                if (newClient._port && newClient._port._client && typeof newClient._port._client.setKeepAlive === 'function') {
                    newClient._port._client.setKeepAlive(true, 15000);
                } else {
                    log.warn(`[ModbusManager] reconnect(${key}): Could not set TCP KeepAlive - internal modbus-serial structure changed?`);
                }
            } catch (e) {
                log.warn(`[ModbusManager] reconnect(${key}): Error setting TCP KeepAlive - ${e.message}`);
            }

            // Replace the old client
            connectionObj.client = newClient;
            connectionObj.isConnected = true;

            this._logTransition(key, 'CONNECTING', 'PROBATION', `SUCCESS in ${Date.now() - t0} ms`);
            connectionObj.state = 'PROBATION';
            
            // We DO NOT reset backoffIndex here. Only entering 'LIVE' resets it.

            attachTidGuard(newClient, ip, port, this);

            this.emit('connected', { ip, port: parseInt(port) });
            this.emit('statusChanged', this.getConnectionStatuses());
            
            // Trigger subclass hook (JerryDevice._probe)
            if (typeof this.onReconnected === 'function') {
                this.onReconnected(ip, port, connectionObj).catch(err => {
                    log.error(`[ModbusManager] onReconnected hook failed for ${key}: ${err.message}`);
                });
            }
        } catch (e) {
            log.error(`[ModbusManager] reconnect(${key}): FAILED — ${e.message || e}`);
            if (!connectionObj.aborted) {
                this._handleDisconnect(ip, port);
            }
        }
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
     * Helper to log state transitions to both console and file (via electron-log)
     * and to syslog (if configured in main.js).
     */
    _logTransition(key, from, to, detail) {
        log.warn(`[ModbusState] ${key} | ${from} -> ${to} | ${detail}`);
    }

    /**
     * Disconnects all devices completely. Sends graceful FIN, waits for close,
     * and optionally destroys sockets if they hang.
     */
    async shutdownAll(reason = 'shutdown') {
        log.info(`[ModbusManager] shutdownAll triggered: ${reason}`);
        const promises = [];
        for (const [key, obj] of this.connections.entries()) {
            promises.push((async () => {
                this._logTransition(key, obj.state || (obj.isConnected ? 'LIVE' : 'DISCONNECTED'), 'DRAINING', `shutdownAll: ${reason}`);
                obj.aborted = true;
                if (obj.reconnectTimer) {
                    clearTimeout(obj.reconnectTimer);
                    obj.reconnectTimer = null;
                }

                // Reject queues
                const pendingOps = [...obj.writeQueue, ...obj.readQueue];
                obj.writeQueue = [];
                obj.readQueue = [];
                for (const item of pendingOps) {
                    item.reject(new Error(`Shutdown: ${reason}`));
                }

                // Wait for any running drain
                if (obj.isRunning) {
                    await Promise.race([
                        new Promise(r => {
                            const p = setInterval(() => { if (!obj.isRunning) { clearInterval(p); r(); } }, 10);
                        }),
                        new Promise(r => setTimeout(r, 200))
                    ]);
                }

                // Close socket
                if (obj.client && obj.client.isOpen) {
                    const closePromise = new Promise(resolve => {
                        const handler = () => { obj.client.removeListener('close', handler); resolve(); };
                        obj.client.once('close', handler);
                    });
                    try { obj.client.close(); } catch (e) { log.warn(`[ModbusManager] shutdownAll ${key} close error: ${e.message}`); }
                    
                    // Race graceful close vs 1.5s timeout
                    await Promise.race([
                        closePromise,
                        new Promise(r => setTimeout(() => {
                            log.warn(`[ModbusManager] shutdownAll ${key}: force-destroying hanging socket`);
                            try { obj.client._port._client.destroy(); } catch (_) {}
                            r();
                        }, 1500))
                    ]);
                }
                
                obj.state = 'DISCONNECTED';
                this._logTransition(key, 'DRAINING', 'DISCONNECTED', 'socket closed/destroyed');
            })());
        }
        await Promise.all(promises);
        this.connections.clear();
        log.info(`[ModbusManager] shutdownAll complete.`);
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
                unitId: obj.unitId,
                isConnected: actuallyConnected,
                state: obj.state,
                backoffIndex: obj.backoffIndex,
                lastResponseAt: obj.lastResponseAt,
                consecutiveTimeouts: obj.consecutiveTimeouts || 0,
                tidMismatches: obj.tidMismatches || 0,
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
                
                // Liveness: success means we are alive
                connectionObj.consecutiveTimeouts = 0;
                connectionObj.lastResponseAt = Date.now();
                
                if (connectionObj.state === 'PROBATION') {
                    this._logTransition(key, 'PROBATION', 'LIVE', 'first successful round-trip');
                    connectionObj.state = 'LIVE';
                    connectionObj.backoffIndex = 0; // Reset backoff only here
                    this.emit('live', { ip, port: parseInt(port) });
                    this.emit('statusChanged', this.getConnectionStatuses());
                }

                item.resolve(result);
            } catch (err) {
                log.error(`[ModbusManager] _drain(${key}): operation FAILED after ${Date.now() - t0} ms — ${err.message}`);
                
                // Liveness: track consecutive timeouts
                if (err.message && (err.message.includes('Timed Out') || err.message.includes('Port Not Open') || err.message.includes('ECONN'))) {
                    connectionObj.consecutiveTimeouts = (connectionObj.consecutiveTimeouts || 0) + 1;
                    log.warn(`[ModbusManager] ${key}: timeout ${connectionObj.consecutiveTimeouts}/3`);
                    
                    if (connectionObj.consecutiveTimeouts >= 3 && connectionObj.state !== 'DYING') {
                        log.error(`[ModbusManager] ${key}: DECLARED-DEAD after 3 consecutive timeouts. Force closing socket.`);
                        this._logTransition(key, connectionObj.state, 'DYING', 'declared dead via timeouts');
                        connectionObj.state = 'DYING';
                        
                        // Reject all remaining in queue
                        const pendingOps = [...connectionObj.writeQueue, ...connectionObj.readQueue];
                        connectionObj.writeQueue = [];
                        connectionObj.readQueue = [];
                        for (const pItem of pendingOps) {
                            pItem.reject(new Error(`ConnectionDeclaredDead: 3 consecutive timeouts`));
                        }

                        // Force destroy the socket since it won't respond to FIN cleanly
                        if (connectionObj.client && connectionObj.client._port && connectionObj.client._port._client) {
                            try { connectionObj.client._port._client.destroy(); } catch (_) {}
                        }
                        
                        // Let the error or close handler pick it up, or trigger explicitly
                        this._handleDisconnect(ip, port);
                    }
                }

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
