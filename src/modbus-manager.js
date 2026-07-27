const ModbusRTU = require('modbus-serial');
const log = require('electron-log');
const EventEmitter = require('events');
const { attachTidGuard } = require('./tid-guard');

class ModbusManager extends EventEmitter {
    constructor() {
        super();
        this.connections = new Map();
    }

    _getKey(ip, port) {
        return `${ip}:${port}`;
    }

    /**
     * Initializes connections for a list of devices in parallel.
     */
    async initDevices(devices) {
        const valid = devices.filter(d => d.ip && d.port);
        log.info(`[ModbusManager] initDevices: initialising ${valid.length} device(s): ${valid.map(d => `${d.ip}:${d.port}`).join(', ')}`);

        for (const device of valid) {
            const key = this._getKey(device.ip, device.port);
            const existing = this.connections.get(key);
            if (existing && existing.reconnectTimer) {
                log.info(`[ModbusManager] initDevices: fast-forwarding backoff for ${key}`);
                clearTimeout(existing.reconnectTimer);
                existing.reconnectTimer = null;
                this._doReconnect(device.ip, device.port, existing);
            }
        }

        await Promise.allSettled(valid.map((device, idx) => {
            const jitter = idx * 50 + Math.floor(Math.random() * 50);
            return new Promise(resolve => setTimeout(resolve, jitter))
                .then(() => this.connect(device.ip, device.port, device.id));
        }));

        log.info(`[ModbusManager] initDevices: done. Connection map size = ${this.connections.size}`);
    }

    /**
     * Connects to a device and stores it in the manager.
     * Before creating a new socket, it ensures any existing socket for the same IP/port is fully closed.
     */
    async connect(ip, port, unitId = 1) {
        const key = this._getKey(ip, port);

        // Clean up any old/stale connection for this endpoint before opening a new one
        if (this.connections.has(key)) {
            log.warn(`[ModbusManager] connect(${key}): existing socket found — closing old connection first.`);
            await this.closeConnection(ip, port, 'Replacing existing socket');
        }

        log.info(`[ModbusManager] connect(${key}): creating new connection object`);
        const client = new ModbusRTU();
        client.setTimeout(500);

        const connectionObj = {
            client,
            unitId,
            readQueue:  [],
            writeQueue: [],
            isRunning:  false,
            isConnected: false,
            state: 'DISCONNECTED',
            reconnectTimer: null,
            backoffIndex: 0,
            generation: 0,
            aborted: false,
        };

        this.connections.set(key, connectionObj);

        const attachListeners = (c) => {
            c.removeAllListeners('error');
            c.removeAllListeners('close');

            c.on('error', (err) => {
                log.error(`[ModbusManager] SOCKET ERROR on ${key}: ${err.message || err}`);
                if (connectionObj.isConnected) {
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

            try {
                if (client._port && client._port._client && typeof client._port._client.setKeepAlive === 'function') {
                    client._port._client.setKeepAlive(true, 15000);
                } else {
                    log.warn(`[ModbusManager] connect(${key}): Could not set TCP KeepAlive`);
                }
            } catch (e) {
                log.warn(`[ModbusManager] connect(${key}): Error setting TCP KeepAlive - ${e.message}`);
            }

            connectionObj.isConnected = true;
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
     * API METHOD: Forcefully closes the socket for a given IP & Port.
     * Prevents auto-reconnection, flushes queues, and destroys the raw socket.
     *
     * @param {string} ip - IP address of the target device
     * @param {number} port - Port of the target device
     * @param {string} reason - Optional context message for logs
     */
    async closeConnection(ip, port, reason = 'Manual socket close requested') {
        const key = this._getKey(ip, port);
        const connectionObj = this.connections.get(key);

        if (!connectionObj) {
            log.warn(`[ModbusManager] closeConnection(${key}): connection object not found`);
            return;
        }

        log.info(`[ModbusManager] closeConnection(${key}): closing socket without retry (${reason})`);

        // 1. Mark aborted and offline to disable reconnect loops
        connectionObj.aborted = true;
        connectionObj.isConnected = false;
        connectionObj.state = 'DISCONNECTED';

        // 2. Remove from active map immediately
        this.connections.delete(key);

        // 3. Clear any pending reconnect timer
        if (connectionObj.reconnectTimer) {
            clearTimeout(connectionObj.reconnectTimer);
            connectionObj.reconnectTimer = null;
        }

        // 4. Reject queued operations
        const pendingOps = [...connectionObj.writeQueue, ...connectionObj.readQueue];
        connectionObj.writeQueue = [];
        connectionObj.readQueue = [];
        for (const item of pendingOps) {
            item.reject(new Error(`Socket closed for ${ip}:${port} (${reason})`));
        }

        // 5. Wait briefly for running in-flight operation to yield
        if (connectionObj.isRunning) {
            await Promise.race([
                new Promise(resolve => {
                    const poll = setInterval(() => {
                        if (!connectionObj.isRunning) { clearInterval(poll); resolve(); }
                    }, 10);
                }),
                new Promise(resolve => setTimeout(resolve, 200)),
            ]);
        }

        // 6. Force-destroy the raw TCP socket
        try {
            if (connectionObj.client) {
                if (connectionObj.client._port && connectionObj.client._port._client) {
                    connectionObj.client._port._client.destroy();
                } else if (typeof connectionObj.client.close === 'function') {
                    connectionObj.client.close();
                }
            }
            log.info(`[ModbusManager] closeConnection(${key}): socket force-destroyed successfully`);
        } catch (e) {
            log.error(`[ModbusManager] closeConnection(${key}): error closing socket — ${e.message}`);
        }

        this.emit('statusChanged', this.getConnectionStatuses());
    }

    /**
     * Alias for disconnect() pointing directly to closeConnection().
     */
    async disconnect(ip, port) {
        return await this.closeConnection(ip, port, 'disconnect called');
    }

    _handleDisconnect(ip, port) {
        const key = this._getKey(ip, port);
        const connectionObj = this.connections.get(key);

        if (!connectionObj || connectionObj.reconnectTimer) {
            return;
        }

        connectionObj.isConnected = false;
        this._executeDisconnectAndReconnect(key, ip, port, connectionObj);
    }

    async _executeDisconnectAndReconnect(key, ip, port, connectionObj) {
        if (connectionObj.state !== 'DYING') {
            this._logTransition(key, connectionObj.state, 'DYING', '_handleDisconnect');
            connectionObj.state = 'DYING';
        }

        // Force destroy socket on unexpected drop
        if (connectionObj.client) {
            try {
                if (connectionObj.client._port && connectionObj.client._port._client) {
                    connectionObj.client._port._client.destroy();
                } else {
                    connectionObj.client.close();
                }
            } catch (e) {
                log.warn(`[ModbusManager] Error destroying socket during handleDisconnect — ${e.message}`);
            }
        }
        
        if (connectionObj.aborted) {
            return;
        }

        this._logTransition(key, 'DYING', 'BACKOFF', 'socket destroyed');
        connectionObj.state = 'BACKOFF';
        
        this.emit('statusChanged', this.getConnectionStatuses());

        const backoffLadder = [1000, 2000, 5000, 10000];
        const baseDelay = backoffLadder[Math.min(connectionObj.backoffIndex, backoffLadder.length - 1)];
        const retryDelay = baseDelay + Math.floor(Math.random() * (baseDelay * 0.2));
        
        if (connectionObj.backoffIndex < backoffLadder.length - 1) {
            connectionObj.backoffIndex++;
        }

        connectionObj.generation++;
        const currentGen = connectionObj.generation;

        connectionObj.reconnectTimer = setTimeout(() => {
            if (connectionObj.generation !== currentGen) return;
            connectionObj.reconnectTimer = null;
            this._doReconnect(ip, port, connectionObj);
        }, retryDelay);
    }

    async _doReconnect(ip, port, connectionObj) {
        const key = this._getKey(ip, port);
        
        if (connectionObj.aborted || !this.connections.has(key)) {
            return;
        }

        this._logTransition(key, connectionObj.state, 'CONNECTING', 'reconnect timer fired');
        connectionObj.state = 'CONNECTING';

        try {
            const newClient = new ModbusRTU();
            newClient.setTimeout(500);

            newClient.on('error', (err) => {
                log.error(`[ModbusManager] SOCKET ERROR on ${key}: ${err.message || err}`);
                if (connectionObj.isConnected) this._handleDisconnect(ip, port);
            });
            newClient.on('close', () => {
                log.warn(`[ModbusManager] SOCKET CLOSED on ${key}`);
                if (connectionObj.isConnected) this._handleDisconnect(ip, port);
            });

            await newClient.connectTCP(ip, { port: parseInt(port) });

            if (connectionObj.aborted) {
                try { newClient.close(); } catch (_) {}
                return;
            }

            try {
                if (newClient._port && newClient._port._client && typeof newClient._port._client.setKeepAlive === 'function') {
                    newClient._port._client.setKeepAlive(true, 15000);
                }
            } catch (e) {
                log.warn(`[ModbusManager] Could not set TCP KeepAlive on reconnect for ${key}`);
            }

            connectionObj.client = newClient;
            connectionObj.isConnected = true;

            this._logTransition(key, 'CONNECTING', 'PROBATION', 'Reconnected successfully');
            connectionObj.state = 'PROBATION';

            attachTidGuard(newClient, ip, port, this);

            this.emit('connected', { ip, port: parseInt(port) });
            this.emit('statusChanged', this.getConnectionStatuses());
            
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

    _logTransition(key, from, to, detail) {
        log.warn(`[ModbusState] ${key} | ${from} -> ${to} | ${detail}`);
    }

    async shutdownAll(reason = 'shutdown') {
        log.info(`[ModbusManager] shutdownAll triggered: ${reason}`);
        const promises = [];
        for (const [key, obj] of this.connections.entries()) {
            const [ip, port] = key.split(':');
            promises.push(this.closeConnection(ip, parseInt(port), `shutdownAll: ${reason}`));
        }
        await Promise.all(promises);
        this.connections.clear();
        log.info(`[ModbusManager] shutdownAll complete.`);
    }

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

    async _drain(connectionObj, ip, port) {
        if (connectionObj.isRunning) return;
        connectionObj.isRunning = true;

        const key = this._getKey(ip, port);

        while (connectionObj.writeQueue.length > 0 || connectionObj.readQueue.length > 0) {
            const item = connectionObj.writeQueue.shift() || connectionObj.readQueue.shift();

            if (!connectionObj.isConnected) {
                item.reject(new Error(`Device at ${ip}:${port} was disconnected`));
                continue;
            }

            if (!connectionObj.client || !connectionObj.client.isOpen) {
                this._handleDisconnect(ip, port);
                item.reject(new Error('Port Not Open'));
                continue;
            }

            try {
                const result = await item.op(connectionObj.client);
                connectionObj.consecutiveTimeouts = 0;
                connectionObj.lastResponseAt = Date.now();
                
                if (connectionObj.state === 'PROBATION') {
                    this._logTransition(key, 'PROBATION', 'LIVE', 'first successful round-trip');
                    connectionObj.state = 'LIVE';
                    connectionObj.backoffIndex = 0;
                    this.emit('live', { ip, port: parseInt(port) });
                    this.emit('statusChanged', this.getConnectionStatuses());
                }

                item.resolve(result);
            } catch (err) {
                const msg = err.message ? err.message.toLowerCase() : '';
                if (msg.includes('timed out') || msg.includes('port not open') || msg.includes('econn')) {
                    connectionObj.consecutiveTimeouts = (connectionObj.consecutiveTimeouts || 0) + 1;
                    
                    if (connectionObj.consecutiveTimeouts >= 3 && connectionObj.state !== 'DYING') {
                        this._logTransition(key, connectionObj.state, 'DYING', 'declared dead via timeouts');
                        connectionObj.state = 'DYING';
                        
                        const pendingOps = [...connectionObj.writeQueue, ...connectionObj.readQueue];
                        connectionObj.writeQueue = [];
                        connectionObj.readQueue = [];
                        for (const pItem of pendingOps) {
                            pItem.reject(new Error(`ConnectionDeclaredDead: 3 consecutive timeouts`));
                        }

                        if (connectionObj.client && connectionObj.client._port && connectionObj.client._port._client) {
                            try { connectionObj.client._port._client.destroy(); } catch (_) {}
                        }
                        
                        this._handleDisconnect(ip, port);
                    }
                }

                item.reject(err);
            }
        }

        connectionObj.isRunning = false;
    }

    enqueue(ip, port, operation) {
        const key = this._getKey(ip, port);
        let connectionObj = this.connections.get(key);

        if (!connectionObj || !connectionObj.isConnected || (connectionObj.client && !connectionObj.client.isOpen)) {
            return Promise.reject(new Error(`Device at ${ip}:${port} is not connected`));
        }

        return new Promise((resolve, reject) => {
            connectionObj.readQueue.push({ op: operation, resolve, reject });
            this._drain(connectionObj, ip, port);
        });
    }

    enqueueHighPriority(ip, port, operation) {
        const key = this._getKey(ip, port);
        let connectionObj = this.connections.get(key);

        if (!connectionObj || !connectionObj.isConnected || (connectionObj.client && !connectionObj.client.isOpen)) {
            return Promise.reject(new Error(`Device at ${ip}:${port} is not connected`));
        }

        return new Promise((resolve, reject) => {
            connectionObj.writeQueue.push({ op: operation, resolve, reject });
            this._drain(connectionObj, ip, port);
        });
    }
}

const instance = new ModbusManager();
instance.ModbusManager = ModbusManager;
module.exports = instance;