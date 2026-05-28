# Testing Requirements Document: MPCS Testbench Dashboard

## 1. Introduction
This document outlines the testing strategy, methodologies, and specific test cases required to validate the stability, accuracy, and reliability of the MPCS Testbench Dashboard. The system involves complex hardware-software interactions, requiring robust testing across Modbus TCP/IP, UI responsiveness, database integrity, and sequence execution.

## 2. Testing Layers & Methodology

### 2.1 Hardware Simulation (Modbus Layer)
Due to hardware availability constraints, testing must utilize a local mock Modbus TCP Server.
*   **Requirement:** The test environment must run a localized Modbus TCP simulator (e.g., a script using `modbus-serial` in server mode).
*   **Capability:** The simulator must be capable of receiving write commands and handling read requests across all Modbus memory areas (Coils, Discrete Inputs, Input Registers, and Holding Registers), retaining state appropriately.
*   **Network Resilience:** The simulator must occasionally drop connections or delay responses to validate the application's timeout and gracefully degrade UI features without crashing.

### 2.2 Unit Testing (Main Process)
Unit tests will focus on the business logic executed within the Electron `Main` process.
*   **Framework:** Jest.
*   **Scope:**
    *   **Data Conversion:** Validate correct parsing of IEEE-754 32-bit floating-point numbers across two 16-bit registers (Endianness verification).
    *   **Sequence Engine:** Validate that the sequence parser correctly evaluates a `Test Assertion` against mock data, accurately outputting Pass/Fail based on the defined Tolerance Band.
    *   **Database (SQLite):** Utilize an in-memory SQLite database (`:memory:`) to test data insertion for Manual Snapshots and logging without corrupting development databases.

### 2.3 End-to-End (E2E) Testing (UI & IPC Layer)
E2E testing validates the user interface and the Context Bridge (IPC) integration.
*   **Framework:** Playwright (with Electron support).
*   **Scope:**
    *   Ensure clicking UI buttons (e.g., "Read AO-05") triggers the correct IPC event and subsequently updates the DOM with the received value.
    *   Verify tab switching logic between the Manual, Sequence, and Calibration dashboards.

## 3. Core Test Cases

### 3.1 Modbus Communication Verification
*   **TC-MOD-01 (Successful Read):** Request a register block from the simulator; verify the UI correctly displays the value.
*   **TC-MOD-02 (Successful Write):** Input a value into the Manual Dashboard; verify the simulator receives the exact correct payload (scaled appropriately).
*   **TC-MOD-03 (Timeout Handling):** Disconnect the simulator; verify the application logs a Modbus Timeout error and displays a 'Fault' indicator on the UI rather than crashing the application.

### 3.2 Sequence Execution
*   **TC-SEQ-01 (Happy Path Sequence):** Execute a defined sequence containing 2 Writes, 1 Delay, and 1 Assertion. Verify the Sequence Engine records a 'Pass' in the database.
*   **TC-SEQ-02 (Assertion Failure):** Force the simulator to return an out-of-tolerance value during an assertion step. Verify the sequence accurately registers a 'Fail' and halts appropriately.
*   **TC-SEQ-03 (Sequence Lockout):** While a sequence is running, verify all interactive controls on the Manual Dashboard are disabled.

### 3.3 Calibration Protocol
*   **TC-CAL-01 (Three-Step Handshake):** Trigger a calibration. Verify the Main process strictly enforces the 3-step order: 1) Zeroing, 2) Writing Coefficients, 3) Security Handshake (`0x5555`/`0xDDDD`).
*   **TC-CAL-02 (Mapping Integrity):** Calibrate abstract signal `AO-05`; verify the system accurately routes the coefficients to the correct holding registers defined in the Signal Mapping Dictionary.

### 3.4 Data Integrity & Logging
*   **TC-LOG-01 (Manual Snapshot):** Trigger a snapshot; verify all current UI values are accurately recorded as a single row/entry in the SQLite database.
*   **TC-LOG-02 (Application Crash Recovery):** Simulate an unhandled exception in the renderer; verify `electron-log` writes the stack trace to the daily rotating log file.

### 3.5 Calibration Dashboard & Process
*   **TC-CAL-UI-01 (Curve Fitting Math Accuracy):** Given a predefined set of X/Y data points, verify the linear regression algorithm accurately calculates `m` (Scale) and `c` (Offset) matching mathematical expectations.
*   **TC-CAL-UI-02 (Endianness Buffer Encoding):** Given an `f32` value (e.g., 1.5), verify the Javascript float is correctly split into a `[highWord, lowWord]` array according to the 4 strict encodings: `ABCD` (Big-Endian), `DCBA` (Little-Endian), `BADC` (Big-Endian Byte Swap), and `CDAB` (Little-Endian Word Swap).
*   **TC-CAL-UI-03 (Audit Log Restoration):** After saving a successful calibration, verify clicking the history record repopulates the UI textboxes with the exact previous `m`, `c`, `deadzone`, and X/Y data point values.

### 3.6 Scale & Load Testing
*   **TC-SCALE-01 (High-Density Dashboard & Concurrency):** Spawn 10 separate `modbus-simulator.js` instances on 10 different local ports to simulate 10 distinct IPs. Verify the Main process's TCP connection pooling and concurrent socket management. Populate the SQLite database with these 10 simulated devices (mapped to `jerry_registers.json`, ~800 total registers), and verify that data snapshots are performantly stored using a JSON blob column schema to avoid schema rigidity.
*   **TC-SCALE-02 (Live Simulator Integration & IPC Batching):** Ensure the manual dashboard successfully renders and manages all 800+ SVG controls/indicators simultaneously on a single view to test DOM rendering limits. Verify that the 500ms block-read polling loop maintains performance without freezing the UI. **Crucially, assert that the Main process aggregates all 10 device payloads into a single bulk IPC message** every 500ms to prevent saturating the Context Bridge. Verify stability even under simulated network faults.

## 4. Automation & CI/CD
*   **Pre-commit Hook:** Unit tests must pass before code can be committed.
*   **Build Pipeline:** E2E tests and mock Modbus tests should run autonomously in a headless CI/CD environment prior to packaging via `electron-builder`.