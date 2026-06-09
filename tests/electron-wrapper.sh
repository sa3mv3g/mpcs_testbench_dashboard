#!/bin/bash
# Wrapper around the Electron binary that:
# 1. Unsets ELECTRON_RUN_AS_NODE (set by Playwright's own process) so Electron
#    runs as a proper Electron app, not a plain Node.js process.
# 2. Strips --no-sandbox and --remote-debugging-port flags that Playwright 1.60
#    injects unconditionally but this Electron build rejects.

ELECTRON_BIN="$(cd "$(dirname "$0")/.." && pwd)/node_modules/electron/dist/electron"

FILTERED_ARGS=()
for arg in "$@"; do
    case "$arg" in
        --no-sandbox) ;;                  # strip — not supported by this build
        --remote-debugging-port=*) ;;     # strip — not supported as a top-level flag
        *) FILTERED_ARGS+=("$arg") ;;
    esac
done

# Unset ELECTRON_RUN_AS_NODE so Electron starts in app mode, not Node mode.
unset ELECTRON_RUN_AS_NODE

exec "$ELECTRON_BIN" "${FILTERED_ARGS[@]}"
