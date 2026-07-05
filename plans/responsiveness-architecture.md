# Responsiveness Architecture Plan
## MPCS Testbench Dashboard — Sub-500 ms Guaranteed State Updates

> Status: Draft  
> Scope: `src/main.js`, `src/modbus-manager.js`  
> Goal: Every hardware state change is reflected in the UI within one 500 ms polling cycle, and every user write completes within ~30 ms of the IPC call.

---

## Root Cause Analysis

The current architecture has **six compounding latency sources** that together make the system feel sluggish and cause connect/disconnect to hang:

| # | Source | Latency Added | Severity |
|---|--------|--------------|----------|
| L1 | `setInterval` fires next tick before previous tick finishes | UI blackout when tick is slow | Critical |
| L2 | 50 ms inter-operation pace delay after every Modbus op | +50 ms per write | High |
| L3 | Single FIFO queue — writes wait behind in-progress polls | +15–65 ms per write | High |
| L4 | `disconnect()` doesn't abort in-flight `connectTCP` | Zombie sockets | Medium |
| L5 | `disconnectAll` queue drain has no timeout | UI hangs on disconnect | High |
| L6 | 1 Hz `setInterval` for network status | Stale UI, log spam | Low |

---

## Change 1 — Self-Scheduling Async Loop

### The Problem

[`startPollingLoop()`](src/main.js:109) uses `setInterval(async () => {...}, 500)` at [`line 116`](src/main.js:116).

`setInterval` **does not care** whether the async callback has finished. It fires every 500 ms on a wall-clock timer. The existing code tries to defend against this with the `isTickRunning` flag at [`line 130`](src/main.js:130):

```js
if (isTickRunning) {
    log.warn('[Polling] tick skipped — previous tick still running');
    return;
}
```

This looks like it solves the problem, but it doesn't — it just **silently drops ticks**. Here's why that's bad:

```
t=0ms    tick 0 starts  → isTickRunning = true
t=500ms  tick 1 fires   → sees isTickRunning=true → SKIPPED (no data update)
t=1000ms tick 2 fires   → sees isTickRunning=true → SKIPPED (no data update)
t=1200ms tick 0 finishes → isTickRunning = false
t=1500ms tick 3 fires   → runs OK
```

**Result**: If a device is slow (e.g. 5 s TCP timeout on one device), the UI gets **zero state updates** for the entire duration of that slow tick. The dashboard freezes. The `isTickRunning` guard trades "queue buildup" for "UI blackout" — neither is acceptable.

There's a second problem: the `updates[]` array at [`line 137`](src/main.js:137) is declared fresh each tick, but if `isTickRunning` fails to guard (e.g. a race on the flag itself), two ticks share the same array reference and push interleaved data to the renderer.

### The Fix

Replace the entire `setInterval` block with a recursive `setTimeout` pattern. The key insight: **schedule the next tick only after the current tick's `Promise.all` resolves**.

#### Before (current code, [`main.js:109–294`](src/main.js:109)):

```js
async function startPollingLoop() {
    if (pollingTimer) { ... return; }

    pollingTimer = setInterval(async () => {
        if (isSequenceActive) { return; }
        if (!isNetworkEnabled) { return; }
        if (activeDashboard !== 'manual-dashboard-v2') { return; }
        if (isTickRunning) { return; }          // ← guard that causes blackout

        isTickRunning = true;                   // ← flag that can race
        const updates = [];
        try {
            await Promise.all(promises);
            mainWindow.webContents.send('state-update', updates);
        } finally {
            isTickRunning = false;              // ← released in finally
        }
    }, 500);
}
```

#### After (proposed):

```js
let isPollingActive = false;

async function startPollingLoop() {
    if (isPollingActive) {
        log.warn('[Polling] startPollingLoop called but already active — ignoring');
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
}

async function scheduleTick() {
    if (!isPollingActive) return;

    // Skip conditions — same as before, but now we reschedule instead of returning
    if (isSequenceActive || !isNetworkEnabled || activeDashboard !== 'manual-dashboard-v2') {
        log.info('[Polling] tick skipped — conditions not met, rescheduling in 500ms');
        pollingTimer = setTimeout(scheduleTick, 500);
        return;
    }

    const tickStart = Date.now();
    const updates = [];                         // ← fresh array, never shared

    try {
        await Promise.all(promises);            // ← same tick body as before
        if (mainWindow && !mainWindow.isDestroyed() && updates.length > 0) {
            mainWindow.webContents.send('state-update', updates);
        }
    } catch (e) {
        log.error(`[Polling] unhandled error in tick after ${Date.now() - tickStart} ms:`, e);
    } finally {
        // Schedule next tick AFTER this one completes
        const elapsed = Date.now() - tickStart;
        const delay = Math.max(0, 500 - elapsed);
        log.info(`[Polling] tick complete in ${elapsed}ms — next tick in ${delay}ms`);
        pollingTimer = setTimeout(scheduleTick, delay);  // ← only fires after await resolves
    }
}
```

### What Changes Structurally

| Aspect | Before | After |
|--------|--------|-------|
| `isTickRunning` flag | Required (race guard) | **Deleted** — structurally impossible to overlap |
| Slow device (5 s timeout) | UI freezes for 5 s (ticks skipped) | UI gets update after 5 s tick completes, then resumes 500 ms cadence |
| `updates[]` sharing | Possible if guard races | **Impossible** — new array created per `scheduleTick()` call |
| Cadence under load | Degrades to 0 Hz (all ticks skipped) | Degrades gracefully: cadence = tick_duration + 500 ms |
| Stop polling | `clearInterval(pollingTimer)` | `isPollingActive = false` + `clearTimeout(pollingTimer)` |

### Cadence Behaviour

```
Normal (tick takes 30ms):
  tick starts t=0ms → finishes t=30ms → delay=470ms → next tick t=500ms ✓

Slow device (tick takes 800ms):
  tick starts t=0ms → finishes t=800ms → delay=0ms → next tick t=800ms
  (cadence degrades to 800ms, but UI still gets updates — no blackout) ✓

Very slow device (tick takes 5000ms — TCP timeout):
  tick starts t=0ms → finishes t=5000ms → delay=0ms → next tick t=5000ms
  (cadence degrades to 5s, but UI still gets updates when tick finishes) ✓
```

### Lines to Change in [`src/main.js`](src/main.js)

1. **Delete** `let isTickRunning = false;` at [`line 66`](src/main.js:66)
2. **Replace** [`startPollingLoop()`](src/main.js:109) body — swap `setInterval` for `scheduleTick()` + `setTimeout` in `finally`
3. **Add** `stopPollingLoop()` function
4. **Remove** the `if (isTickRunning) { return; }` guard at [`line 130`](src/main.js:130)
5. **Remove** `isTickRunning = true` at [`line 135`](src/main.js:135) and `isTickRunning = false` at [`line 290`](src/main.js:290)

---

## Change 2 — Remove the 50 ms Pace Delay

### The Problem

[`enqueue()`](src/modbus-manager.js:318) inserts a `setTimeout(r, 50)` at [`line 380`](src/modbus-manager.js:380) after every operation:

```js
// modbus-manager.js lines 376–381
const remainingDepth = (this._queueDepth.get(key) || 1) - 1;
const skipDelay = connectionObj._skipNextPaceDelay;
connectionObj._skipNextPaceDelay = false; // consume the flag
if (remainingDepth > 0 && !skipDelay) {
    await new Promise(r => setTimeout(r, 50));
}
```

This means a `directWrite` that arrives while a poll is in-flight must wait:
- for the current poll frame to finish (~15 ms)
- **plus** the 50 ms pace delay
- before the write even starts executing

The `enqueueHighPriority` path sets `_skipNextPaceDelay = true` to skip this delay, but it only skips the delay for the **operation that precedes the write** in the queue — not the write itself. If the write is the second item in the queue, the first item (the poll) still adds 50 ms before the write runs.

Evidence from logs:
```
[ModbusManager] enqueue(169.254.4.100:502): queue depth is now 2 — operations are backing up
[IPC] modbus:preemptWrite — writeCoil(0, true) sent
[ModbusManager] enqueue(169.254.4.100:502): operation completed in 30 ms
[IPC] modbus:preemptWrite — success in 88 ms   ← 88 ms total for a single coil write
```
The write itself takes ~30 ms; the remaining ~58 ms is queue wait + pace delay.

### The Fix

Remove the 50 ms delay entirely from [`enqueue()`](src/modbus-manager.js:318). With Change 1 (self-scheduling loop), the polling cadence is already controlled at the tick level — the per-operation delay is redundant.

#### Before (current code, [`modbus-manager.js:376–381`](src/modbus-manager.js:376)):

```js
const remainingDepth = (this._queueDepth.get(key) || 1) - 1;
const skipDelay = connectionObj._skipNextPaceDelay;
connectionObj._skipNextPaceDelay = false;
if (remainingDepth > 0 && !skipDelay) {
    await new Promise(r => setTimeout(r, 50));   // ← DELETE THIS BLOCK
}
this._queueDepth.set(key, Math.max(0, remainingDepth));
resolve(result);
```

#### After:

```js
const remainingDepth = (this._queueDepth.get(key) || 1) - 1;
this._queueDepth.set(key, Math.max(0, remainingDepth));
resolve(result);
```

Also remove the `_skipNextPaceDelay` flag from `connectionObj` and all references to it:
- [`modbus-manager.js:83`](src/modbus-manager.js:83) — remove `_skipNextPaceDelay: false` from `connectionObj` init
- [`modbus-manager.js:304`](src/modbus-manager.js:304) — remove `connectionObj._skipNextPaceDelay = true` from `enqueueHighPriority`
- [`modbus-manager.js:378`](src/modbus-manager.js:378) — remove `connectionObj._skipNextPaceDelay = false` (consume)
- [`modbus-manager.js:388`](src/modbus-manager.js:388) — remove `connectionObj._skipNextPaceDelay = false` (error path)

### Impact

| Metric | Before | After |
|--------|--------|-------|
| Write round-trip (poll in-flight) | ~88 ms | ~30 ms |
| Write round-trip (no poll) | ~30 ms | ~15 ms |
| Dead time per tick | 50 ms × (ops-1) | 0 ms |

---

## Change 3 — Priority Write Queue (Two-Lane Queue)

### The Problem

Even with Change 2, a user write that arrives while a poll is in-flight must wait for the **entire current poll frame** to finish before executing. The poll reads 3 register blocks per device (coils, holding, input) — each taking ~15 ms. A write waits up to ~45 ms.

The current queue is a **single promise chain** (mutex pattern):

```js
// connectionObj.queue is a promise chain
connectionObj.queue = connectionObj.queue.then(async () => {
    // run operation
});
```

Every operation — whether a poll read or a user write — is appended to the same chain. There is no way to insert a write ahead of a pending poll.

### The Fix

Give each device **two queues**: a `readQueue` (for polling) and a `writeQueue` (for user writes). A `_drain()` runner always empties `writeQueue` first before taking the next item from `readQueue`.

#### New `connectionObj` structure:

```js
const connectionObj = {
    client,
    readQueue:  [],    // { op, resolve, reject } — polling reads
    writeQueue: [],    // { op, resolve, reject } — user writes (higher priority)
    isRunning: false,  // prevents concurrent _drain() calls
    isConnected: false,
    reconnectTimer: null,
    retryCount: 0,
    aborted: false,    // see Change 4
};
```

#### New `_drain()` method:

```js
async _drain(connectionObj, ip, port) {
    if (connectionObj.isRunning) return;
    connectionObj.isRunning = true;

    while (connectionObj.writeQueue.length > 0 || connectionObj.readQueue.length > 0) {
        // Always drain writes first
        const item = connectionObj.writeQueue.shift() || connectionObj.readQueue.shift();

        if (!connectionObj.isConnected || !connectionObj.client.isOpen) {
            item.reject(new Error(`Device at ${ip}:${port} is not connected`));
            continue;
        }

        try {
            const result = await item.op(connectionObj.client);
            item.resolve(result);
        } catch (err) {
            item.reject(err);
        }
    }

    connectionObj.isRunning = false;
}
```

#### New `enqueue()` and `enqueueHighPriority()`:

```js
enqueue(ip, port, operation) {
    const key = this._getKey(ip, port);
    const connectionObj = this.connections.get(key);
    if (!connectionObj || !connectionObj.isConnected) {
        return Promise.reject(new Error(`Device at ${ip}:${port} is not connected`));
    }
    return new Promise((resolve, reject) => {
        connectionObj.readQueue.push({ op: operation, resolve, reject });
        this._drain(connectionObj, ip, port);
    });
}

enqueueHighPriority(ip, port, operation) {
    const key = this._getKey(ip, port);
    const connectionObj = this.connections.get(key);
    if (!connectionObj || !connectionObj.isConnected) {
        return Promise.reject(new Error(`Device at ${ip}:${port} is not connected`));
    }
    return new Promise((resolve, reject) => {
        connectionObj.writeQueue.push({ op: operation, resolve, reject });
        this._drain(connectionObj, ip, port);
    });
}
```

### Queue Behaviour

```
Scenario: poll in-flight, user write arrives

readQueue:  [ poll-coils (running), poll-holding, poll-input ]
writeQueue: []

User clicks switch → enqueueHighPriority → writeQueue: [ user-write ]
_drain() is already running (isRunning=true) — no new drain started

Current frame (poll-coils) finishes:
  _drain() checks writeQueue first → finds user-write → runs it (~15ms)
  _drain() then takes poll-holding from readQueue → runs it
  _drain() then takes poll-input from readQueue → runs it

Result: user-write executes after ONE poll frame (~15ms), not after ALL frames (~45ms)
```

### Impact

| Scenario | Before | After |
|----------|--------|-------|
| Write arrives mid-poll (3 frames) | waits for all 3 frames + pace delay | waits for current frame only |
| Write latency worst case | ~45 ms + 50 ms = ~95 ms | ~15 ms |
| Write latency best case | ~30 ms | ~15 ms |

---

## Change 4 — Atomic Disconnect with Abort Signal

### The Problem

[`disconnect()`](src/modbus-manager.js:228) removes the device from `this.connections` and closes the socket. But a background `connectTCP` (in [`_handleDisconnect`](src/modbus-manager.js:133)'s `setTimeout` at [`line 160`](src/modbus-manager.js:160)) may still be in-flight.

The current guard at [`line 162`](src/modbus-manager.js:162) is:

```js
connectionObj.reconnectTimer = setTimeout(async () => {
    connectionObj.reconnectTimer = null;
    if (this.connections.has(key) && !this.connections.get(key).isConnected) {
        // ... proceed with reconnect
        await newClient.connectTCP(ip, { port: parseInt(port) });
        // ← if disconnect() was called while connectTCP was awaiting,
        //   the key is gone from the map but newClient is now connected
        //   and will never be closed → ZOMBIE SOCKET
    }
}, retryDelay);
```

The check `this.connections.has(key)` happens **before** `connectTCP`. If `disconnect()` is called **while** `connectTCP` is awaiting (which takes up to 5 s), the check already passed and the new socket is assigned to `connectionObj` — which is no longer tracked.

The existing partial guard at [`line 188`](src/modbus-manager.js:188) tries to catch this:

```js
if (!this.connections.has(key) || !this.connections.get(key).isConnected === false) {
    const current = this.connections.get(key);
    if (!current || current !== connectionObj) {
        try { newClient.close(); } catch (_) {}
        return;
    }
}
```

But this condition is logically flawed: `!this.connections.get(key).isConnected === false` is always `true` (double negation), so the outer `if` always enters. The inner check `current !== connectionObj` is the real guard, but it only works if `disconnect()` created a new `connectionObj` — which it doesn't, it deletes the key entirely. So `current` is `undefined`, `current !== connectionObj` is `true`, and the socket IS closed. This accidentally works, but only because of the bug in the outer condition.

The correct, explicit fix is an `aborted` flag.

### The Fix

Add an `aborted` flag to `connectionObj`. `disconnect()` sets it **before** removing from the map. The reconnect timer checks `aborted` before **and** after `connectTCP`.

#### Changes to `connectionObj` init ([`modbus-manager.js:73`](src/modbus-manager.js:73)):

```js
const connectionObj = {
    client,
    readQueue:  [],
    writeQueue: [],
    isRunning: false,
    isConnected: false,
    reconnectTimer: null,
    retryCount: 0,
    aborted: false,    // ← NEW: set by disconnect() to abort pending reconnects
};
```

#### Changes to `_handleDisconnect` reconnect timer ([`modbus-manager.js:160`](src/modbus-manager.js:160)):

```js
connectionObj.reconnectTimer = setTimeout(async () => {
    connectionObj.reconnectTimer = null;

    // ← NEW: bail immediately if disconnect() was called
    if (connectionObj.aborted) {
        log.info(`[ModbusManager] reconnect(${key}): aborted — skipping`);
        return;
    }

    try {
        const newClient = new ModbusRTU();
        newClient.setTimeout(5000);
        // ... attach listeners ...
        await newClient.connectTCP(ip, { port: parseInt(port) });

        // ← NEW: check again after the async TCP handshake gap
        if (connectionObj.aborted) {
            log.warn(`[ModbusManager] reconnect(${key}): aborted during connectTCP — closing orphaned socket`);
            try { newClient.close(); } catch (_) {}
            return;
        }

        connectionObj.client = newClient;
        connectionObj.isConnected = true;
        connectionObj.retryCount = 0;
        this.emit('connected', { ip, port: parseInt(port) });
    } catch (e) {
        if (!connectionObj.aborted) {
            this._handleDisconnect(ip, port); // retry only if not aborted
        }
    }
}, retryDelay);
```

#### Changes to `disconnect()` ([`modbus-manager.js:228`](src/modbus-manager.js:228)):

```js
async disconnect(ip, port) {
    const key = this._getKey(ip, port);
    const connectionObj = this.connections.get(key);
    if (connectionObj) {
        connectionObj.aborted = true;           // ← NEW: signal all pending timers
        connectionObj.isConnected = false;
        this.connections.delete(key);
        this._queueDepth.delete(key);

        if (connectionObj.reconnectTimer) {
            clearTimeout(connectionObj.reconnectTimer);
            connectionObj.reconnectTimer = null;
        }
        // ... drain and close (see Change 5)
    }
}
```

### Impact

| Scenario | Before | After |
|----------|--------|-------|
| `disconnect()` during `connectTCP` | Zombie socket (accidentally closed by flawed guard) | Explicitly closed via `aborted` flag |
| `disconnect()` before reconnect timer fires | Timer fires, checks map, skips | Timer fires, checks `aborted`, skips cleanly |
| Multiple `disconnect()` calls | Second call finds no `connectionObj` | Same — `aborted` flag is idempotent |

---

## Change 5 — Parallel Disconnect with Drain Timeout

### The Problem

[`disconnect()`](src/modbus-manager.js:228) at [`line 252`](src/modbus-manager.js:252) awaits the queue drain before closing the socket:

```js
try {
    await connectionObj.queue;   // ← waits for ALL queued operations to finish
} catch (_) {}
try {
    connectionObj.client.close();
} catch (e) { ... }
```

With Change 3 (two-lane queue), `connectionObj.queue` no longer exists — the drain is managed by `_drain()`. But the principle remains: if a device has a 5 s TCP timeout in-flight, `disconnect()` blocks for up to 5 s.

`disconnectAll` uses `Promise.all` (already fixed per issue #09), so 8 devices disconnect in parallel. But if each device blocks for 5 s, the total time is still 5 s (parallel, not sequential). The UI hangs for 5 s.

### The Fix

Add a 200 ms drain timeout to `disconnect()`. If the queue doesn't drain within 200 ms, force-close the socket anyway.

#### After (with Change 3's two-lane queue):

```js
async disconnect(ip, port) {
    const key = this._getKey(ip, port);
    const connectionObj = this.connections.get(key);
    if (!connectionObj) return;

    connectionObj.aborted = true;
    connectionObj.isConnected = false;
    this.connections.delete(key);
    this._queueDepth.delete(key);

    if (connectionObj.reconnectTimer) {
        clearTimeout(connectionObj.reconnectTimer);
        connectionObj.reconnectTimer = null;
    }

    // Reject all queued operations immediately
    const allQueued = [...connectionObj.writeQueue, ...connectionObj.readQueue];
    connectionObj.writeQueue = [];
    connectionObj.readQueue = [];
    for (const item of allQueued) {
        item.reject(new Error(`Device at ${ip}:${port} was disconnected`));
    }

    // Wait for any in-flight operation to finish, but cap at 200 ms
    if (connectionObj.isRunning) {
        await Promise.race([
            new Promise(r => {
                const check = setInterval(() => {
                    if (!connectionObj.isRunning) { clearInterval(check); r(); }
                }, 10);
            }),
            new Promise(r => setTimeout(r, 200))   // ← 200 ms hard cap
        ]);
    }

    try {
        connectionObj.client.close();
        log.info(`[ModbusManager] disconnect(${key}): socket closed cleanly`);
    } catch (e) {
        log.error(`[ModbusManager] disconnect(${key}): error closing socket — ${e.message}`);
    }
}
```

### Impact

| Scenario | Before | After |
|----------|--------|-------|
| `disconnectAll` with 8 healthy devices | ~50 ms | ~50 ms |
| `disconnectAll` with 1 device timing out (5 s) | ~5 s UI hang | ~200 ms |
| `disconnectAll` with 8 devices timing out | ~5 s UI hang (parallel) | ~200 ms |

---

## Change 6 — Event-Driven Network Status Broadcast

### The Problem

[`createWindow()`](src/main.js:296) sets up a 1 Hz `setInterval` at [`line 310`](src/main.js:310):

```js
setInterval(() => {
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
        mainWindow.webContents.send("network-update", modbusManager.getConnectionStatuses());
    }
}, 1000);
```

[`getConnectionStatuses()`](src/modbus-manager.js:272) logs the full JSON status array on every call. This generates ~1/3 of all log lines even when nothing has changed. The `_lastStatusJson` suppression at [`line 286`](src/modbus-manager.js:286) reduces log spam but the IPC send still fires every second.

More importantly: if a device connects or disconnects, the UI doesn't know until the next 1 s tick — up to 1 s of stale status display.

### The Fix

`ModbusManager` emits a `'statusChanged'` event whenever connection state actually changes. `main.js` replaces the `setInterval` with a listener.

#### Changes to `ModbusManager` — emit on state change:

```js
// In connect() after successful connectTCP:
connectionObj.isConnected = true;
this.emit('statusChanged', this.getConnectionStatuses());   // ← NEW

// In _handleDisconnect() after marking disconnected:
connectionObj.isConnected = false;
this.emit('statusChanged', this.getConnectionStatuses());   // ← NEW

// In reconnect timer after successful reconnect:
connectionObj.isConnected = true;
this.emit('statusChanged', this.getConnectionStatuses());   // ← NEW
```

#### Changes to `main.js` — replace `setInterval` with listener:

```js
// REMOVE from createWindow():
setInterval(() => {
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
        mainWindow.webContents.send("network-update", modbusManager.getConnectionStatuses());
    }
}, 1000);

// ADD after modbusManager is imported:
modbusManager.on('statusChanged', (statuses) => {
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
        mainWindow.webContents.send('network-update', statuses);
    }
});
```

Also remove `_lastStatusJson` and its comparison from `getConnectionStatuses()` — it's no longer needed since the method is only called on actual state changes.

### Impact

| Metric | Before | After |
|--------|--------|-------|
| Status update latency | Up to 1 s | < 1 event loop tick (~1 ms) |
| Log lines per minute from status | ~60 | 0 (only on change) |
| IPC sends per minute (idle) | 60 | 0 |

---

## Combined Data Flow After All Changes

```
User clicks switch (renderer)
  → window.api.setDesiredState(guiId, val)     [IPC ~1ms]
  → window.api.directWrite(...)                [IPC ~1ms]
    → enqueueHighPriority → writeQueue.push()
    → _drain() sees writeQueue non-empty
    → if poll frame in-flight: wait ~15ms for frame to finish
    → execute writeCoil (~15ms Modbus RTT)
    → resolve → IPC returns ~30ms total ✓

500ms polling tick (self-scheduling)
  → tick N finishes at t=Xms
  → setTimeout(scheduleTick, max(0, 500-X))
  → tick N+1 starts
  → Promise.all(8 devices)
    → each device: readQueue gets [coils, holding?, input?]
    → _drain() runs them sequentially per device
    → all 8 devices run in parallel
  → broadcast state-update to renderer
  → renderer updates feedback dots + DI LEDs + AI readouts
  → total tick time: ~15-30ms (no pace delay, no queue buildup)
  → next tick in ~470-485ms → effective cadence: 500ms ✓

Device drops off network
  → socket 'close' event → _handleDisconnect()
  → connectionObj.isConnected = false
  → modbusManager.emit('statusChanged') → renderer LED updates instantly ✓
  → reconnect timer: 1s first attempt, 5s thereafter + per-device jitter
  → on reconnect: modbusManager.emit('statusChanged') → renderer LED updates ✓

User clicks Disconnect All
  → Promise.all(8× disconnect())
  → each disconnect(): aborted=true, cancel timer, reject queued ops, drain(200ms cap), close socket
  → all 8 complete in parallel within ~200ms ✓
```

---

## File Change Summary

### `src/modbus-manager.js`

| Change | What | Lines |
|--------|------|-------|
| C3 | Replace promise-chain mutex with `readQueue`/`writeQueue` + `_drain()` | ~150 lines rewrite |
| C4 | Add `aborted` flag to `connectionObj` | +1 line |
| C4 | Check `aborted` in reconnect timer (before and after `connectTCP`) | +6 lines |
| C5 | Reject queued ops immediately in `disconnect()` | +8 lines |
| C5 | Add 200 ms drain timeout in `disconnect()` | +10 lines |
| C6 | Emit `statusChanged` on connect/disconnect/reconnect | +3 lines |
| C2 | Remove 50 ms pace delay block | -5 lines |
| C2 | Remove `_skipNextPaceDelay` flag and all references | -8 lines |
| C6 | Remove `_lastStatusJson` spam suppression | -5 lines |

### `src/main.js`

| Change | What | Lines |
|--------|------|-------|
| C1 | Replace `setInterval` with `scheduleTick()` + `setTimeout` in `finally` | ~15 lines |
| C1 | Add `stopPollingLoop()` function | +8 lines |
| C1 | Remove `isTickRunning` flag and all references | -5 lines |
| C6 | Replace 1 Hz `setInterval` status broadcast with `modbusManager.on('statusChanged')` | -8 lines / +5 lines |

---

## Acceptance Criteria

| ID | Criterion | Target |
|----|-----------|--------|
| AC-1 | `directWrite` IPC call completes when poll in-flight | ≤ 50 ms |
| AC-2 | `directWrite` IPC call completes when no poll in-flight | ≤ 30 ms |
| AC-3 | Queue depth per device during normal polling | ≤ 3 |
| AC-4 | `disconnectAll` completes regardless of device state | ≤ 500 ms |
| AC-5 | No zombie sockets after `disconnect()` during reconnect | 0 leaked sockets |
| AC-6 | Network status LED update latency after state change | ≤ 100 ms |
| AC-7 | Polling cadence under normal conditions | 500 ms ± 50 ms |
| AC-8 | Log file growth rate reduction | > 50% |

---

## Implementation Order

| Step | Change | Reason |
|------|--------|--------|
| 1 | C4 — Atomic disconnect (abort flag) | Fixes zombie sockets; unblocks C5 |
| 2 | C5 — Parallel disconnect with drain timeout | Makes disconnect reliable; unblocks C3 |
| 3 | C3 — Two-lane priority queue | Replaces the promise-chain mutex entirely |
| 4 | C2 — Remove pace delay | Immediate write latency improvement; depends on C3 |
| 5 | C1 — Self-scheduling loop | Eliminates tick overlap; depends on C3 (new queue) |
| 6 | C6 — Event-driven status | Independent cleanup; can be a separate PR |

Changes 1–5 should be a single PR (they are tightly coupled). Change 6 is independent.
