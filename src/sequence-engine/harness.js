/**
 * Testbench Harness API for Action Sequences
 *
 * Implements the standard asynchronous test harness (bench.set, bench.pulse, bench.expect, bench.wait)
 * adhering to:
 * - plans/action-sequence-engine-plan.md
 * - docs/adr/0003-sequence-engine-architecture-and-safety-teardown.md
 * - docs/CONTEXT.md (Locomotive/MPCS perspective)
 */

const { resolveSignal } = require("./signal-map");

class AssertionError extends Error {
	constructor(message, details = {}) {
		super(message);
		this.name = "AssertionError";
		this.details = details;
	}
}

class AbortError extends Error {
	constructor(message = "Sequence aborted by operator") {
		super(message);
		this.name = "AbortError";
	}
}

class TestbenchHarness {
	/**
	 * @param {Object} options
	 * @param {Function} options.directWrite - Async function (deviceIp, port, fc, address, value, unitId)
	 * @param {Function} options.getDeviceIp - Async function (devId) => IP string
	 * @param {Object} options.latestIndicatorState - In-memory polled state cache { [guiId]: { processValue } }
	 * @param {Function} options.logger - Function to log progress messages
	 * @param {Function} options.isAborted - Function returning boolean if test was aborted
	 * @param {Function} options.onStepProgress - Callback for real-time progress events
	 */
	constructor(options = {}) {
		this.directWrite = options.directWrite;
		this.getDeviceIp = options.getDeviceIp;
		this.latestIndicatorState = options.latestIndicatorState || {};
		this.logger = options.logger || console.log;
		this.isAborted = options.isAborted || (() => false);
		this.onStepProgress = options.onStepProgress || (() => {});

		// Track all written signals during this sequence run for Safe Teardown
		this.energizedSignals = new Map(); // signalTag -> { target, value }
		this.stepAuditLogs = [];
	}

	_checkAbort() {
		if (this.isAborted()) {
			throw new AbortError(
				"Test sequence aborted by operator / emergency stop.",
			);
		}
	}

	/**
	 * Set a stimulus signal (I-xx) or analog channel to a given value.
	 *
	 * @param {string} signalTag - E.g. "I-00", "I-35", "BATTERY_VOLTAGE"
	 * @param {number|boolean} value - Target value (1/0, true/false, or voltage)
	 * @param {string} [comment] - Human readable note
	 */
	async set(signalTag, value, comment = "") {
		this._checkAbort();
		const target = resolveSignal(signalTag);
		const numericVal =
			typeof value === "boolean" ? (value ? 1 : 0) : Number(value);

		const ip = await this.getDeviceIp(target.devId);
		if (!ip) {
			throw new Error(
				`Cannot write signal ${signalTag}: Device ${target.devId} is offline or not configured`,
			);
		}

		const t0 = Date.now();
		let fc = "writeCoil";
		if (target.type === "analog-out") {
			fc = "writeRegister";
		}

		const res = await this.directWrite({
			ip,
			port: 502,
			fc,
			address: target.address,
			value: numericVal,
			unitId: target.devId,
		});

		if (!res || !res.success) {
			const err = res && res.error ? res.error : "Modbus direct write failed";
			throw new Error(`Failed to set ${signalTag} to ${value}: ${err}`);
		}

		const elapsed = Date.now() - t0;
		if (numericVal !== 0) {
			this.energizedSignals.set(signalTag, { target, value: numericVal });
		} else {
			this.energizedSignals.delete(signalTag);
		}

		this.log(
			`SET ${signalTag} = ${numericVal} (${elapsed}ms)${comment ? ` [${comment}]` : ""}`,
		);
		return { success: true, elapsed };
	}

	/**
	 * Pulse a digital stimulus signal High (1) for durationMs, then automatically revert to Low (0).
	 *
	 * @param {string} signalTag - E.g. "I-01" (BP1DJ), "I-26" (MP+)
	 * @param {number} value - Active pulse value (default 1)
	 * @param {number} durationMs - Pulse duration in milliseconds
	 * @param {string} [comment] - Human readable note
	 */
	async pulse(signalTag, value, durationMs, comment = "") {
		this._checkAbort();
		this.log(
			`PULSE START: ${signalTag} = ${value} for ${durationMs}ms${comment ? ` [${comment}]` : ""}`,
		);
		await this.set(signalTag, value, `${comment} (pulse start)`);
		await this.wait(durationMs);
		await this.set(signalTag, 0, `${comment} (pulse end)`);
		this.log(`PULSE END: ${signalTag} reverted to 0`);
	}

	/**
	 * Non-blocking delay with abort polling every 50ms.
	 *
	 * @param {number} ms - Milliseconds to sleep
	 */
	async wait(ms) {
		const start = Date.now();
		while (Date.now() - start < ms) {
			this._checkAbort();
			const remaining = ms - (Date.now() - start);
			const chunk = Math.min(remaining, 50);
			if (chunk <= 0) break;
			await new Promise((resolve) => setTimeout(resolve, chunk));
		}
	}

	/**
	 * Read the latest process value for a signal from the real-time cache.
	 *
	 * @param {string} signalTag - E.g. "O-00", "O-28", "I-00"
	 * @returns {number|null} Current value (1, 0, float, or null if unpolled)
	 */
	async read(signalTag) {
		const target = resolveSignal(signalTag);
		const cached = this.latestIndicatorState[target.guiId];
		if (!cached) return null;
		return cached.processValue;
	}

	/**
	 * Assert that a Response Signal (O-xx) or monitored channel achieves expectedValue within timeoutMs.
	 * Polls the high-speed cache every 50ms.
	 *
	 * @param {string} signalTag - E.g. "O-00" (DJ Coil), "O-28" (LSDJ Lamp)
	 * @param {number|boolean} expectedValue - Expected state (1 or 0)
	 * @param {Object} options - { within: number, desc?: string, pollIntervalMs?: number }
	 */
	async expect(signalTag, expectedValue, options = {}) {
		this._checkAbort();
		const timeoutMs = options.within || 2000;
		const desc = options.desc || "";
		const pollInterval = options.pollIntervalMs || 50;
		const expectedNum =
			typeof expectedValue === "boolean"
				? expectedValue
					? 1
					: 0
				: Number(expectedValue);

		const target = resolveSignal(signalTag);
		const startTime = Date.now();

		this.log(
			`EXPECT: Awaiting ${signalTag} == ${expectedNum} (within ${timeoutMs}ms)${desc ? ` [${desc}]` : ""}`,
		);

		while (Date.now() - startTime <= timeoutMs) {
			this._checkAbort();
			const cached = this.latestIndicatorState[target.guiId];
			const currentVal = cached
				? cached.processValue != null
					? Number(cached.processValue)
					: null
				: null;

			// Check equality
			if (currentVal === expectedNum) {
				const elapsed = Date.now() - startTime;
				this.log(`PASS: ${signalTag} reached ${expectedNum} in ${elapsed}ms`);
				return { passed: true, elapsed, value: currentVal };
			}

			// Broadcast live countdown progress to UI
			const elapsed = Date.now() - startTime;
			this.onStepProgress({
				type: "expect-waiting",
				signalTag,
				expectedValue: expectedNum,
				currentValue: currentVal,
				elapsed,
				timeoutMs,
			});

			await new Promise((resolve) => setTimeout(resolve, pollInterval));
		}

		// Timeout expired without reaching target state
		const totalElapsed = Date.now() - startTime;
		const finalCached = this.latestIndicatorState[target.guiId];
		const finalVal = finalCached ? finalCached.processValue : "UNKNOWN";

		const errorMsg = `EXPECT FAILED: ${signalTag} failed to reach ${expectedNum} within ${timeoutMs}ms (current: ${finalVal}, elapsed: ${totalElapsed}ms)${desc ? ` [${desc}]` : ""}`;
		this.log(`FAIL: ${errorMsg}`);

		throw new AssertionError(errorMsg, {
			signalTag,
			expectedValue: expectedNum,
			actualValue: finalVal,
			timeoutMs,
			elapsedMs: totalElapsed,
			desc,
		});
	}

	/**
	 * Synchronous custom assertion helper.
	 */
	assert(condition, failureMessage) {
		this._checkAbort();
		if (!condition) {
			throw new AssertionError(
				failureMessage || "Custom assertion condition failed",
			);
		}
	}

	/**
	 * Append a log milestone.
	 */
	log(message) {
		const timestamp = new Date().toISOString().substring(11, 23);
		const formatted = `[${timestamp}] [Harness] ${message}`;
		this.logger(formatted);
		this.stepAuditLogs.push({ timestamp: Date.now(), message });
	}

	/**
	 * Post-Sequence Safe Teardown Protocol (ADR 0003)
	 * Drives all energized stimulus signals back to 0V / Default State.
	 */
	async teardown() {
		this.log(
			"Executing Post-Sequence Safe Teardown (resetting energized signals to 0)...",
		);
		const tags = Array.from(this.energizedSignals.keys());

		for (const tag of tags) {
			try {
				await this.set(tag, 0, "Safe Teardown");
			} catch (err) {
				this.log(`Warning during teardown for ${tag}: ${err.message}`);
			}
		}

		this.energizedSignals.clear();
		this.log("Safe Teardown completed. All outputs de-energized.");
	}
}

module.exports = {
	TestbenchHarness,
	AssertionError,
	AbortError,
};
