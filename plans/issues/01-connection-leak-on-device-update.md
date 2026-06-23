# Connection Leak on Device Update

## What to build
Fix a memory and socket leak in `src/main.js` that occurs when a device's IP or port is updated in the Device Registry.

Currently, `db:updateDevice` connects to the new IP/Port but never calls `modbusManager.disconnect()` on the old IP/Port. This leaves the old `ModbusRTU` client and its polling loop active in the `ModbusManager` connection map indefinitely.

## Acceptance criteria
- [ ] Updating a device's IP or Port correctly disconnects and removes the old connection from `ModbusManager`.
- [ ] Auto-reconnect attempts for the old IP/Port are cancelled.
- [ ] The new IP/Port is connected successfully and polling resumes.
- [ ] No zombie sockets remain after the update.

## Blocked by
- None
