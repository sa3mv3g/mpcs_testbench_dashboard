# Domain Context

## Glossary

* **Test Sequence**
  * *Definition*: A defined array of automated testing steps. A sequence can execute Modbus writes to Output ports, enforce timing delays, and read Input ports to compare against expected values.
  * *Replaces*: "Presets" or "Scenarios".
* **Test Assertion**
  * *Definition*: The evaluation criteria within a Test Sequence step. It consists of a target Read port, an Expected Value, a Tolerance Band (e.g., ± 0.2V), and a settle Timeout. Used to generate a Pass/Fail result.
* **Sequence Engine**
  * *Definition*: The component in the Main process responsible for parsing and executing Test Sequences step-by-step. It evaluates Test Assertions in real-time, logs the Pass/Fail results to SQLite, and halts the sequence on critical failures.
* **Sequence Lockout**
  * *Definition*: A safety mechanism that locks/disables the Manual Dashboard controls while a Test Sequence is executing, preventing human interference with automated states.
* **Manual Dashboard**
  * *Definition*: A UI view that exactly mirrors the physical Testbench Front Panel. Controls are organized by I/O type and labeled with their unique physical port numbers, independent of the underlying network architecture.
* **Sequence Builder Dashboard**
  * *Definition*: A dedicated UI view where engineers can visually design, edit, and save Test Sequences. Users can chain together output writes, delays, and tolerance-band assertions, saving the final recipe into SQLite.
* **Calibration Dashboard**
  * *Definition*: A dedicated UI view for hardware maintenance. Like the Manual Dashboard, it is organized intuitively by Front Panel labels (e.g., `AO-05`). It uses the Signal Mapping Dictionary to route calibration inputs to the correct hardware registers behind the scenes.
* **Manual Snapshot**
  * *Definition*: A user-triggered action from the Manual Dashboard that captures the exact current state of all mapped signals and saves it to the SQLite database as a discrete "Manual Log Entry", independent of automated sequences.
* **Signal Mapping Dictionary**
  * *Definition*: The abstraction layer (stored in SQLite) that translates a physical port label (e.g., `AO-05`) into the underlying DAQ Device IP, its primary Data Register (for reading), AND its dedicated **Calibration Holding Register** block (Scale, Offset, Deadzone).
* **Hardware Calibration Protocol**
  * *Definition*: A strict three-step operation orchestrated by the Main Process: 
    1. **Zeroing**: Reset previous coefficients (Scale = 1.0, Offset = 0.0, Deadzone = 0.0).
    2. **Writing**: Write the new calibrated coefficients to the holding registers.
    3. **Handshake**: Commit the changes to firmware memory by writing a global security key (`0x5555` to `key1` and `0xDDDD` to `key2`).
* **Device Registry**
  * *Definition*: The central truth for what hardware exists on the network. Stored in SQLite, it tracks the IP Address, Port, Display Name, and the global security Modbus registers (`key1` and `key2`) for each DAQ device.
* **Main Process Orchestrator**
  * *Definition*: The central Node.js process in the Electron app. It is the sole owner of the Modbus TCP/IP polling loop, the SQLite database connection, and the Sequence Engine, pushing state updates to the UI via IPC.
* **Graceful UI Degradation**
  * *Definition*: Handling Modbus timeouts or errors by displaying clear visual indicators (e.g., 'Fault' overlays on mechanical gauges) rather than crashing the interface or displaying raw exception traces.

## Key Architectural Decisions

* **Modbus IPC Boundary**: All Modbus TCP/IP network communication occurs strictly in the Main process using async/await. The Renderer process only receives state updates and sends intents.
* **Modbus Data Formatting**: All analog values are handled natively as pre-scaled **IEEE-754 32-bit floats** directly by the DAQ firmware (spanning two 16-bit Modbus registers). The application does not apply manual UI multipliers/offsets, but handles standard 32-bit float parsing and endianness.
* **UI Separation (Front Panel vs Hardware)**: The **Manual Dashboard** provides a 1:1 digital twin of the physical testbench using the Signal Mapping abstraction. The **Calibration Dashboard** follows the same abstract label structure (e.g., calibrating `AO-05` directly) to ensure maintenance is intuitive for the operator.
* **Data Logging Strategy**: To prevent database bloat, timeseries data is **only** logged to SQLite when a Test Sequence is actively running, OR when the user explicitly triggers a **Manual Snapshot**. During standard idle UI monitoring, the continuous polling data is transient.
* **Application Logging**: Utilizing `electron-log` for centralized, daily rotating log files across both the Main and Renderer processes to ensure crash post-mortem capabilities.
* **Packaging & Distribution**: The application is packaged using `electron-builder` to generate a native Windows NSIS installer (`.exe`). This handles the compilation of native Node modules (SQLite, Serial/Modbus) for the target environment.