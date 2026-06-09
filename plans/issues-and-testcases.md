# MPCS Testbench Dashboard — Bug & Performance Issue Analysis

> Sources: `src/main.js`, `src/modbus-manager.js`, `main.log` (23 721 lines)
> Reviewed: 2026-06-04

---

## Summary

The log and code review reveal **10 distinct issues** spanning timing bugs, logical errors, resource leaks, and UX-visible lag. Each issue is described with its root cause, evidence from the log/code, severity, and a high-level test case.

---

## Issue 1 — DB queried on every polling tick (SQLite hot-path)

### Description
[`db.getMappedSignals()`](src/main.js:56) is called inside every 500 ms `setInterval` tick. With 204 signals this is a synchronous SQLite read on the main process every half-second, even when the signal mapping has not changed.

### Root Cause
No caching layer. The polling loop treats the DB as the live source of truth on every tick.

### Evidence
```
[Polling] tick start — 204 mapped signal(s) fetched from DB   ← every 500 ms
```
23 000+ log lines, each tick starts with a DB fetch.

### Impact
- Adds 1–5 ms of synchronous I/O to every tick on the main (Electron) process.
- Blocks the Node.js event loop during the SQLite call, delaying IPC responses and UI events.
- Scales badly: 204 signals today, more tomorrow.

### Severity: **High**

### Test Case TC-01
```
GIVEN  the app is connected and polling
WHEN   204 signals are mapped
THEN   the DB should be queried at most once per second (not once per 500 ms tick)
AND    a signal-mapping change should invalidate the cache within 1 s
```

---

## Issue 2 — 50 ms inter-operation delay doubles write latency

### Description
[`enqueue()`](src/modbus-manager.js:257) unconditionally inserts a `setTimeout(r, 50)` **after every operation**, including the polling block-read. This means a `preemptWrite` that arrives while a poll is in-flight must wait:
- for the poll to finish (≈15 ms)
- plus the 50 ms pace delay
- before the write even starts executing.

### Root Cause
```js
// modbus-manager.js line 257
await new Promise(r => setTimeout(r, 50));
```
The delay is applied to every operation regardless of whether the next queued item is time-sensitive.

### Evidence
```
[ModbusManager] enqueue(169.254.4.100:502): queue depth is now 2 — operations are backing up
[IPC] modbus:preemptWrite — writeCoil(0, true) sent
[ModbusManager] enqueue(169.254.4.100:502): operation completed in 30 ms
[IPC] modbus:preemptWrite — success in 88 ms   ← 88 ms total for a single coil write
```
The write itself takes 29 ms; the remaining ~59 ms is queue wait + pace delay.

### Impact
- UI write actions feel laggy (80–110 ms round-trip instead of ≈30 ms).
- If multiple writes are queued, each one adds another 50 ms of dead time.

### Severity: **High**

### Test Case TC-02
```
GIVEN  a device is connected and the polling loop is running
WHEN   the user triggers a preemptWrite
THEN   the write should complete within 60 ms of the IPC call
AND    the queue depth should return to 0 within one polling tick
```

---

## Issue 3 — Polling tick can overlap itself (no tick-skip guard)

### Description
The polling loop uses `setInterval` at 500 ms, but a single tick can take 60–89 ms (with 1 device). With 8 devices all connected, each device's block-read takes ≈15 ms + 50 ms pace delay = ≈65 ms per device. Since devices are polled in parallel via `Promise.all`, the worst-case tick time with 8 devices is bounded by the slowest device. However, if any device is slow (e.g. 5 s TCP timeout), the tick will run for 5 s while the next tick fires at 500 ms, causing **concurrent overlapping ticks** that both call `enqueue()` on the same device.

### Root Cause
`setInterval` does not wait for the previous async callback to finish before firing the next one. There is no `isTickRunning` guard.

### Evidence (code)
```js
// main.js line 43
pollingTimer = setInterval(async () => {
    // ... no guard against concurrent execution
}, 500);
```

### Impact
- Two ticks running simultaneously both call `modbusManager.enqueue()` for the same device.
- Queue depth climbs unboundedly.
- If a device is timing out (5 s), 10 ticks will be queued before the first one resolves.
- Memory leak: `updates[]` array is created fresh each tick but the outer tick's `Promise.all` never resolves until all queued operations drain.

### Severity: **Critical**

### Test Case TC-03
```
GIVEN  a device is connected but responding slowly (>500 ms per read)
WHEN   the polling loop fires
THEN   a second tick should NOT start until the first tick's Promise.all resolves
AND    queue depth should never exceed 1 during normal polling
```

---

## Issue 4 — `updates[]` array is shared across parallel device promises (race condition)

### Description
The `updates` array is declared once per tick at [`line 75`](src/main.js:75) and then mutated by multiple concurrent device promises via `updates.push(...)`. Since JavaScript is single-threaded this does not cause a data race in the traditional sense, but the array is shared by reference across all device closures. If a tick is still running when the next tick starts (Issue 3), two ticks share the same `updates` reference — they will both push into it and the broadcast will contain duplicate or interleaved values.

### Root Cause
```js
const updates = [];   // declared once, shared by all device closures in this tick
```

### Impact
- Duplicate signal values sent to the renderer.
- Renderer may flicker or show stale values.

### Severity: **Medium** (depends on Issue 3 being triggered)

### Test Case TC-04
```
GIVEN  two polling ticks overlap (slow device scenario)
WHEN   both ticks complete and broadcast state-update
THEN   each broadcast should contain exactly the signals for that tick
AND    no signal_id should appear twice in a single state-update payload
```

---

## Issue 5 — Reconnect backoff resets `retryCount` to 0 on success but never resets on disconnect

### Description
When a device reconnects successfully, [`retryCount` is reset to 0](src/modbus-manager.js:141). However, when `disconnect()` is called explicitly (e.g. "Disconnect All"), the `connectionObj` is deleted from the map. If the user then calls "Connect All" again, a brand-new `connectionObj` is created with `retryCount = 0`. This is correct.

But there is a subtler bug: if a device **connects successfully** and then **immediately drops** (e.g. cable pull), `_handleDisconnect` is called. At this point `retryCount` is 0 (just reset), so the first retry fires after **1 s**. If that retry also fails, `retryCount` becomes 1 and subsequent retries back off to **5 s**. This is the intended behaviour.

However, the `retryCount` check at [`line 112`](src/modbus-manager.js:112) is:
```js
const retryDelay = connectionObj.retryCount === 0 ? 1000 : 5000;
```
This means **only the very first disconnect ever** gets the 1 s fast retry. All subsequent disconnects (even after a long period of stable connection) immediately use the 5 s backoff because `retryCount` was incremented and never reset to 0 after a stable connection period.

### Root Cause
`retryCount` is reset to 0 on reconnect success, but the condition for fast retry is `=== 0`, which is only true for the very first failure after a fresh connection. After the first retry attempt, `retryCount >= 1` forever (until a successful reconnect resets it).

Wait — actually `retryCount` IS reset to 0 on success (line 141). So the fast-retry path IS available after a successful reconnect. The real bug is: **the fast retry only fires once per disconnect event**. If the device is unreachable, the sequence is:
- Disconnect → retryCount=0 → delay=1s → attempt → FAIL → retryCount=1 → delay=5s → attempt → FAIL → retryCount=2 → delay=5s → ...

This is actually correct backoff. The issue is that **there is no maximum retry cap or jitter**, so 7 offline devices each fire their 5 s timer in a synchronized burst (visible in the log), hammering the network simultaneously.

### Evidence
```
[2026-06-04 18:20:31.436] reconnect(169.254.4.107:502): attempt #1 starting...
[2026-06-04 18:20:31.438] reconnect(169.254.4.106:502): attempt #1 starting...
[2026-06-04 18:20:31.439] reconnect(169.254.4.105:502): attempt #1 starting...
... all 7 devices fire within 8 ms of each other
```

### Impact
- 7 simultaneous TCP connection attempts every 5 s.
- On a shared network this can cause brief congestion spikes.
- No jitter means the thundering-herd pattern repeats indefinitely.

### Severity: **Medium**

### Test Case TC-05
```
GIVEN  7 devices are offline
WHEN   the reconnect timer fires
THEN   reconnect attempts should be staggered by at least 100 ms between devices
AND    there should be a maximum retry interval cap (e.g. 30 s)
```

---

## Issue 6 — `getConnectionStatuses()` logs on every call (1 Hz log spam)

### Description
[`getConnectionStatuses()`](src/modbus-manager.js:202) is called every 1 s from the network-status broadcaster in [`createWindow()`](src/main.js:286). It logs the full JSON status array on every call.

### Evidence
```
[ModbusManager] getConnectionStatuses: [{"ip":"169.254.4.100","port":"502","isConnected":true,...},...]
```
This line appears **once per second** throughout the entire log — 23 000+ lines of which ~1/3 are this single repeated status dump.

### Impact
- Log file grows at ~3 KB/s just from status dumps.
- Makes the log nearly unreadable when searching for real events.
- Electron-log writes are synchronous on some platforms, adding I/O overhead.

### Severity: **Low** (operational noise, but affects debuggability)

### Test Case TC-06
```
GIVEN  the app is running
WHEN   connection status has not changed since the last broadcast
THEN   getConnectionStatuses should NOT log the full JSON
AND    it should only log when the status actually changes
```

---

## Issue 7 — Analog float decoding uses wrong register pair when block-read offset is odd

### Description
For analog signals (2-register IEEE 754 floats), the block-read decodes:
```js
registersToFloat([res.data[offset], res.data[offset + 1]], b.s.encoding)
```
This is correct **only if** the signal's `rawAddr` is the first register of the float pair. However, the block read spans from `minAddr` to `maxAddr + len - 1`. If two analog signals are at addresses 40001 and 40003 (rawAddr 0 and 2), the block reads registers [0,1,2,3]. Signal at rawAddr=0 gets `[data[0], data[1]]` ✓. Signal at rawAddr=2 gets `[data[2], data[3]]` ✓.

But if a **digital signal** (len=1) is at rawAddr=1 (between the two analog signals), the block still reads [0,1,2,3,4] and the second analog at rawAddr=2 still gets `[data[2], data[3]]` ✓.

The real bug is: **the block read mixes analog (len=2) and digital (len=1) signals in the same bucket only if they share the same register type**. Since coils and holding registers are in separate buckets, this is safe. However, if an analog holding register is at 40001 (rawAddr=0, len=2) and a digital holding register is at 40002 (rawAddr=1, len=1), the block reads [0,1] for the analog and [1] for the digital. The digital at offset=1 reads `res.data[1]` which is the **second byte of the float** — a garbage value.

### Root Cause
```js
// main.js line 134
const offset = b.rawAddr - minAddr;
const val = b.isAnalog
    ? registersToFloat([res.data[offset], res.data[offset + 1]], b.s.encoding)
    : res.data[offset];
```
Mixed analog/digital signals in the same holding-register bucket can cause the digital signal to read the high or low word of an adjacent float.

### Evidence
Log shows `Value: 0` for all signals — this may mask the bug since the device is returning zeros. The bug would manifest with non-zero float values.

### Severity: **High** (silent data corruption)

### Test Case TC-07
```
GIVEN  a device has a 2-register float at holding register 40001
AND    a 1-register integer at holding register 40003
WHEN   the polling loop reads both in a single block
THEN   the integer value should equal the actual register value
AND    the float value should decode correctly
AND    neither value should contain bits from the other signal's registers
```

---

## Issue 8 — `preemptWrite` does not pause the polling loop

### Description
[`modbus:preemptWrite`](src/main.js:458) is named "preempt" but it does not actually preempt the polling loop. It simply enqueues a write behind whatever is already in the queue. If the polling tick just started (queue depth=1), the write waits for the entire poll to finish plus the 50 ms pace delay.

The name implies the write should jump the queue, but the implementation is FIFO.

### Root Cause
No priority queue mechanism. `enqueue()` always appends to the tail of the promise chain.

### Evidence
```
[ModbusManager] enqueue(169.254.4.100:502): queue depth is now 2 — operations are backing up
[IPC] modbus:preemptWrite — success in 88 ms
```

### Impact
- User clicks a button expecting immediate hardware response; gets 80–110 ms delay.
- In a test sequence context, timing-sensitive writes may miss their window.

### Severity: **High**

### Test Case TC-08
```
GIVEN  a polling tick is in progress
WHEN   a preemptWrite is issued
THEN   the write should execute within 50 ms of the IPC call
OR     the polling tick should be interrupted and the write executed first
```

---

## Issue 9 — `disconnectAll` does not wait for in-flight enqueue operations to drain

### Description
[`modbus:disconnectAll`](src/main.js:349) immediately sets `isNetworkEnabled = false` and calls `modbusManager.disconnect()` for each device. `disconnect()` deletes the connection from the map and closes the socket. However, if a polling tick is currently executing and has already called `enqueue()` (which captured `connectionObj` by reference), the in-flight operation will attempt to use a socket that has been closed.

### Root Cause
```js
// disconnect() line 165
this.connections.delete(key);  // removes from map
connectionObj.client.close();  // closes socket
// ... but enqueue() already has a reference to connectionObj and will try to use client
```

### Impact
- `Port Not Open` errors thrown from in-flight operations after disconnect.
- These are caught and swallowed by the queue chain's `.catch()`, so they are silent.
- The `updates[]` array may contain partial results that get broadcast to the renderer.

### Severity: **Medium**

### Test Case TC-09
```
GIVEN  a polling tick is in progress reading from device A
WHEN   disconnectAll is called mid-tick
THEN   no "Port Not Open" errors should be thrown
AND    the partial updates array should NOT be broadcast to the renderer
AND    the renderer should receive a clear "disconnected" state
```

---

## Issue 10 — `retryCount` condition for fast-retry is inverted for initial connect failure

### Description
When `connect()` fails (initial connection attempt), it calls `_handleDisconnect()`. At this point `retryCount = 0`, so the first retry fires after **1 s** (fast retry). This is correct.

But the `retryCount` is incremented **before** the timer fires:
```js
// modbus-manager.js line 113
connectionObj.retryCount++;
// retryCount is now 1 before the first retry even runs
```

So when the first retry fires and fails, it calls `_handleDisconnect()` again. Now `retryCount = 1`, so the delay is **5 s**. This means:
- Initial connect fail → 1 s → retry #1 fails → 5 s → retry #2 fails → 5 s → ...

This is the intended behaviour. However, the log shows all 7 devices completing their initial connect failures at `18:20:30.433–18:20:30.443` (within 10 ms of each other), then all 7 retry #1 attempts fire at `18:20:31.436–18:20:31.444` (within 8 ms), then all 7 retry #2 attempts fire at `18:20:34.526–18:20:34.531` (within 5 ms). The thundering-herd pattern is confirmed.

Additionally, the `retryCount` is never reset to 0 when `isNetworkEnabled` is set to false and then true again (i.e., user disconnects and reconnects). The old `connectionObj` is deleted and a new one is created, so `retryCount` does reset — but only because the entire object is recreated. If `connect()` is called on an already-tracked device (duplicate guard at line 31), the old `retryCount` is preserved.

### Root Cause
The duplicate-connect guard returns the existing `connectionObj` without resetting `retryCount`:
```js
if (this.connections.has(key)) {
    return this.connections.get(key);  // retryCount may be stale
}
```

### Severity: **Low** (edge case, only affects reconnect-after-partial-failure)

### Test Case TC-10
```
GIVEN  a device fails to connect (retryCount increments to 3)
WHEN   the user calls disconnectAll then connectAll
THEN   the device's retryCount should reset to 0
AND    the first reconnect attempt should use the 1 s fast-retry delay
```

---

## Consolidated Issue Table

| # | Issue | Severity | Category |
|---|-------|----------|----------|
| 1 | DB queried every 500 ms tick | High | Performance |
| 2 | 50 ms pace delay on every operation | High | Timing/Latency |
| 3 | Polling ticks can overlap (no tick-skip guard) | Critical | Timing/Concurrency |
| 4 | `updates[]` shared across overlapping ticks | Medium | Logic/Race |
| 5 | Thundering-herd reconnect (no jitter) | Medium | Network |
| 6 | `getConnectionStatuses` logs every second | Low | Observability |
| 7 | Analog/digital mixed block-read decoding bug | High | Logic/Data Corruption |
| 8 | `preemptWrite` is not actually preemptive | High | UX/Timing |
| 9 | `disconnectAll` races with in-flight enqueue | Medium | Concurrency |
| 10 | `retryCount` not reset on reconnect-after-failure | Low | Logic |

---

## Recommended Fix Priority

```
1. TC-03  — Add tick-skip guard (isTickRunning flag)          [Critical]
2. TC-08  — Make preemptWrite actually preemptive             [High]
3. TC-02  — Remove or make 50 ms delay conditional            [High]
4. TC-01  — Cache getMappedSignals, invalidate on change      [High]
5. TC-07  — Fix analog/digital mixed block-read decoding      [High]
6. TC-09  — Drain queue before disconnecting                  [Medium]
7. TC-04  — Isolate updates[] per tick                        [Medium]
8. TC-05  — Add jitter to reconnect backoff                   [Medium]
9. TC-10  — Reset retryCount on explicit reconnect            [Low]
10. TC-06 — Suppress unchanged-status log spam                [Low]
```

---

## High-Level Test Cases (Summary)

| TC | Title | Type |
|----|-------|------|
| TC-01 | DB cache invalidation | Unit / Integration |
| TC-02 | preemptWrite latency under 60 ms | Integration |
| TC-03 | No overlapping polling ticks | Unit |
| TC-04 | No duplicate signal_ids in state-update | Integration |
| TC-05 | Reconnect attempts are staggered | Unit |
| TC-06 | Status log only on change | Unit |
| TC-07 | Mixed analog/digital block-read correctness | Unit |
| TC-08 | preemptWrite jumps the queue | Integration |
| TC-09 | disconnectAll mid-tick is safe | Integration |
| TC-10 | retryCount resets on explicit reconnect | Unit |
