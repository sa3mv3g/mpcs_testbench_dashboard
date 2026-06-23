# Missing await on Disconnect

## What to build
Add the missing `await` keyword to the `modbusManager.disconnect(dev.ip, dev.port)` call inside the `db:deleteDevice` IPC handler in `src/main.js`.

Since `disconnect` is an asynchronous method that explicitly waits for the device's mutex queue to drain before closing the socket, omitting `await` here causes unhandled promise rejections or race conditions where the database deletion finishes while the socket is still actively trying to flush commands.

## Acceptance criteria
- [ ] Device deletion awaits the clean teardown of the Modbus socket.
- [ ] Errors during socket disconnection are caught and logged appropriately without crashing the IPC handler.
- [ ] The database deletion transaction only returns success to the UI after the socket is confirmed closed.

## Blocked by
- None
