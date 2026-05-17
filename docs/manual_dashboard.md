# Manual Dashboard 

This dashboard allows operators to manually read/write the state of physical controls/indicators on the testbench's Panel. Because different testbench panels have different physical layouts depending on manufacturing, the UI must dynamically mirror the physical hardware.

**Layout Architecture:** To achieve a 1:1 physical resemblance, the application features a **Drag-and-Drop Canvas Mode**. Administrators can freely position and resize widgets on the screen. The X/Y coordinates, width, and height of each control are saved directly to SQLite alongside the Signal Mapping.

This software is the modbus master. And we need to keep every indicator/control updated. Therefore, all the element's value will  be updates in 500ms.

Now, there are 4 possible element types:
1. **Number Read** (Indicator): E.g., digital LCD readout.
2. **Number Write** (Indicator + Control): E.g., digital readout with up/down arrows or keypad.
3. **Digital Read** (Indicator): E.g., LED lamp.
4. **Digital Write** (Indicator + Control): E.g., physical switch.

**Visual Rendering:** To achieve the "classic instrument" look, the application will use **SVG/Image sprites** that switch states (e.g., an SVG of a physical switch flipping up/down, or an LED toggling between grey and bright green). These sprites will scale gracefully within their drag-and-drop bounding boxes.

## Polling Architecture

The software acts as the sole Modbus Master. To guarantee that all dashboard elements are updated every 500ms without flooding the network, the **Main Process** employs an optimized polling strategy:
* **Block Reads:** Instead of polling each signal individually, the Engine groups all active dashboard signals by Device IP. It calculates the continuous memory block (Min to Max register) required for that device and issues a single, efficient Modbus block read, parsing the specific signal values out of the resulting payload before sending a unified IPC state update to the UI.
* **Write Preemption:** Because operators expect a 1:1 physical feel, user-initiated Modbus Writes (e.g., flipping a toggle switch) immediately preempt the 500ms read loop. The system pauses the polling cycle, executes the write instantly to ensure hardware responsiveness, and then resumes normal polling.

## Sequence Lockout

To ensure hardware safety, the application enforces strict separation between Manual mode and Automated Test Sequences. Because the Manual Dashboard and Sequence Dashboard exist as separate tabs, **the entire Manual Dashboard tab is completely deactivated** while a Test Sequence is actively running. This prevents any operator from accidentally overriding automated hardware states or causing Modbus command collisions.


