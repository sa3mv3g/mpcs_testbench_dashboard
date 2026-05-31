# Modbus Architecture & Persistent Connection Management

## Overview
This document outlines the architectural shift from transient to persistent Modbus TCP connections in the `mpcs_testbench_dashboard` application. This change aims to improve performance, reduce socket overhead, and prevent port exhaustion.

## Current State
- The `src/main.js` currently instantiates a new `ModbusRTU` client, connects (`client.connectTCP`), executes the request, and closes the connection (`client.close`) for *every* read or write operation.
- Concurrent reads and writes can clash because they try to initialize parallel transient connections.

## Proposed Architecture

### 1. Persistent Connection Manager
A new module (`src/modbus-manager.js`) will be introduced to act as the central registry for active Modbus connections.

**Key Responsibilities:**
- **Lifecycle Management:** Open connections at startup for all devices listed in the SQLite `device_registry`.
- **In-Memory Map:** Maintain a map of `ip:port` strings mapped to connected `ModbusRTU` instances.
- **Dynamic Updates:** Provide hooks to dynamically connect or disconnect clients when a user adds, edits, or deletes a device in the UI.
- **Auto-Reconnect:** Implement a heartbeat or connection error listener that automatically attempts to re-establish dropped connections.

### 2. Request Queueing (Serialization)
Modbus TCP requires that a client receives a response to a request before issuing the next one on the same socket. Sending multiple concurrent requests over a single socket will result in port errors or corrupted data.

**Mechanism:**
- Every mapped persistent connection will have its own asynchronous queue (Mutex/Promise queue).
- When `main.js` or an IPC handler needs to read/write, it submits a closure/promise to the manager.
- The manager will execute the operations serially, ensuring the socket is never overloaded with concurrent calls.

### 3. Application Flow Updates
- **Startup:** 
  1. Initialize SQLite.
  2. Read all devices from `device_registry`.
  3. Send list to `ModbusManager` to initialize connections.
  4. Start the polling loop.
- **Polling Loop (`startPollingLoop`):** 
  Instead of mocking or instantiating new clients, it will call `ModbusManager.enqueueRead(ip, port, ...)`.
- **Preemptive Writes / Calibration:** 
  IPC handlers like `modbus:preemptWrite` or `calibration:perform` will push high-priority tasks to the `ModbusManager` queue, bypassing the need to block the entire polling loop globally (`isPreempted`).

## Benefits
- **Lower Latency:** Connection handshakes (TCP SYN/ACK) are eliminated from the read/write critical path.
- **Stability:** The serialized queue guarantees protocol compliance and avoids node exceptions caused by concurrent socket writes.
- **Efficiency:** Drastically reduces OS-level TCP overhead.
