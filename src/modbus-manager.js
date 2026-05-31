const ModbusRTU = require('modbus-serial');
const log = require('electron-log');

class ModbusManager {
    constructor() {
        // Map of connection keys (e.g., '192.168.1.100:502') to { client, queue, isConnected }
        this.connections = new Map();
    }

    _getKey(ip, port) {
        return `${ip}:${port}`;
    }

    /**
     * Initializes connections for a list of devices in parallel.
     */
    async initDevices(devices) {
        await Promise.allSettled(devices.map(device => {
            if (device.ip && device.port) {
                return this.connect(device.ip, device.port);
            }
            return Promise.resolve();
        }));
    }

    /**
     * Connects to a device and stores it in the manager.
     */
    async connect(ip, port) {
        const key = this._getKey(ip, port);
        if (this.connections.has(key)) {
            return this.connections.get(key);
        }

        const client = new ModbusRTU();
        client.setTimeout(5000); // 5s timeout to ensure slow devices have time to connect
        
        const connectionObj = {
            client,
            queue: Promise.resolve(), // Mutex queue
            isConnected: false,
            reconnectTimer: null
        };

        this.connections.set(key, connectionObj);

        const attachListeners = (c) => {
            // Remove old listeners just in case
            c.removeAllListeners('error');
            c.removeAllListeners('close');
            
            c.on('error', (err) => {
                log.error(`Modbus connection error on ${ip}:${port}:`, err.message || err);
                // Only trigger reconnect if we were previously connected. 
                // If we are still connecting, let the connectTCP catch block handle it.
                if (connectionObj.isConnected) {
                    this._handleDisconnect(ip, port);
                }
            });
            c.on('close', () => {
                log.warn(`Modbus connection closed on ${ip}:${port}`);
                if (connectionObj.isConnected) {
                    this._handleDisconnect(ip, port);
                }
            });
        };

        attachListeners(client);

        try {
            log.info(`Connecting to Modbus device at ${ip}:${port}...`);
            await client.connectTCP(ip, { port: parseInt(port) });
            connectionObj.isConnected = true;
            log.info(`Connected to ${ip}:${port}`);
        } catch (err) {
            log.error(`Failed to connect to ${ip}:${port}:`, err.message || err);
            this._handleDisconnect(ip, port);
        }

        return connectionObj;
    }

    /**
     * Handles disconnection and attempts to reconnect.
     */
    _handleDisconnect(ip, port) {
        const key = this._getKey(ip, port);
        const connectionObj = this.connections.get(key);
        
        if (connectionObj) {
            if (connectionObj.reconnectTimer) return; // Prevent multiple concurrent reconnect timers
            
            connectionObj.isConnected = false;
            // Clean up the old client just in case
            try { connectionObj.client.close(); } catch(e) {}

            // Simple reconnect logic (retry every 5 seconds)
            connectionObj.reconnectTimer = setTimeout(async () => {
                connectionObj.reconnectTimer = null;
                if (this.connections.has(key) && !this.connections.get(key).isConnected) {
                    log.info(`Attempting to reconnect to ${ip}:${port}...`);
                    try {
                        // Create a brand new client instance to ensure clean socket state
                        const newClient = new ModbusRTU();
                        newClient.setTimeout(5000);
                        
                        // Attach listeners to the new instance BEFORE connecting
                        newClient.on('error', (err) => {
                            log.error(`Modbus connection error on ${ip}:${port}:`, err.message || err);
                            if (connectionObj.isConnected) this._handleDisconnect(ip, port);
                        });
                        newClient.on('close', () => {
                            log.warn(`Modbus connection closed on ${ip}:${port}`);
                            if (connectionObj.isConnected) this._handleDisconnect(ip, port);
                        });

                        await newClient.connectTCP(ip, { port: parseInt(port) });
                        
                        // Replace the old client
                        connectionObj.client = newClient;
                        connectionObj.isConnected = true;

                        log.info(`Reconnected to ${ip}:${port}`);
                    } catch (e) {
                        log.error(`Reconnect failed for ${ip}:${port}:`, e.message || e);
                        this._handleDisconnect(ip, port); // Trigger another retry in 5s
                    }
                }
            }, 5000);
        }
    }

    /**
     * Disconnects a specific device.
     */
    async disconnect(ip, port) {
        const key = this._getKey(ip, port);
        const connectionObj = this.connections.get(key);
        if (connectionObj) {
            this.connections.delete(key); // Remove so auto-reconnect stops
            connectionObj.isConnected = false;
            try {
                connectionObj.client.close();
            } catch (e) {
                log.error(`Error closing connection for ${ip}:${port}:`, e);
            }
        }
    }

    /**
     * Returns an array of current connection statuses
     */
    getConnectionStatuses() {
        const statuses = [];
        for (const [key, obj] of this.connections.entries()) {
            const [ip, port] = key.split(':');
            const actuallyConnected = obj.isConnected && obj.client && obj.client.isOpen;
            statuses.push({ ip, port, isConnected: actuallyConnected });
        }
        return statuses;
    }

    /**
     * Executes a Modbus operation sequentially using a promise queue (Mutex).
     * @param {string} ip 
     * @param {number} port 
     * @param {function} operation - Async function taking the 'client' as an argument.
     */
    async enqueue(ip, port, operation) {
        let connectionObj = this.connections.get(this._getKey(ip, port));
        
        // If device is not known, try to connect (e.g. ad-hoc requests)
        if (!connectionObj) {
            connectionObj = await this.connect(ip, port);
        }

        if (!connectionObj.isConnected || (connectionObj.client && !connectionObj.client.isOpen)) {
            if (connectionObj.isConnected) {
                log.warn(`Modbus port unexpectedly closed for ${ip}:${port}, triggering reconnect.`);
                this._handleDisconnect(ip, port);
            }
            throw new Error(`Device at ${ip}:${port} is not connected or port is closed`);
        }

        return new Promise((resolve, reject) => {
            connectionObj.queue = connectionObj.queue.then(async () => {
                // Double check openness right before executing the operation
                if (!connectionObj.client.isOpen) {
                    this._handleDisconnect(ip, port);
                    return reject(new Error("Port Not Open"));
                }
                
                try {
                    const result = await operation(connectionObj.client);
                    // Add a 50ms delay between consecutive requests to prevent overwhelming the hardware TCP stack
                    await new Promise(r => setTimeout(r, 50));
                    resolve(result);
                } catch (err) {
                    reject(err);
                }
            }).catch(() => {
                // Ignore queue chain errors to keep it moving
            });
        });
    }
}

module.exports = new ModbusManager();
