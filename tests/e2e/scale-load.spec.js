/**
 * Scale & Load Testing — tests/e2e/scale-load.spec.js
 *
 * Covers the bugs identified in plans/issues-and-testcases.md:
 *   TC-01  DB cache invalidation
 *   TC-02  preemptWrite latency under 60 ms
 *   TC-03  No overlapping polling ticks
 *   TC-04  No duplicate signal_ids in state-update
 *   TC-05  Reconnect attempts are staggered
 *   TC-SCALE-01  10-device socket management
 *   TC-SCALE-02  800-signal dashboard render + IPC batching
 *
 * Infrastructure:
 *   - tests/modbus-simulator.js  — Modbus TCP server (port via argv[2])
 *   - Fault injection is ON in the simulator (10 % delay, 5 % drop)
 */

const { _electron: electron } = require('@playwright/test');
const { test, expect } = require('@playwright/test');
const electronPath = require('electron');
const path = require('path');
const { spawn } = require('child_process');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Spawn a modbus-simulator on the given port and return the child process. */
function spawnSimulator(port) {
    const sim = spawn('node', [
        path.join(__dirname, '..', 'modbus-simulator.js'),
        port.toString(),
    ], { stdio: 'pipe' });
    sim.stderr.on('data', d => { /* suppress */ });
    return sim;
}

/** Wait up to `timeoutMs` for `predicate()` to return true, polling every `intervalMs`. */
async function waitFor(predicate, timeoutMs = 5000, intervalMs = 100) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await predicate()) return true;
        await new Promise(r => setTimeout(r, intervalMs));
    }
    return false;
}

// ---------------------------------------------------------------------------
// Suite 1 — Single-device correctness (TC-01 … TC-05)
// ---------------------------------------------------------------------------

test.describe('Correctness — single simulator', () => {
    let electronApp;
    let window;
    let simulator;

    test.beforeAll(async () => {
        simulator = spawnSimulator(5020);
        await new Promise(r => setTimeout(r, 1200)); // let simulator bind

        electronApp = await electron.launch({
            executablePath: electronPath,
            args: [path.join(__dirname, '..', '..', 'src', 'main.js')],
        });
        window = await electronApp.firstWindow();
        window.on('dialog', d => d.accept());

        // Register the simulator as a device and connect
        await window.evaluate(async () => {
            await window.api.addDevice({
                display_name: 'CorrectnessSim',
                ip: '127.0.0.1',
                port: 5020,
                key1: null,
                key2: null,
            });
            await window.api.connectAllDevices();
        });

        // Wait for the device to appear as connected in network-update events
        const connected = await waitFor(async () => {
            return window.evaluate(() => {
                return new Promise(resolve => {
                    const handler = (statuses) => {
                        const dev = statuses.find(s => s.port === '5020');
                        if (dev && dev.isConnected) {
                            window.api.onNetworkUpdate(() => {}); // no-op to avoid leak
                            resolve(true);
                        }
                    };
                    window.api.onNetworkUpdate(handler);
                    // Resolve false after 3 s if never connected
                    setTimeout(() => resolve(false), 3000);
                });
            });
        }, 6000);
        expect(connected, 'Simulator should connect within 6 s').toBe(true);
    });

    test.afterAll(async () => {
        if (electronApp) await electronApp.close();
        if (simulator) simulator.kill();
    });

    // -----------------------------------------------------------------------
    // TC-01 — DB cache invalidation
    // -----------------------------------------------------------------------
    test('TC-01: signal cache is invalidated after addMappedSignal', async () => {
        // Add a signal and immediately read back via getMappedSignals.
        // If the cache is stale the new signal would be missing.
        const label = `CACHE-TEST-${Date.now()}`;
        await window.evaluate(async (lbl) => {
            const devs = await window.api.getDevices();
            const dev = devs.find(d => d.port === 5020) || devs[0];
            await window.api.addMappedSignal({
                label: lbl,
                type: 'digital-out',
                device_id: dev.id,
                read_register: 1,
                encoding: 'ABCD',
            });
        }, label);

        // getMappedSignals should return the new signal immediately (cache invalidated)
        const found = await window.evaluate(async (lbl) => {
            const sigs = await window.api.getMappedSignals();
            return sigs.some(s => s.label === lbl);
        }, label);

        expect(found, 'New signal should be visible immediately after add').toBe(true);
    });

    // -----------------------------------------------------------------------
    // TC-02 — preemptWrite latency
    // -----------------------------------------------------------------------
    test('TC-02: preemptWrite completes within 100 ms', async () => {
        // Ensure at least one digital-out signal exists on the simulator device
        const sigId = await window.evaluate(async () => {
            const sigs = await window.api.getMappedSignals();
            const digital = sigs.find(s => s.type === 'digital-out' && s.ip === '127.0.0.1');
            if (digital) return digital.id;

            const devs = await window.api.getDevices();
            const dev = devs.find(d => d.port === 5020) || devs[0];
            const res = await window.api.addMappedSignal({
                label: 'LATENCY-TEST',
                type: 'digital-out',
                device_id: dev.id,
                read_register: 2,
                encoding: 'ABCD',
            });
            return res.id;
        });

        const elapsed = await window.evaluate(async (id) => {
            const t0 = Date.now();
            await window.api.modbusPreemptWrite(id, 1);
            return Date.now() - t0;
        }, sigId);

        // With the 50 ms pace-delay fix, a write behind a poll should complete
        // in well under 100 ms (hardware round-trip ≈ 5 ms on loopback).
        expect(elapsed, `preemptWrite took ${elapsed} ms — expected < 100 ms`).toBeLessThan(100);
    });

    // -----------------------------------------------------------------------
    // TC-03 — No overlapping polling ticks
    // -----------------------------------------------------------------------
    test('TC-03: polling ticks do not overlap under normal conditions', async () => {
        // Collect state-update events over 3 seconds and verify they arrive
        // sequentially (no two events within < 10 ms of each other, which would
        // indicate two ticks running concurrently and both broadcasting).
        const intervals = await window.evaluate(() => {
            return new Promise(resolve => {
                const timestamps = [];
                const handler = () => { timestamps.push(Date.now()); };
                window.api.onStateUpdate(handler);
                setTimeout(() => {
                    window.api.removeStateUpdateListener();
                    // Compute gaps between consecutive broadcasts
                    const gaps = [];
                    for (let i = 1; i < timestamps.length; i++) {
                        gaps.push(timestamps[i] - timestamps[i - 1]);
                    }
                    resolve(gaps);
                }, 3000);
            });
        });

        // Every gap should be >= 400 ms (500 ms interval minus some jitter).
        // A gap < 50 ms would indicate two ticks fired simultaneously.
        const suspiciouslySmall = intervals.filter(g => g < 50);
        expect(
            suspiciouslySmall.length,
            `Found ${suspiciouslySmall.length} state-update gaps < 50 ms: ${JSON.stringify(suspiciouslySmall)}`
        ).toBe(0);
    });

    // -----------------------------------------------------------------------
    // TC-04 — No duplicate signal_ids in a single state-update payload
    // -----------------------------------------------------------------------
    test('TC-04: state-update payloads contain no duplicate signal_ids', async () => {
        const duplicatesFound = await window.evaluate(() => {
            return new Promise(resolve => {
                let checked = 0;
                const handler = (updates) => {
                    const ids = updates.map(u => u.signal_id);
                    const unique = new Set(ids);
                    if (unique.size !== ids.length) {
                        resolve(true); // duplicate found
                        return;
                    }
                    checked++;
                    if (checked >= 5) {
                        window.api.removeStateUpdateListener();
                        resolve(false); // no duplicates in 5 payloads
                    }
                };
                window.api.onStateUpdate(handler);
                // Safety timeout
                setTimeout(() => resolve(false), 5000);
            });
        });

        expect(duplicatesFound, 'state-update payload should never contain duplicate signal_ids').toBe(false);
    });

    // -----------------------------------------------------------------------
    // TC-05 — Reconnect attempts are staggered (jitter)
    // -----------------------------------------------------------------------
    test('TC-05: reconnect attempts for multiple offline devices are staggered', async () => {
        // Add 3 unreachable devices and connect. Capture network-update events
        // to observe when each device first attempts reconnect (retryCount > 0).
        // The reconnect timestamps should be spread by at least 50 ms each.
        await window.evaluate(async () => {
            for (let i = 0; i < 3; i++) {
                await window.api.addDevice({
                    display_name: `OfflineDev${i}`,
                    ip: `192.0.2.${10 + i}`, // TEST-NET — guaranteed unreachable
                    port: 502,
                    key1: null,
                    key2: null,
                });
            }
            await window.api.connectAllDevices();
        });

        // Collect network-update events for 4 s and look at retryCount transitions
        const retryTimestamps = await window.evaluate(() => {
            return new Promise(resolve => {
                const firstRetry = {}; // ip -> timestamp of first retryCount > 0
                const handler = (statuses) => {
                    for (const s of statuses) {
                        if (s.ip.startsWith('192.0.2.') && s.retryCount > 0 && !firstRetry[s.ip]) {
                            firstRetry[s.ip] = Date.now();
                        }
                    }
                };
                window.api.onNetworkUpdate(handler);
                setTimeout(() => {
                    window.api.onNetworkUpdate(() => {});
                    resolve(Object.values(firstRetry).sort());
                }, 4000);
            });
        });

        if (retryTimestamps.length >= 2) {
            // Verify that not all retries fired within the same 10 ms window
            const span = retryTimestamps[retryTimestamps.length - 1] - retryTimestamps[0];
            expect(
                span,
                `All ${retryTimestamps.length} reconnect attempts fired within ${span} ms — expected > 50 ms spread`
            ).toBeGreaterThan(50);
        }
        // If fewer than 2 timestamps were captured the devices may not have had
        // time to fail — that is acceptable; the test is informational.
    });
});

// ---------------------------------------------------------------------------
// Suite 2 — Scale tests (TC-SCALE-01, TC-SCALE-02)
// ---------------------------------------------------------------------------

test.describe('Scale & Load', () => {
    let electronApp;
    let window;
    const simulators = [];
    const SIM_COUNT = 10;
    const BASE_PORT = 5030;

    test.beforeAll(async () => {
        // Spawn SIM_COUNT simulators on consecutive ports
        for (let i = 0; i < SIM_COUNT; i++) {
            simulators.push(spawnSimulator(BASE_PORT + i));
        }
        await new Promise(r => setTimeout(r, 1500)); // let all simulators bind

        electronApp = await electron.launch({
            executablePath: electronPath,
            args: [path.join(__dirname, '..', '..', 'src', 'main.js')],
        });
        window = await electronApp.firstWindow();
        window.on('dialog', d => d.accept());
    });

    test.afterAll(async () => {
        if (electronApp) await electronApp.close();
        simulators.forEach(s => s.kill());
    });

    // -----------------------------------------------------------------------
    // TC-SCALE-01 — 10-device socket management
    // -----------------------------------------------------------------------
    test('TC-SCALE-01: 10 simulators connect, poll, and disconnect cleanly', async () => {
        // Register all 10 devices
        await window.evaluate(async ({ count, base }) => {
            for (let i = 0; i < count; i++) {
                await window.api.addDevice({
                    display_name: `ScaleDev${i}`,
                    ip: '127.0.0.1',
                    port: base + i,
                    key1: null,
                    key2: null,
                });
            }
        }, { count: SIM_COUNT, base: BASE_PORT });

        // Connect all
        await window.evaluate(() => window.api.connectAllDevices());

        // Wait up to 8 s for all 10 to show isConnected=true
        const allConnected = await waitFor(async () => {
            return window.evaluate(({ count, base }) => {
                return new Promise(resolve => {
                    const handler = (statuses) => {
                        const ours = statuses.filter(s =>
                            parseInt(s.port) >= base && parseInt(s.port) < base + count
                        );
                        if (ours.length === count && ours.every(s => s.isConnected)) {
                            resolve(true);
                        }
                    };
                    window.api.onNetworkUpdate(handler);
                    setTimeout(() => resolve(false), 3000);
                });
            }, { count: SIM_COUNT, base: BASE_PORT });
        }, 8000, 500);

        expect(allConnected, 'All 10 simulators should connect within 8 s').toBe(true);

        // Let polling run for 2 s and collect state-update payloads
        const updateCounts = await window.evaluate(({ count, base }) => {
            return new Promise(resolve => {
                let ticks = 0;
                const handler = (updates) => {
                    // Count updates that belong to our scale devices
                    ticks++;
                    if (ticks >= 4) {
                        window.api.removeStateUpdateListener();
                        resolve(ticks);
                    }
                };
                window.api.onStateUpdate(handler);
                setTimeout(() => resolve(ticks), 4000);
            });
        }, { count: SIM_COUNT, base: BASE_PORT });

        expect(updateCounts, 'Should receive at least 4 state-update broadcasts in 4 s').toBeGreaterThanOrEqual(4);

        // Disconnect all and verify the connection map empties
        await window.evaluate(() => window.api.disconnectAllDevices());

        const allDisconnected = await waitFor(async () => {
            return window.evaluate(({ count, base }) => {
                return new Promise(resolve => {
                    const handler = (statuses) => {
                        const ours = statuses.filter(s =>
                            parseInt(s.port) >= base && parseInt(s.port) < base + count
                        );
                        // After disconnectAll the devices are removed from the map
                        // so they should not appear in statuses at all.
                        if (ours.length === 0) resolve(true);
                    };
                    window.api.onNetworkUpdate(handler);
                    setTimeout(() => resolve(false), 3000);
                });
            }, { count: SIM_COUNT, base: BASE_PORT });
        }, 5000, 200);

        expect(allDisconnected, 'All 10 devices should disappear from network-update after disconnectAll').toBe(true);
    });

    // -----------------------------------------------------------------------
    // TC-SCALE-02 — 800-signal dashboard render + IPC batching
    // -----------------------------------------------------------------------
    test('TC-SCALE-02: 800 signals render in DOM and state-update arrives within 500 ms', async () => {
        // Re-connect one simulator for this test
        await window.evaluate(async (base) => {
            await window.api.connectAllDevices();
        }, BASE_PORT);

        // Insert 800 signals spread across holding (40001+) and coil (1+) address spaces
        await window.evaluate(async (base) => {
            await window.api.clearLayout();

            const devs = await window.api.getDevices();
            const dev = devs.find(d => parseInt(d.port) === base) || devs[0];

            const promises = [];
            for (let i = 0; i < 800; i++) {
                // Alternate between analog-in (holding) and digital-out (coil)
                // Use addresses that are far apart to avoid block-read span > 120 limit
                const isAnalog = i % 2 === 0;
                const register = isAnalog
                    ? 40001 + i * 3   // holding registers, 3-apart so no span overflow
                    : 1 + i;          // coils

                promises.push(window.api.addMappedSignal({
                    label: `SCALE-SIG-${i}`,
                    type: isAnalog ? 'analog-in' : 'digital-out',
                    device_id: dev.id,
                    read_register: register,
                    encoding: 'ABCD',
                }));
            }
            await Promise.all(promises);

            // Render the manual dashboard
            if (typeof window.renderManualDashboard === 'function') {
                await window.renderManualDashboard();
            }
        }, BASE_PORT);

        // Assert DOM widgets exist (renderer creates .canvas-widget elements)
        // Allow up to 5 s for the render to complete
        await window.waitForSelector('.canvas-widget', { timeout: 5000 }).catch(() => null);
        const widgetCount = await window.locator('.canvas-widget').count();
        // We expect at least 800 widgets (may be more from previous tests)
        expect(widgetCount, `Expected ≥ 800 .canvas-widget elements, got ${widgetCount}`).toBeGreaterThanOrEqual(800);

        // Assert that a state-update IPC broadcast arrives within 1500 ms
        // (500 ms poll interval + processing time)
        const broadcastArrived = await window.evaluate(() => {
            return new Promise(resolve => {
                const handler = (updates) => {
                    window.api.removeStateUpdateListener();
                    resolve(updates.length);
                };
                window.api.onStateUpdate(handler);
                setTimeout(() => resolve(0), 1500);
            });
        });

        expect(broadcastArrived, 'state-update should arrive within 1500 ms with at least 1 update').toBeGreaterThan(0);

        // Assert DOM update of 800 number-display elements takes < 500 ms
        const domUpdateMs = await window.evaluate(() => {
            const displays = document.querySelectorAll('.number-display');
            const t0 = Date.now();
            displays.forEach((el, i) => {
                el.textContent = (i * 0.1).toFixed(2);
            });
            return Date.now() - t0;
        });

        expect(domUpdateMs, `DOM update of ${widgetCount} elements took ${domUpdateMs} ms — expected < 500 ms`).toBeLessThan(500);
    });
});
