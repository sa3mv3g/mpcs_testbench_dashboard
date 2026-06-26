# Static Polling Loop — Design Plan

## Hardware Analysis (derived from `tests/resource/jerry_registers.json` + `create-seed.js`)

### Testbench Configuration

**8 identical "jerry" STM32H5xx controllers**
- IPs: `169.254.4.100` through `169.254.4.107` (device_id 1–8)
- Port: `502`
- All 8 devices share the same register map

### Register Map Summary

#### Coils (FC01 readCoils / FC05 writeCoil) — protocol addresses 0–27

| Address | Name | Access | Signal type |
|---|---|---|---|
| 0–15 | `digital_output_0` to `digital_output_15` | R/W | `digital-out` |
| 16–23 | `digital_input_0` to `digital_input_7` (mirror) | R only | `digital-in` |
| 24–27 | `pwm_0_enable` to `pwm_3_enable` | R/W | — |

#### Discrete Inputs (FC02 readDiscreteInputs) — protocol addresses 0–7

| Address | Name | Access |
|---|---|---|
| 0–7 | `digital_input_0` to `digital_input_7` | R only |

> Note: `create-seed.js` maps digital inputs via **coil mirrors** (addresses 16–23), not discrete inputs. The polling loop uses coils only.

#### Input Registers (FC04 readInputRegisters) — protocol addresses 0–11

| Address | Name | Data type | Size |
|---|---|---|---|
| 0–3 | `adc_0_value` to `adc_3_value` | uint16 | 1 reg each |
| 4–5 | `adc_0_calibrated_value` | float32 (CDAB) | 2 regs |
| 6–7 | `adc_1_calibrated_value` | float32 (CDAB) | 2 regs |
| 8–9 | `adc_2_calibrated_value` | float32 (CDAB) | 2 regs |
| 10–11 | `adc_3_calibrated_value` | float32 (CDAB) | 2 regs |

#### Holding Registers (FC03 readHoldingRegisters) — key addresses

| Address | Name | Data type | Size | Access |
|---|---|---|---|---|
| 0 | `pwm_0_duty_cycle` | uint16 | 1 | R/W |
| 1–2 | `pwm_0_frequency` | uint32 | 2 | R/W |
| 3 | `pwm_1_duty_cycle` | uint16 | 1 | R/W |
| 4–5 | `pwm_1_frequency` | uint32 | 2 | R/W |
| 6 | `pwm_2_duty_cycle` | uint16 | 1 | R/W |
| 7–8 | `pwm_2_frequency` | uint32 | 2 | R/W |
| 9 | `pwm_3_duty_cycle` | uint16 | 1 | R/W |
| 10–11 | `pwm_3_frequency` | uint32 | 2 | R/W |
| 100–103 | `adc_0_value` to `adc_3_value` (mirrors) | uint16 | 1 each | R only |
| 104–105 | `adc_0_scale_factor` | float32 (CDAB) | 2 | R/W |
| 106–107 | `adc_0_offset_term` | float32 (CDAB) | 2 | R/W |
| 108–109 | `adc_0_dead_zone` | float32 (CDAB) | 2 | R/W |
| 110–127 | `adc_1/2/3` scale/offset/deadzone | float32 (CDAB) | 2 each | R/W |
| 128 | `key1` | uint16 | 1 | R/W |
| 129 | `key2` | uint16 | 1 | R/W |

### Signals Mapped in `create-seed.js`

#### Per device 1–8: Digital I/O (via coil block read)

| Signal label pattern | Type | Coil address | guiId pattern |
|---|---|---|---|
| `{d}.2 A` to `{d}.3 H` (I-0 to I-127) | `digital-out` | 0–15 | `do-{d}-{addr}` |
| `{d}.1 D0` to `{d}.1 D7` (O-0 to O-63) | `digital-in` | 16–23 | `di-{d}-{addr}` |

**Optimal block read:** `readCoils(0, 24)` — reads all 24 bits in one shot per device.
- Offsets 0–15 → digital outputs (R/W)
- Offsets 16–23 → digital input mirrors (R only)

#### Device 1 only: Analog outputs (PWM duty cycles)

| Signal label | Type | Holding address | guiId |
|---|---|---|---|
| `40-110 VAC 50HZ` | `analog-out` | 0 | `ao-1-0` |
| `0-5 AMP AC 50HZ` | `analog-out` | 3 | `ao-1-3` |
| `4-20 mA DC` | `analog-out` | 6 | `ao-1-6` |
| `0-10 VDC` | `analog-out` | 9 | `ao-1-9` |

**Block read:** `readHoldingRegisters(0, 10)` — reads addresses 0–9 in one shot.
- Offsets 0, 3, 6, 9 are the duty cycles (uint16); offsets 1–2, 4–5, 7–8 are frequencies (ignored for display).

#### Devices 1 and 3: Analog inputs (ADC calibrated values)

| Signal label | Type | Input reg address | guiId |
|---|---|---|---|
| `40-110 VAC 50HZ` (dev 1) | `analog-in` | 4 | `ai-1-4` |
| `40-110 VAC 50HZ` (dev 1) | `analog-in` | 6 | `ai-1-6` |
| `0-5 AMP AC 50HZ` (dev 1) | `analog-in` | 8 | `ai-1-8` |
| `0-5 AMP AC 50HZ` (dev 1) | `analog-in` | 10 | `ai-1-10` |
| `0-10 VDC` (dev 3) | `analog-in` | 4 | `ai-3-4` |
| `0-10 VDC` (dev 3) | `analog-in` | 6 | `ai-3-6` |
| `4-20 mA DC` (dev 3) | `analog-in` | 8 | `ai-3-8` |
| `4-20 mA DC` (dev 3) | `analog-in` | 10 | `ai-3-10` |

**Block read:** `readInputRegisters(4, 8)` — reads addresses 4–11 in one shot (all 4 calibrated floats).
- Encoding: `CDAB` (as set in `create-seed.js` seed data)

---

### Optimal Polling Commands (per 500 ms tick)

```
For each device d in [1..8]:
  readCoils(0, 24)
    → offset 0..15  → do-{d}-0 .. do-{d}-15   (digital-out, bool)
    → offset 16..23 → di-{d}-16 .. di-{d}-23  (digital-in, bool)

Device 1 only:
  readHoldingRegisters(0, 10)
    → offset 0  → ao-1-0   (uint16, PWM duty cycle)
    → offset 3  → ao-1-3   (uint16, PWM duty cycle)
    → offset 6  → ao-1-6   (uint16, PWM duty cycle)
    → offset 9  → ao-1-9   (uint16, PWM duty cycle)

Devices 1 and 3:
  readInputRegisters(4, 8)
    → offset 0+1 → ai-{d}-4   (float32 CDAB)
    → offset 2+3 → ai-{d}-6   (float32 CDAB)
    → offset 4+5 → ai-{d}-8   (float32 CDAB)
    → offset 6+7 → ai-{d}-10  (float32 CDAB)
```

**Total Modbus requests per tick:** 8 (coils) + 1 (holding) + 2 (input) = **11 requests**
vs. current dynamic loop which issues up to 4 bucket reads × 8 devices = up to 32 requests.

---

### guiId Naming Convention

| Pattern | Example | Meaning |
|---|---|---|
| `do-{deviceId}-{coilAddr}` | `do-1-0` | Digital output, device 1, coil address 0 |
| `di-{deviceId}-{coilAddr}` | `di-1-16` | Digital input mirror, device 1, coil address 16 |
| `ao-{deviceId}-{holdingAddr}` | `ao-1-0` | Analog output (PWM duty), device 1, holding addr 0 |
| `ai-{deviceId}-{inputAddr}` | `ai-1-4` | Analog input (ADC calibrated), device 1, input addr 4 |

These IDs are assigned to DOM elements in `renderManualDashboard()` and matched directly in the `onStateUpdate` renderer handler.

---

## Design Decisions (resolved via grilling)

| # | Decision | Choice |
|---|---|---|
| 1 | Read back digital output coils from hardware? | Yes — polling reads all 24 coils. Dashboard shows confirmed hardware state. |
| 2 | How does renderer know update method from `{ guiId, value }`? | Switch on `guiId` prefix: `do-` → checkbox `checked`, `di-` → LED class, `ao-` → slider value + readout, `ai-` → `textContent` |
| 3 | Who owns DOM IDs for v2? | Static HTML in `index.html` — all elements written directly with hardcoded `guiId` values |
| 4 | Polling loop replaces old one entirely? | Yes — single `onStateUpdate` handler uses `guiId`. V1 elements hidden, won't receive updates. |
| 5 | Digital output write control updated by polling? | Yes — checkbox `checked` reflects confirmed hardware state on every poll |
| 6 | How does v2 send write commands? | New `modbus:directWrite` IPC handler: `{ ip, port, fc, address, value, encoding? }`. Old `modbus:preemptWrite` kept for v1. |
| 7 | Which write FCs does `modbus:directWrite` support? | `writeCoil`, `writeRegister`, `writeRegisters` (future-proof for float analog outputs) |
| 8 | Who encodes float32 for `writeRegisters`? | Main process — payload carries `{ value: number, encoding: 'CDAB' }`, main calls `floatToRegisters()` |
| 9 | IPC payload shape change? | Replace old polling loop entirely. Single `onStateUpdate` handler uses `{ guiId, value }`. |
| 10 | `preload.js` change? | Add `directWrite: (params) => ipcRenderer.invoke('modbus:directWrite', params)` |
| 11 | v2 dashboard layout? | Static HTML in `index.html`. All 204 elements written directly. No JS rendering. |
| 12 | Analog output write control? | Range slider (0–100%) + numeric readout. Renderer scales to raw register (× 100) before `directWrite`. |

---

## Problem Statement

The current `startPollingLoop()` in `src/main.js` is a generic, data-driven polling engine that re-derives the complete Modbus read topology (device grouping, register bucketing, block span calculation, signal decoding) from the Signal Mapping Dictionary on every 500 ms tick.

This is the wrong abstraction for a **known, fixed testbench** where the developer already knows:
- Exactly which devices exist and their IP/port
- Exactly which Modbus function code to use per device
- Exactly which start address and length to read
- Exactly how to map each register offset in the response to a specific GUI element

The solution is to **replace the dynamic polling loop body** with a custom, hardcoded `startPollingLoop()` written directly in `src/main.js`. No external config file or schema is needed — the developer writes the exact `enqueue` calls per device inline.

---

## What Changes vs What Stays

### Changes
| File | What changes |
|---|---|
| `src/main.js` | Replace `startPollingLoop()` body with hardcoded `enqueue` calls per device. Remove `decodeBlockResults()`. |
| `src/renderer/renderer.js` | Update `onStateUpdate` handler to use `guiId` directly instead of `signal_id`. |

### Stays Unchanged
- `src/polling-profile.js` — **not created** (no external config file needed)
- `src/utils.js` — no changes needed (`registersToFloat` is already available)
- `src/modbus-manager.js` — zero changes
- `src/db.js` — zero changes
- Signal Mapping Dictionary — still used for calibration
- Device Registry — still used for connection management
- Write preemption (`modbus:preemptWrite`) — unchanged
- Calibration (`calibration:perform`) — unchanged
- `getCachedSignals()` and signal cache — kept for calibration and preemptWrite

---

## New Polling Loop Pattern

The developer writes the loop body directly. The structure is:

```js
async function startPollingLoop() {
    if (pollingTimer) return;
    pollingTimer = setInterval(async () => {
        if (isSequenceActive || !isNetworkEnabled || isTickRunning) return;
        isTickRunning = true;
        const updates = [];
        try {
            // ── Device A ──────────────────────────────────────────────────
            const connA = modbusManager.connections.get('192.168.1.10:502');
            if (connA && connA.isConnected && connA.client.isOpen) {
                await modbusManager.enqueue('192.168.1.10', 502, async (client) => {
                    const res = await client.readHoldingRegisters(0, 10);
                    updates.push({ guiId: 'pressure-gauge-1',  value: registersToFloat([res.data[0], res.data[1]], 'ABCD') });
                    updates.push({ guiId: 'temperature-lcd-1', value: registersToFloat([res.data[2], res.data[3]], 'CDAB') });
                    updates.push({ guiId: 'flow-rate-1',       value: registersToFloat([res.data[4], res.data[5]], 'ABCD') });
                    updates.push({ guiId: 'status-word-1',     value: res.data[6] });
                });
            }

            // ── Device A — digital block (separate sparse range) ──────────
            if (connA && connA.isConnected && connA.client.isOpen) {
                await modbusManager.enqueue('192.168.1.10', 502, async (client) => {
                    const res = await client.readCoils(0, 8);
                    updates.push({ guiId: 'pump-status-led',  value: res.data[0] ? 1 : 0 });
                    updates.push({ guiId: 'valve-status-led', value: res.data[1] ? 1 : 0 });
                });
            }

            // ── Device B ──────────────────────────────────────────────────
            const connB = modbusManager.connections.get('192.168.1.11:502');
            if (connB && connB.isConnected && connB.client.isOpen) {
                await modbusManager.enqueue('192.168.1.11', 502, async (client) => {
                    const res = await client.readHoldingRegisters(100, 6);
                    updates.push({ guiId: 'load-cell-1', value: registersToFloat([res.data[0], res.data[1]], 'BADC') });
                    updates.push({ guiId: 'load-cell-2', value: registersToFloat([res.data[2], res.data[3]], 'BADC') });
                    updates.push({ guiId: 'raw-count-1', value: res.data[4] });
                });
            }

            if (updates.length > 0 && mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('state-update', updates);
            }
        } catch (e) {
            log.error('[Polling] unhandled error:', e);
        } finally {
            isTickRunning = false;
        }
    }, 500);
}
```

---

## IPC Payload Change

### Before (dynamic Signal Mapping driven)
```js
// main.js → renderer
{ signal_id: 42, value: 3.14, type: 'analog-in' }

// renderer — type-switched handler
if (type === 'analog-in') {
    document.getElementById(`ui-val-${signal_id}`).textContent = value.toFixed(2);
}
```

### After (hardcoded guiId)
```js
// main.js → renderer
{ guiId: 'pressure-gauge-1', value: 3.14 }

// renderer — simple direct lookup
updates.forEach(({ guiId, value }) => {
    const el = document.getElementById(guiId);
    if (el) el.textContent = typeof value === 'number' ? value.toFixed(2) : value;
});
```

The renderer `onStateUpdate` handler becomes a simple loop with no type switching. The developer controls the update logic per element type by choosing the right DOM element and CSS class in `renderManualDashboard()`.

---

## Guards and Safety — Unchanged

The following guards in `startPollingLoop()` are **kept as-is**:
- `isSequenceActive` — skip tick during automated test sequences
- `isNetworkEnabled` — skip tick until user clicks Connect
- `isTickRunning` — prevent overlapping ticks
- Per-device connection check before each `enqueue` call

---

## Implementation Details

### `src/main.js`
- `decodeBlockResults()` removed (dead code)
- `JERRY_DEVICES` constant: 8 devices at `169.254.4.100–107:502`
- `startPollingLoop()` replaced with static plan (11 Modbus requests/tick)
- `state-update` IPC payload: `{ guiId, value }`
- `modbus:directWrite` IPC handler added: `{ ip, port, fc, address, value, encoding? }`

### `src/preload.js`
- `directWrite: (params) => ipcRenderer.invoke('modbus:directWrite', params)` added

### `src/renderer/index.html`
- v1 tab button hidden; v2 tab `Manual Dashboard v2` added and shown by default
- CSS added: `.v2-device-row`, `.v2-widget`, `.v2-led`, `.v2-ai-display`, `.v2-ao-widget`
- Static layout: 8 device rows, each with 16 `do-{d}-{0..15}` checkboxes + 8 `di-{d}-{16..23}` LEDs
- Device 1: 4 analog output sliders `ao-1-{0,3,6,9}` + readouts `ao-ro-1-{0,3,6,9}`
- Devices 1 & 3: 4 analog input displays `ai-{d}-{4,6,8,10}`

### `src/renderer/renderer.js`
- `onStateUpdate` handler: `getElementById(guiId)`, prefix routing:
  - `do-` → `el.checked = !!value`
  - `di-` → LED class toggle
  - `ao-` → slider value + readout display (raw ÷ 100 → %)
  - `ai-` → `textContent = value.toFixed(3)`
- `directWrite` handlers for v2 checkboxes (writeCoil) and sliders (writeRegister, ×100 scaling)
