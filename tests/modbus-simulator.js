const ModbusRTU = require("modbus-serial");

// 1. Memory State Buffers
// Let's allocate arrays to retain state for each memory area.
// Default to 10000 elements for each to cover a broad range of addresses safely.
const state = {
	coils: Buffer.alloc(10000), // 0 or 1
	discreteInputs: Buffer.alloc(10000), // 0 or 1
	inputRegisters: new Uint16Array(10000),
	holdingRegisters: new Uint16Array(10000),
};

// Seed some initial mock data
state.inputRegisters[0] = 55;
state.holdingRegisters[100] = 1234;

// 2. Network Resilience Simulation Settings
const FAULT_INJECTION = process.env.FAULT_INJECTION === 'true'; // Toggle for random drops/delays
const DELAY_PROBABILITY = 0.1; // 10% chance to delay response
const DROP_PROBABILITY = 0.05; // 5% chance to drop connection entirely
const MAX_DELAY_MS = 2000;

const HOSTAGE_MODE = process.env.HOSTAGE_MODE === 'true';
const DROP_MID_POLL = process.env.DROP_MID_POLL === 'true';
const WRONG_TID = process.env.WRONG_TID === 'true';

let pollCounter = 0;

// Helper to simulate network instability
const simulateNetworkFaults = async () => {
    if (HOSTAGE_MODE) {
        console.warn("🧟 [Hostage Mode] ACKing data but never responding...");
        // Wait forever (or well past client timeout)
        await new Promise((resolve) => setTimeout(resolve, 60000));
    }

    if (DROP_MID_POLL) {
        pollCounter++;
        if (pollCounter > 10) { // Drop after 10 requests
            pollCounter = 0;
            console.warn("⚠️ [Drop Mid-Poll] Dropping connection intentionally.");
            throw new Error("Simulated Connection Drop");
        }
    }

	if (!FAULT_INJECTION) return;

	if (Math.random() < DROP_PROBABILITY) {
		console.warn("⚠️ [Network Fault] Dropping connection intentionally.");
		// Throwing error inside the handler simulates a server-side disconnect/drop
		throw new Error("Simulated Connection Drop");
	}

	if (Math.random() < DELAY_PROBABILITY) {
		const delay = Math.floor(Math.random() * MAX_DELAY_MS);
		console.warn(
			`⏳ [Network Fault] Simulating response delay of ${delay}ms...`,
		);
		await new Promise((resolve) => setTimeout(resolve, delay));
	}
};

// 3. Modbus Vector Mapping
const vector = {
	// Coils
	getCoil: async function (addr, unitID) {
		await simulateNetworkFaults();
		return state.coils[addr] === 1;
	},
	setCoil: async function (addr, value, unitID) {
		await simulateNetworkFaults();
		console.log(`[Simulator] Write Coil[${addr}] = ${value}`);
		state.coils[addr] = value ? 1 : 0;
	},

	// Discrete Inputs
	getDiscreteInput: async function (addr, unitID) {
		await simulateNetworkFaults();
		return state.discreteInputs[addr] === 1;
	},

	// Input Registers
	getInputRegister: async function (addr, unitID) {
		await simulateNetworkFaults();
		return state.inputRegisters[addr];
	},

	// Holding Registers
	getHoldingRegister: async function (addr, unitID) {
		await simulateNetworkFaults();
		return state.holdingRegisters[addr];
	},
	setRegister: async function (addr, value, unitID) {
		await simulateNetworkFaults();
		console.log(`[Simulator] Write HoldingRegister[${addr}] = ${value}`);
		state.holdingRegisters[addr] = value;
	},
};

const host = "0.0.0.0";
const port = parseInt(process.env.PORT || process.argv[2] || "502", 10);

console.log(`Starting Advanced Modbus TCP Simulator on ${host}:${port}...`);
console.log(`Fault Injection: ${FAULT_INJECTION ? "ON" : "OFF"}`);

try {
	const serverTCP = new ModbusRTU.ServerTCP(vector, {
		host: host,
		port: port,
		debug: true,
	});

	serverTCP.on("socketError", function (err) {
		if (err.message === "Simulated Connection Drop") {
			// Suppress internal trace for intentional drops
		} else {
			console.error("[Simulator Network Error]", err.message);
		}
	});

    if (WRONG_TID) {
        console.warn("😈 [Wrong TID Mode] Monkey-patching Modbus server to inject bad TIDs");
        // We have to reach deep into the ModbusRTU.ServerTCP internals to mess with the response framing.
        const netServer = serverTCP._server; // net.Server instance
        if (netServer) {
            netServer.on('connection', (socket) => {
                const originalWrite = socket.write;
                socket.write = function(data, ...args) {
                    if (data && data.length >= 2 && Math.random() < 0.2) { // 20% chance to corrupt
                        console.warn("😈 [Wrong TID Mode] Injecting mismatched TID into response");
                        // Corrupt the TID (bytes 0 and 1 of MBAP)
                        data[0] = 0xDE;
                        data[1] = 0xAD;
                    }
                    return originalWrite.apply(socket, [data, ...args]);
                };
            });
        }
    }

	console.log(`Simulator running. Retaining state across all 4 memory areas.`);
} catch (err) {
	console.error("Failed to start simulator. Check port 502 permissions.", err);
}
