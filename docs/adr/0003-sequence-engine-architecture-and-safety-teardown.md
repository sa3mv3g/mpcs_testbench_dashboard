# ADR 0003: Sequence Engine Process Architecture, Dynamic High-Speed Polling & Safety Teardown Protocol

## Status

Accepted

## Context

The MPCS Testbench Dashboard requires an automated Action Sequence Engine to execute Hardware-in-the-Loop (HIL) simulation routines specified in [`docs/manuals/mpcs_test_simulation_en.md`](../manuals/mpcs_test_simulation_en.md) (derived from [`docs/manuals/MPCS TEST SIMULETION.xlsx`](../manuals/MPCS%20TEST%20SIMULETION.xlsx)).

These tests subject Indian Railways electric locomotive MPCS units (Medha, Stesalit, Autometers) to rigorous multi-step operational cycles (Cab Boot, Pantograph Raising, Arno Starting, DJ Closing, Staggered Blowers, Notch-1 Traction Progression, Vigilance Control Device cycles, and Primary Fault Injections).

Several critical architectural decisions were evaluated during the design and grilling sessions:

### 1. Execution Process Boundary (Main Process vs. Renderer vs. Worker Thread)
- **Option A (Renderer Process UI Thread):** Running sequence code in the browser context simplifies UI binding. However, Chromium automatically throttles background tabs and minimized windows down to 1 Hz (1000 ms timer resolution). Railway safety watchdogs (such as the 1.0s line contactor feedback window or 4.0s DJ feedback window) would trigger spurious timeout failures whenever the user switches windows.
- **Option B (Node.js Worker Thread):** Isolates sequence execution from the main loop, but Modbus TCP sockets in [`src/modbus-manager.js`](../../src/modbus-manager.js:10) cannot be passed across worker thread boundaries without complex proxy messaging.
- **Option C (Electron Main Process - Chosen):** Running sequences directly in Node.js within the Main process guarantees microsecond timer determinism independent of window focus or UI state, provides direct low-latency socket writes, and eliminates IPC serialization latency for high-speed feedback.

### 2. Polling Dynamics During Automated Tests
- **Option A (Suppress Polling Loop - Previous Behavior):** [`src/main.js`](../../src/main.js:240) previously bypassed the 500 ms polling loop whenever `isSequenceActive` was true. This prevented the testbench from observing MPCS output responses (e.g. `O-00` DJ coil, `O-28` LSDJ lamp) and froze the live UI dashboard.
- **Option B (Targeted Per-Step Polling):** Polling only the expected register on demand inside each assertion step leaves all other channels un-monitored.
- **Option C (Accelerate Polling to 100 ms - Chosen):** While `isSequenceActive` is true, the polling loop continues running but accelerates its tick interval to 100 ms. This reduces observation latency and sampling jitter below 100 ms, satisfying tight sub-second railway watchdog thresholds while streaming real-time UI updates.

### 3. State Restoration vs. Post-Sequence Safe Teardown
- **Option A (Restore Pre-Test Manual Setpoints):** [`docs/CONTEXT.md`](../CONTEXT.md:28) previously stated that upon sequence completion, the hardware would "snap back" to stored manual Setpoints. However, if an operator had left driver switches (e.g. `I-00` BLDJ or `I-05` Pantograph) ON in the Manual Dashboard before running a test, automatically re-energizing those physical circuits after a test finishes or aborts poses an electrical safety hazard and risk of coil burnout.
- **Option B (Safe Teardown to Default State 0 - Chosen):** On sequence completion, failure, or emergency abort, the engine immediately drives all physical driver stimulus outputs to Low (0V) and resets stored Setpoints in SQLite to Default State (0/Off). A "Debug Freeze on Failure" checkbox is provided exclusively for laboratory technicians needing to inspect physical hardware voltages with a multimeter.

### 4. Test Definition Format (Declarative Schema vs. Code Modules)
- **Option A (In-Browser Drag-and-Drop Visual Step Builder):** Building a full visual sequence editor in the browser adds heavy UI complexity, while factory floor operators will not author test scripts themselves.
- **Option B (JavaScript Test Modules with Harness API - Chosen):** Developers maintain clean, version-controlled JavaScript test files in [`src/sequences/`](../../src/sequences/) utilizing an expressive `TestbenchHarness` API (`bench.set`, `bench.pulse`, `bench.expect`, `bench.wait`, `bench.assert`). Operators interact with a streamlined, foolproof UI tab dedicated solely to selecting, executing, monitoring, and exporting test reports.

---

## Decision

1. **Main Process Execution Runtime:**
   - The Action Sequence Engine is housed in the Electron Main process ([`src/sequence-engine/`](../../src/sequence-engine/)).
   - Sequence execution state, progress, and logs are emitted to the Renderer via IPC events (`sequence:step-update`, `sequence:finished`).

2. **High-Speed Dynamic Polling (100 ms):**
   - When a sequence begins (`sequence:start`), the Main Process polling interval shifts to 100 ms.
   - When the sequence concludes (`sequence:stop`), the polling loop gracefully reverts to the standard 500 ms idle rate.

3. **Locomotive / MPCS Canonical Perspective:**
   - All signal operations adopt the Locomotive / MPCS perspective:
     - **Stimulus Signals (`I-xx`):** Driven by testbench output coils to simulate driver switches and auxiliary contacts.
     - **Response Signals (`O-xx`):** Monitored by testbench input bits to verify MPCS coils, valves, and indicators.

4. **Post-Sequence Safe Teardown Protocol:**
   - Every sequence termination (Pass, Fail, or Abort) executes `bench.teardown()`.
   - All stimulus channels are de-energized to 0V and SQLite `manual_desired_state` Setpoints are reset to 0 (Default State), unless the operator actively checked the "Debug Freeze on Failure" toggle.

5. **Test Provenance & Read-Only Excel Certification:**
   - Every completed test run records an entry in the SQLite `sequence_run_history` table.
   - Operators can export an official, read-only `.xlsx` Test Certificate via `exceljs` adhering to the layout and styling standardized in [`docs/adr/0002-manual-dashboard-local-export-and-test-provenance.md`](0002-manual-dashboard-local-export-and-test-provenance.md).

---

## Consequences

### Positive
- **Deterministic Railway Timing:** Test sequences achieve sub-millisecond timer accuracy without browser throttling.
- **Hardware Safety:** Automatic teardown eliminates risks of overheated relay coils or unexpected locomotive circuit energization.
- **Zero Re-invented Wheels:** Standard JavaScript test modules with an intuitive async harness avoid proprietary JSON scripting interpreters.
- **Fast Observability:** 100 ms dynamic polling enables low-jitter assertions while keeping the dashboard UI responsive.

### Negative / Trade-offs
- Creating brand new test cases requires adding a `.js` file to [`src/sequences/`](../../src/sequences/) rather than creating one from the UI without code changes (accepted as operators only run existing certified test recipes).
- 100 ms polling increases local network Modbus packet frequency for the duration of the test run (benchmarked and confirmed well within local Ethernet bandwidth).
