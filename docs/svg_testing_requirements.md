# Manual Dashboard SVG Testing Strategy

## 1. Overview
This document outlines the testing strategy and key test cases for the SVG-based rendering of the Manual Dashboard. The dashboard relies on dynamic inline `<svg>` components that scale and change state based on Modbus data, requiring validation for visual correctness, state logic, and layout integrity.

## 2. Corner Cases

### 2.1 Visual & Layout Boundaries
*   **Extreme Scaling:** Resizing an SVG component to minimum (e.g., 10x10) or maximum bounds must preserve aspect ratio without clipping.
*   **Text Overflow:** Digital LCD readouts receiving excessively large numbers (e.g., `9999999.9999`) or invalid values (`NaN`, `Infinity`) must truncate or scale text to prevent exceeding the SVG bounding box.
*   **Runtime Repositioning:** Ensuring runtime drag-and-drop mechanics prevent or correctly render overlapping SVG elements on the Z-axis when operators dynamically reposition controls.

### 2.2 State & Data Integrity
*   **Invalid Modbus States:** Digital indicators expecting boolean logic (0/1) receiving out-of-bounds values (e.g., 2, `null`) must display a neutral or error fallback state, avoiding UI crashes.
*   **Rapid User Interaction (Optimistic UI):** Clicking a digital switch faster than the 500ms polling cycle must trigger immediate optimistic UI updates without flickering.
*   **Graceful Degradation (Localized Faults):** During a Modbus timeout or partial register read failure, SVGs must clearly overlay a localized "Fault" or "Offline" visual indicator over their last known state, ensuring unaffected components remain functional.

## 3. Test Cases

### 3.1 Unit Tests (Jest)
Focus: Data transformation and SVG state logic.
*   **TC-SVG-U01:** Verify mapping logic correctly returns the 'ON' SVG state object for a value of `1` and 'OFF' for `0`.
*   **TC-SVG-U02:** Verify float values are correctly formatted and rounded (e.g., to 2 decimal places) before injection into the SVG text payload.
*   **TC-SVG-U03:** Verify out-of-bounds discrete data triggers the fallback error state object.
*   **TC-SVG-U04 (Optimistic Rollback):** Verify that if a Modbus write fails, the state manager reverts the optimistic UI state back to the true hardware state.

### 3.2 End-to-End Tests (Playwright)
Focus: DOM integration, Visual Regression, and Interactivity.
*   **TC-SVG-E2E-01 (Visual Regression):** Compare screenshots of Digital Read indicators in both `0` (OFF) and `1` (ON) states against baseline images.
*   **TC-SVG-E2E-02 (DOM Attribute Check):** Assert that a Number Write event triggers the correct inline SVG `<path>` or `<text>` fill/color attributes via direct DOM inspection.
*   **TC-SVG-E2E-03 (Localized Fault Overlay):** Mock a partial Modbus register failure and verify the localized 'Fault' overlay SVG element becomes visible strictly on the affected component.
*   **TC-SVG-E2E-04 (Preemption & Rollback):** Simulate a click on an SVG switch. Assert the visual state toggles instantly (optimistic update), and subsequently assert it rolls back to the original state if a mock Modbus write failure response is returned.

## 4. Operator Flows & Business Logic (E2E)

### 4.1 Manual Dashboard Interactions
*   **TC-FLOW-01 (Continuous Monitoring):** Operator opens the Manual Dashboard. Verify that all configured SVG components successfully render and begin updating their visual states every 500ms based on incoming Modbus polling data.
*   **TC-FLOW-02 (Hardware Actuation):** Operator clicks a digital write switch. Verify the UI preempts the polling loop, immediately updates the SVG to 'ON', and confirms the write to the hardware.
*   **TC-FLOW-03 (Manual Data Snapshot):** Operator clicks the "Take Snapshot" button. Verify the SQLite database insertion accurately reflects the underlying Modbus data model state (decoupled from the DOM visual state) without interrupting live SVG rendering.

### 4.2 Sequence Lockout & Safety
*   **TC-FLOW-04 (Sequence Engagement Lockout):** Operator starts an automated Test Sequence. Verify that navigating back to the Manual Dashboard shows every individual SVG control in a disabled/locked state (via specific disabled state payloads sent to each component), preventing manual interference.
*   **TC-FLOW-05 (Lockout Release):** When a Test Sequence finishes or faults, verify that the individual SVG components automatically receive unlocked state payloads, restoring manual actuation.

### 4.3 Calibration State Context
*   **TC-FLOW-06 (Multi-Window Calibration Sync):** Operator completes a calibration procedure on the separate Calibration Dashboard window. Verify that the correct IPC broadcast event is sent to the main process and forwarded to the Manual Dashboard renderer, ensuring the SVG readout instantly updates to display the newly calibrated scaled value.