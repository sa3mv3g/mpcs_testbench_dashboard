const log = require('electron-log');

/**
 * TID Guard (Transaction Identifier Validation)
 * 
 * Modbus-serial (8.0.25) extracts `_transactionIdRead` from incoming frames, but only checks
 * it internally for promise resolution. It does NOT drop mismatches at the transport layer,
 * and if the socket framing is desynced (due to no ADU reassembly on the device), it can
 * produce mismatched responses that the library either ignores or mis-pairs.
 * 
 * This wrapper monkey-patches the underlying TcpPort's `emit` function to intercept 'data'
 * events. It compares the read TID against the expected TID (which is `_transactionIdWrite - 1`).
 * 
 * If a mismatch is detected, the frame is DROPPED (not emitted to the higher-level parser).
 * If 2 mismatches occur on the same connection, it forces a socket disconnect to trigger
 * the ModbusManager's DYING->BACKOFF reconnect cycle.
 */
function attachTidGuard(client, ip, port, modbusManager) {
    if (!client || !client._port) {
        log.warn(`[TID-Guard] ${ip}:${port}: Cannot attach, _port is missing`);
        return;
    }

    const portObj = client._port;
    const originalEmit = portObj.emit.bind(portObj);
    const key = `${ip}:${port}`;

    let tidMismatches = 0;

    // We patch the `emit` of the `TcpPort` instance (which extends EventEmitter)
    portObj.emit = function (eventName, ...args) {
        if (eventName === 'data' && args[0] instanceof Buffer) {
            // By the time 'data' is emitted by TcpPort, it has already sliced the MBAP
            // and appended the CRC. The `_transactionIdRead` property has been updated.
            const readTid = portObj._transactionIdRead;
            
            // `_transactionIdWrite` is already incremented right after sending.
            // Since requests are strictly serialized by `_drain`, the expected TID
            // for the response currently arriving is the *previous* write TID.
            // MAX_TRANSACTIONS is 256 in modbus-serial.
            let expectedTid = portObj._transactionIdWrite - 1;
            if (expectedTid <= 0) expectedTid = 255;

            if (readTid !== expectedTid) {
                tidMismatches++;
                log.error(`[TID-MISMATCH] ${key}: Read TID ${readTid} != Expected ${expectedTid}. Mismatch count: ${tidMismatches}/2`);
                
                const connectionObj = modbusManager.connections.get(key);
                if (connectionObj) {
                    connectionObj.tidMismatches = tidMismatches; // expose for UI
                }

                if (tidMismatches >= 2) {
                    log.error(`[TID-MISMATCH] ${key}: Reached 2 mismatches. Stream desynced. Forcing reconnect.`);
                    if (connectionObj && connectionObj.state !== 'DYING') {
                        modbusManager._logTransition(key, connectionObj.state, 'DYING', 'TID desync');
                        connectionObj.state = 'DYING';
                        
                        // Reject all pending queues
                        const pendingOps = [...connectionObj.writeQueue, ...connectionObj.readQueue];
                        connectionObj.writeQueue = [];
                        connectionObj.readQueue = [];
                        for (const pItem of pendingOps) {
                            pItem.reject(new Error(`ConnectionDeclaredDead: TID desync`));
                        }

                        // Force destroy socket
                        try {
                            if (portObj._client) portObj._client.destroy();
                        } catch (_) {}
                        
                        modbusManager._handleDisconnect(ip, port);
                    }
                }
                
                // Drop the frame by NOT calling originalEmit
                return false; 
            } else {
                // Success - reset counter
                tidMismatches = 0;
                const connectionObj = modbusManager.connections.get(key);
                if (connectionObj) connectionObj.tidMismatches = 0;
            }
        }
        
        // Pass through everything else
        return originalEmit(eventName, ...args);
    };

    log.info(`[TID-Guard] ${key}: Attached`);
}

module.exports = { attachTidGuard };
