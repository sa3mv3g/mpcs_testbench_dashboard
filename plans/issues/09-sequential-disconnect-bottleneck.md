# Sequential Disconnect Bottleneck

## What to build
Optimize the `modbus:disconnectAll` IPC handler in `src/main.js` to disconnect devices in parallel.

Currently, the handler iterates over all registered devices and awaits disconnection sequentially:
```javascript
for (const dev of devices) {
    if (dev.ip && dev.port) {
        await modbusManager.disconnect(dev.ip, dev.port);
    }
}
```
Because `disconnect()` explicitly waits for each device's internal promise queue to drain, a single unresponsive device or a device with a large queue will block the loop. This delays the disconnection of all subsequent devices and causes the UI to hang unnecessarily during a "Disconnect All" operation.

## Acceptance criteria
- [ ] Refactor the loop to use `Promise.all()` to trigger `modbusManager.disconnect()` for all devices simultaneously.
- [ ] Ensure that a slow disconnection on one device does not block the teardown of others.
- [ ] Errors during disconnection of individual devices are caught and do not prevent other devices from disconnecting.

## Blocked by
- None
