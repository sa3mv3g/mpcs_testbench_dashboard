const ModbusRTU = require('modbus-serial');
const log = require('electron-log');
const EventEmitter = require('events');

class ModbusManager extends EventEmitter {
    constructor() {
        super();
        // Map of connection keys (e.g., '192.168.1.100:502') to { client, queue, isConnected }
        this.connections = new Map();
        // Per-device queue depth counter for observability
        this._queueDepth = new Map();
        /* Cache last-broadcast status to suppress unchanged log spam */
        this._lastStatusJson = '';
        /*
         * Priority queue support — each device has a separate high-priority slot
         * implemented via a flag; the next enqueue call checks it and runs immediately.
         */
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
                .then(() => this.connect(device.ip, device.port));
        }));

        log.info(`[ModbusManager] initDevices: done. Connection map size = ${this.connections.size}`);
    }

    /**
     * Connects to a device and stores it in the manager.
     */
    async connect(ip, port) {
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
            queue: Promise.resolve(), // Mutex queue
            isConnected: false,
            reconnectTimer: null,
            retryCount: 0,  // Tracks how many consecutive reconnect attempts have been made
            /*
             * Flag set by enqueueHighPriority to skip the 50 ms pace delay for the
             * next operation so user-initiated writes are not delayed behind polls.
             */
            _skipNextPaceDelay: false,
        };

        this.connections.set(key, connectionObj);
        this._queueDepth.set(key, 0);

        const attachListeners = (c) => {
            // Remove old listeners just in case
            c.removeAllListeners('error');
            c.removeAllListeners('close');
            
            c.on('error', (err) => {
                log.error(`[ModbusManager] SOCKET ERROR on ${key}: ${err.message || err}`);
                // Only trigger reconnect if we were previously connected.
                // If we are still connecting, let the connectTCP catch block handle it.
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
        } catch (err) {
            log.error(`[ModbusManager] connect(${key}): connectTCP FAILED — ${err.message || err}`);
            this._handleDisconnect(ip, port);
        }

        return connectionObj;
    }

    /**
     * Handles disconnection and attempts to reconnect.
     * Per-device jitter is added to the reconnect delay to avoid thundering herd.
     */
    _handleDisconnect(ip, port) {
        const key = this._getKey(ip, port);
        const connectionObj = this.connections.get(key);
        
        if (connectionObj) {
            if (connectionObj.reconnectTimer) {
                log.warn(`[ModbusManager] _handleDisconnect(${key}): reconnect timer already pending — skipping duplicate`);
                return; // Prevent multiple concurrent reconnect timers
            }
            
            connectionObj.isConnected = false;
            log.warn(`[ModbusManager] _handleDisconnect(${key}): marked disconnected, closing old socket`);
            // Clean up the old client just in case
            try { connectionObj.client.close(); } catch(e) {
                log.warn(`[ModbusManager] _handleDisconnect(${key}): error closing old socket — ${e.message}`);
            }

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
                if (this.connections.has(key) && !this.connections.get(key).isConnected) {
                    log.info(`[ModbusManager] reconnect(${key}): attempt #${connectionObj.retryCount} starting...`);
                    try {
                        // Create a brand new client instance to ensure clean socket state
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
                         * After connectTCP resolves, check whether disconnect() was called
                         * while we were awaiting the TCP handshake.  If the device has been
                         * removed from the map (or isConnected was cleared), the new socket
                         * is now orphaned — close it immediately so no descriptor leaks.
                         */
                        if (!this.connections.has(key) || !this.connections.get(key).isConnected === false) {
                            /* If the key is gone OR the stored obj is a different connectionObj, close the socket. */
                            const current = this.connections.get(key);
                            if (!current || current !== connectionObj) {
                                log.warn(`[ModbusManager] reconnect(${key}): device was removed during connectTCP — closing orphaned socket`);
                                try { newClient.close(); } catch (_) {}
                                return;
                            }
                        }
                        /* Guard against isConnected being cleared by disconnect() */
                        if (!connectionObj.isConnected && !this.connections.has(key)) {
                            log.warn(`[ModbusManager] reconnect(${key}): disconnect() called during connectTCP — closing orphaned socket`);
                            try { newClient.close(); } catch (_) {}
                            return;
                        }
                        
                        // Replace the old client
                        connectionObj.client = newClient;
                        connectionObj.isConnected = true;
                        connectionObj.retryCount = 0;

                        log.info(`[ModbusManager] reconnect(${key}): SUCCESS in ${Date.now() - t0} ms`);
                        this.emit('connected', { ip, port: parseInt(port) });
                    } catch (e) {
                        log.error(`[ModbusManager] reconnect(${key}): FAILED — ${e.message || e} — will retry`);
                        this._handleDisconnect(ip, port); // Trigger another retry
                    }
                } else {
                    log.info(`[ModbusManager] reconnect(${key}): skipped — device removed or already connected`);
                }
            }, retryDelay);
        } else {
            log.warn(`[ModbusManager] _handleDisconnect(${key}): no connection object found — nothing to do`);
        }
    }

    /**
     * Disconnects a specific device and marks it as disconnecting so in-flight
     * enqueue operations abort cleanly.
     */
    async disconnect(ip, port) {
        const key = this._getKey(ip, port);
        const connectionObj = this.connections.get(key);
        if (connectionObj) {
            log.info(`[ModbusManager] disconnect(${key}): removing from map and closing socket`);
            /*
             * Set isConnected=false BEFORE removing from map so that any in-flight
             * enqueue() that already captured connectionObj by reference will see the
             * disconnected state and abort rather than use a closed socket.
             */
            connectionObj.isConnected = false;
            this.connections.delete(key); // Remove so auto-reconnect stops
            this._queueDepth.delete(key);
            /* Cancel any pending reconnect timer so it doesn't fire after disconnect
             * and corrupt the next connect() call for the same device. */
            if (connectionObj.reconnectTimer) {
                log.info(`[ModbusManager] disconnect(${key}): cancelling pending reconnect timer`);
                clearTimeout(connectionObj.reconnectTimer);
                connectionObj.reconnectTimer = null;
            }
            /*
             * Wait for the current queue to drain before closing the socket so
             * in-flight operations complete cleanly rather than hitting a closed port.
             */
            try {
                await connectionObj.queue;
            } catch (_) {
                // Ignore any errors from the draining queue
            }
            try {
                connectionObj.client.close();
                log.info(`[ModbusManager] disconnect(${key}): socket closed cleanly`);
            } catch (e) {
                log.error(`[ModbusManager] disconnect(${key}): error closing socket — ${e.message}`);
            }
        } else {
            log.warn(`[ModbusManager] disconnect(${key}): no connection object found — already disconnected?`);
        }
    }

    /**
     * Returns an array of current connection statuses.
     * Only logs when the status has actually changed to suppress spam.
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
                queueDepth: this._queueDepth.get(key) || 0
            });
        }
        /* Suppress log if nothing changed since last call */
        const json = JSON.stringify(statuses);
        if (json !== this._lastStatusJson) {
            log.info(`[ModbusManager] getConnectionStatuses CHANGED: ${json}`);
            this._lastStatusJson = json;
        }
        return statuses;
    }

    /**
     * High-priority enqueue for user-initiated writes.
     * Sets a flag that causes the NEXT operation in the queue to skip the 50 ms
     * inter-operation pace delay, so the write executes as soon as the current
     * poll completes without the extra 50 ms dead time.
     */
    async enqueueHighPriority(ip, port, operation) {
        const key = this._getKey(ip, port);
        const connectionObj = this.connections.get(key);
        if (connectionObj) {
            connectionObj._skipNextPaceDelay = true;
            log.info(`[ModbusManager] enqueueHighPriority(${key}): flagged to skip next pace delay`);
        }
        return this.enqueue(ip, port, operation);
    }

    /**
     * Executes a Modbus operation sequentially using a promise queue (Mutex).
     * The 50 ms pace delay is skipped when _skipNextPaceDelay is set
     * (used by enqueueHighPriority for user-initiated writes).
     * @param {string} ip
     * @param {number} port
     * @param {function} operation - Async function taking the 'client' as an argument.
     */
    async enqueue(ip, port, operation) {
        const key = this._getKey(ip, port);
        let connectionObj = this.connections.get(key);
        
        // If device is not known, try to connect (e.g. ad-hoc requests)
        if (!connectionObj) {
            log.info(`[ModbusManager] enqueue(${key}): no connection object — attempting ad-hoc connect`);
            connectionObj = await this.connect(ip, port);
        }

        if (!connectionObj.isConnected || (connectionObj.client && !connectionObj.client.isOpen)) {
            if (connectionObj.isConnected) {
                log.warn(`[ModbusManager] enqueue(${key}): isConnected=true but socket is closed — triggering reconnect`);
                this._handleDisconnect(ip, port);
            } else {
                log.warn(`[ModbusManager] enqueue(${key}): device not connected — rejecting operation`);
            }
            throw new Error(`Device at ${ip}:${port} is not connected or port is closed`);
        }

        // Track queue depth
        const depth = (this._queueDepth.get(key) || 0) + 1;
        this._queueDepth.set(key, depth);
        if (depth > 1) {
            log.warn(`[ModbusManager] enqueue(${key}): queue depth is now ${depth} — operations are backing up`);
        } else {
            log.info(`[ModbusManager] enqueue(${key}): queuing operation (depth=${depth})`);
        }

        return new Promise((resolve, reject) => {
            connectionObj.queue = connectionObj.queue.then(async () => {
                /* Abort if the device was disconnected while we were waiting in the queue */
                if (!connectionObj.isConnected) {
                    log.warn(`[ModbusManager] enqueue(${key}): device disconnected while queued — aborting operation`);
                    this._queueDepth.set(key, Math.max(0, (this._queueDepth.get(key) || 1) - 1));
                    return reject(new Error(`Device at ${ip}:${port} was disconnected`));
                }

                // Double check openness right before executing the operation
                if (!connectionObj.client.isOpen) {
                    log.error(`[ModbusManager] enqueue(${key}): socket closed just before execution — triggering reconnect`);
                    this._queueDepth.set(key, Math.max(0, (this._queueDepth.get(key) || 1) - 1));
                    this._handleDisconnect(ip, port);
                    return reject(new Error("Port Not Open"));
                }
                
                const t0 = Date.now();
                try {
                    const result = await operation(connectionObj.client);
                    const elapsed = Date.now() - t0;
                    log.info(`[ModbusManager] enqueue(${key}): operation completed in ${elapsed} ms`);

                    /*
                     * Only apply the 50 ms inter-operation pace delay when there are more
                     * operations waiting in the queue AND the high-priority flag has not
                     * been set.  This eliminates dead time for the last op in a batch and
                     * for user-initiated writes.
                     */
                    const remainingDepth = (this._queueDepth.get(key) || 1) - 1;
                    const skipDelay = connectionObj._skipNextPaceDelay;
                    connectionObj._skipNextPaceDelay = false; // consume the flag
                    if (remainingDepth > 0 && !skipDelay) {
                        await new Promise(r => setTimeout(r, 50));
                    }

                    this._queueDepth.set(key, Math.max(0, remainingDepth));
                    resolve(result);
                } catch (err) {
                    const elapsed = Date.now() - t0;
                    log.error(`[ModbusManager] enqueue(${key}): operation FAILED after ${elapsed} ms — ${err.message}`);
                    connectionObj._skipNextPaceDelay = false; // consume the flag on error too
                    this._queueDepth.set(key, Math.max(0, (this._queueDepth.get(key) || 1) - 1));
                    reject(err);
                }
            }).catch((chainErr) => {
                // Ignore queue chain errors to keep it moving
                log.warn(`[ModbusManager] enqueue(${key}): queue chain error swallowed — ${chainErr && chainErr.message}`);
            });
        });
    }
}

module.exports = new ModbusManager();
