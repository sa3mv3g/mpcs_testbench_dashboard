# Zombie Socket Leak on Disconnect during Reconnect

## What to build
Fix a race condition in `src/modbus-manager.js` where calling `disconnect()` while a background reconnect attempt is pending results in an orphaned socket.

In `_handleDisconnect`, a `setTimeout` awaits `newClient.connectTCP()`. If `disconnect()` is invoked before `connectTCP` finishes, `disconnect()` deletes the connection from the `this.connections` map. However, when `connectTCP` eventually succeeds, it assigns the new socket to the old, un-tracked `connectionObj`, leaving the TCP connection permanently open and unmanaged.

## Acceptance criteria
- [ ] Disconnecting a device actively cancels or aborts any pending `connectTCP` reconnect timers.
- [ ] If `connectTCP` succeeds *after* the device was removed from `connections`, the newly established socket is immediately closed.
- [ ] Removing a device entirely cleanly terminates all related network activity without leaking descriptors.

## Blocked by
- None
