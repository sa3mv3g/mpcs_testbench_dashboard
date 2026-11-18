/**
 * Signal Map & Hardware Port Resolver for MPCS Testbench
 *
 * Translates locomotive signals (I-00 to I-127, O-00 to O-79)
 * and analog channels to the physical Testbench DAQ controller targets.
 *
 * Adheres to:
 * - docs/manuals/mpcs_test_simulation_en.md
 * - docs/adr/0003-sequence-engine-architecture-and-safety-teardown.md
 * - src/renderer/dashboard-exporter.js (standardized Jerry Testbench port mapping)
 */

const DI_POS_TO_ADDR = {
	1: 23,
	2: 17,
	3: 22,
	4: 16,
	5: 21,
	6: 20,
	7: 19,
	8: 18,
};

const DI_ADDR_TO_POS = {
	23: 1,
	17: 2,
	22: 3,
	16: 4,
	21: 5,
	20: 6,
	19: 7,
	18: 8,
};

/**
 * Standard Analog Potentiometer & Voltage Signal Aliases
 * Mapped to the 8 DAC controllers on the Jerry Testbench
 */
const ANALOG_SIGNAL_ALIASES = {
	BATTERY_VOLTAGE: {
		devId: 1,
		addr: 0,
		guiId: "ao-1-0",
		defaultVal: 110,
		unit: "V DC",
	},
	OHE_CATENARY: {
		devId: 2,
		addr: 0,
		guiId: "ao-2-0",
		defaultVal: 25,
		unit: "kV AC",
	},
	AUX_WINDING: {
		devId: 3,
		addr: 0,
		guiId: "ao-3-0",
		defaultVal: 380,
		unit: "V AC",
	},
	ARNO_BUS: {
		devId: 4,
		addr: 0,
		guiId: "ao-4-0",
		defaultVal: 380,
		unit: "V AC",
	},
	TM_VOLTAGE: {
		devId: 5,
		addr: 0,
		guiId: "ao-5-0",
		defaultVal: 100,
		unit: "V DC",
	},
};

/**
 * Resolves a signal identifier to its hardware target.
 *
 * @param {string} signal - E.g. "I-00", "I-35", "O-00", "O-28", "BATTERY_VOLTAGE", or direct "do-1-0"
 * @returns {Object} Hardware mapping object
 */
function resolveSignal(signal) {
	if (!signal || typeof signal !== "string") {
		throw new Error(`Invalid signal identifier: "${signal}"`);
	}

	const normalized = signal.trim().toUpperCase();

	// Check analog aliases first
	if (ANALOG_SIGNAL_ALIASES[normalized]) {
		const entry = ANALOG_SIGNAL_ALIASES[normalized];
		return {
			tag: normalized,
			type: "analog-out",
			devId: entry.devId,
			address: entry.addr,
			guiId: entry.guiId,
			unit: entry.unit,
		};
	}

	// 1. MPCS Digital Input / Testbench Stimulus (I-00 to I-127)
	const iMatch = normalized.match(/^I-(\d+)$/i);
	if (iMatch) {
		const bitNum = parseInt(iMatch[1], 10);
		if (bitNum < 0 || bitNum > 127) {
			throw new Error(`Stimulus signal ${signal} out of range (0..127)`);
		}
		const devId = Math.floor(bitNum / 16) + 1;
		const coilAddr = bitNum % 16;
		const guiId = `do-${devId}-${coilAddr}`;
		return {
			tag: `I-${String(bitNum).padStart(2, "0")}`,
			type: "stimulus", // Drive via writeCoil
			devId,
			address: coilAddr,
			guiId,
		};
	}

	// 2. MPCS Digital Output / Testbench Response (O-00 to O-79)
	const oMatch = normalized.match(/^O-(\d+)$/i);
	if (oMatch) {
		const outBit = parseInt(oMatch[1], 10);
		if (outBit < 0 || outBit > 79) {
			throw new Error(`Response signal ${signal} out of range (0..79)`);
		}
		const devId = Math.floor(outBit / 8) + 1;
		const pos = (outBit % 8) + 1;
		const addr = DI_POS_TO_ADDR[pos] || pos + 15;
		const guiId = `di-${devId}-${addr}`;
		return {
			tag: `O-${String(outBit).padStart(2, "0")}`,
			type: "response", // Read via readDiscreteInputs / latestIndicatorState
			devId,
			address: addr,
			guiId,
		};
	}

	// 3. Direct GUI IDs: do-X-Y
	const doMatch = signal.match(/^do-(\d+)-(\d+)$/i);
	if (doMatch) {
		const devId = parseInt(doMatch[1], 10);
		const addr = parseInt(doMatch[2], 10);
		const bitNum = (devId - 1) * 16 + addr;
		return {
			tag: `I-${String(bitNum).padStart(2, "0")}`,
			type: "stimulus",
			devId,
			address: addr,
			guiId: signal.toLowerCase(),
		};
	}

	// 4. Direct GUI IDs: di-X-Y
	const diMatch = signal.match(/^di-(\d+)-(\d+)$/i);
	if (diMatch) {
		const devId = parseInt(diMatch[1], 10);
		const addr = parseInt(diMatch[2], 10);
		const pos = DI_ADDR_TO_POS[addr] || (addr >= 16 ? addr - 15 : 1);
		const outBit = (devId - 1) * 8 + (pos - 1);
		return {
			tag: `O-${String(outBit).padStart(2, "0")}`,
			type: "response",
			devId,
			address: addr,
			guiId: signal.toLowerCase(),
		};
	}

	// 5. Direct GUI IDs: ao-X-Y
	const aoMatch = signal.match(/^ao-(\d+)-(\d+)$/i);
	if (aoMatch) {
		const devId = parseInt(aoMatch[1], 10);
		const addr = parseInt(aoMatch[2], 10);
		return {
			tag: signal,
			type: "analog-out",
			devId,
			address: addr,
			guiId: signal.toLowerCase(),
		};
	}

	// 6. Direct GUI IDs: ai-X-Y
	const aiMatch = signal.match(/^ai-(\d+)-(\d+)$/i);
	if (aiMatch) {
		const devId = parseInt(aiMatch[1], 10);
		const addr = parseInt(aiMatch[2], 10);
		return {
			tag: signal,
			type: "analog-in",
			devId,
			address: addr,
			guiId: signal.toLowerCase(),
		};
	}

	throw new Error(`Unknown signal format: "${signal}"`);
}

module.exports = {
	resolveSignal,
	ANALOG_SIGNAL_ALIASES,
	DI_POS_TO_ADDR,
	DI_ADDR_TO_POS,
};
