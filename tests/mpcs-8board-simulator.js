const ModbusRTU = require("modbus-serial");
const { DI_POS_TO_ADDR, DI_ADDR_TO_POS } = require("../src/sequence-engine/signal-map");

const BASE_PORT = 15601;
const NUM_BOARDS = 8;
const MAX_MEMORY_ADDRESS = 10000; // Default size for memory arrays

class ModbusBoard {
    constructor(boardId, port) {
        this.boardId = boardId;
        this.port = port;
        this.coils = Buffer.alloc(MAX_MEMORY_ADDRESS).fill(0);
        this.discreteInputs = Buffer.alloc(MAX_MEMORY_ADDRESS).fill(0);
        this.inputRegisters = new Uint16Array(MAX_MEMORY_ADDRESS).fill(0);
        this.holdingRegisters = new Uint16Array(MAX_MEMORY_ADDRESS).fill(0);
        this.writeHistory = []; // Stores { boardId, port, fc, address, value, rawValues, timestamp }

        // Initialize version registers for JerryDevice compatibility
        this.inputRegisters[100] = 0; // Major version (0)
        this.inputRegisters[101] = 8; // Minor version (8)
        this.inputRegisters[102] = 0; // Patch version (0) - matching "0.8.0" expected

        this.server = null;
        this.vector = this._createVector();
    }

    _createVector() {
        return {
            getCoil: async (addr, unitID) => {
                if (addr >= 16 && addr < 24) {
                    return Boolean(this.coils[addr] || this.discreteInputs[addr]);
                }
                return Boolean(this.coils[addr]);
            },
            setCoil: async (addr, value, unitID) => {
                this.coils[addr] = value ? 1 : 0;
                this.writeHistory.push({ boardId: this.boardId, port: this.port, fc: 5, address: addr, value: value ? 1 : 0, timestamp: Date.now() });
                this._onWrite(5, addr, value ? 1 : 0);
            },
            getDiscreteInput: async (addr, unitID) => {
                return this.discreteInputs[addr] === 1;
            },
            getInputRegister: async (addr, unitID) => {
                // Special handling for version registers
                if (addr >= 100 && addr <= 102) {
                    return this.inputRegisters[addr];
                }
                return this.inputRegisters[addr];
            },
            getHoldingRegister: async (addr, unitID) => {
                return this.holdingRegisters[addr];
            },
            setRegister: async (addr, value, unitID) => {
                this.holdingRegisters[addr] = value;
                this.writeHistory.push({ boardId: this.boardId, port: this.port, fc: 6, address: addr, value: value, timestamp: Date.now() });
                this._onWrite(6, addr, value);
            },
            // For multiple coils write function code 15
            setCoils: async (addr, values, unitID) => {
                for (let i = 0; i < values.length; i++) {
                    const currentAddr = addr + i;
                    this.coils[currentAddr] = values[i] ? 1 : 0;
                    this.writeHistory.push({ boardId: this.boardId, port: this.port, fc: 15, address: currentAddr, value: values[i] ? 1 : 0, timestamp: Date.now() });
                    this._onWrite(15, currentAddr, values[i] ? 1 : 0);
                }
            },
            // For multiple registers write function code 16
            setRegisters: async (addr, values, unitID) => {
                for (let i = 0; i < values.length; i++) {
                    const currentAddr = addr + i;
                    this.holdingRegisters[currentAddr] = values[i];
                    this.writeHistory.push({ boardId: this.boardId, port: this.port, fc: 16, address: currentAddr, value: values[i], rawValues: values, timestamp: Date.now() });
                    this._onWrite(16, currentAddr, values[i]);
                }
            }
        };
    }

    _onWrite = (fc, address, value) => { /* Default no-op, can be set by cluster */ };

    async start() {
        return new Promise((resolve, reject) => {
            try {
                this.server = new ModbusRTU.ServerTCP(this.vector, {
                    host: "127.0.0.1",
                    port: this.port,
                    debug: false, // Set to true for Modbus traffic debugging
                });

                this.server.on("error", (err) => {
                    console.error(`[ModbusBoard ${this.boardId}] Server Error:`, err.message);
                });

                this.server.on("socketError", (err) => {
                    console.error(`[ModbusBoard ${this.boardId}] Socket Error:`, err.message);
                });

                this.server.on("initialized", () => {
                    console.log(`[ModbusBoard ${this.boardId}] Modbus TCP Server started on 127.0.0.1:${this.port}`);
                    resolve();
                });

                // Workaround for 'initialized' event not always firing in modbus-serial
                setTimeout(() => {
                    if (!this.server._server.listening) {
                        reject(new Error(`[ModbusBoard ${this.boardId}] Server failed to start on 127.0.0.1:${this.port} after timeout`));
                    }
                }, 1000); // Give it a second to bind
            } catch (err) {
                reject(new Error(`[ModbusBoard ${this.boardId}] Failed to start server: ${err.message}`));
            }
        });
    }

    async stop() {
        if (this.server) {
            console.log(`[ModbusBoard ${this.boardId}] Stopping Modbus TCP Server on 127.0.0.1:${this.port}`);
            await this.server.close();
            this.server = null;
        }
    }

    // --- Inspection APIs ---
    getCoil(address) {
        return this.coils[address] === 1;
    }

    getDiscreteInput(address) {
        return this.discreteInputs[address] === 1;
    }

    getInputRegister(address) {
        return this.inputRegisters[address];
    }

    getHoldingRegister(address) {
        return this.holdingRegisters[address];
    }

    getWriteHistory(address = null) {
        if (address !== null) {
            return this.writeHistory.filter(entry => entry.address === address);
        }
        return this.writeHistory;
    }
}

class ModbusSimulatorCluster {
    constructor(basePort = BASE_PORT, numBoards = NUM_BOARDS) {
        this.boards = new Map();
        this.basePort = basePort;
        this.numBoards = numBoards;
        this.feedbackDelayMs = 0;
        for (let i = 0; i < numBoards; i++) {
            const boardId = i + 1;
            const port = basePort + i;
            this.boards.set(boardId, new ModbusBoard(boardId, port));
        }
        this.setReactiveLogic(this._defaultReactiveLogic);
    }

    // Default reactive logic for MPCS simulation
    _defaultReactiveLogic = (cluster, sourceBoardId, fc, address, value) => {
        // Example: If I-00 (Board 1, Coil 0) is written, set O-00 (Board 1, Discrete Input 23) to 1
        // This mimics a simple feedback loop for Cab Activation (I-00 is Cab Active)
        if (sourceBoardId === 1 && fc === 5 && address === 0 && value === 1) { // I-00 ON
            const targetBoard = cluster.getBoard(1);
            targetBoard.discreteInputs[DI_POS_TO_ADDR[1]] = 1; // O-00 ON
            targetBoard.coils[DI_POS_TO_ADDR[1]] = 1;
            console.log(`[Reactive] Board 1 Coil 0 ON -> Board 1 Discrete Input ${DI_POS_TO_ADDR[1]} ON`);
        } else if (sourceBoardId === 1 && fc === 5 && address === 0 && value === 0) { // I-00 OFF
            const targetBoard = cluster.getBoard(1);
            targetBoard.discreteInputs[DI_POS_TO_ADDR[1]] = 0; // O-00 OFF
            targetBoard.coils[DI_POS_TO_ADDR[1]] = 0;
            console.log(`[Reactive] Board 1 Coil 0 OFF -> Board 1 Discrete Input ${DI_POS_TO_ADDR[1]} OFF`);
        }

        // TC-01 Cab Activation reactive rule:
        // Stimulus: BATTERY_VOLTAGE (Board 1 HR 0 >= 100), I-48 (Board 4 Coil 0), I-72 (Board 5 Coil 8)
        // Feedback: O-28 (Board 4 DI_POS_TO_ADDR[5] = 21)
        if (cluster.boards.has(1) && cluster.boards.has(4) && cluster.boards.has(5)) {
            const b1 = cluster.getBoard(1);
            const b4 = cluster.getBoard(4);
            const b5 = cluster.getBoard(5);
            const o28Addr = DI_POS_TO_ADDR[5]; // 21
            const isTc01Active = () =>
                b1.holdingRegisters[0] >= 100 &&
                Boolean(b4.coils[0]) &&
                Boolean(b5.coils[8]);

            if (isTc01Active()) {
                if (cluster.feedbackDelayMs > 0) {
                    setTimeout(() => {
                        if (isTc01Active()) {
                            b4.discreteInputs[o28Addr] = 1;
                            b4.coils[o28Addr] = 1;
                        }
                    }, cluster.feedbackDelayMs);
                } else {
                    b4.discreteInputs[o28Addr] = 1;
                    b4.coils[o28Addr] = 1;
                }
            } else {
                b4.discreteInputs[o28Addr] = 0;
                b4.coils[o28Addr] = 0;
            }
        }

        // Additional reactive rules for other signals/boards can be added here
        // Example: If a holding register on board 2 is written, reflect it to an input register on board 3
        if (sourceBoardId === 2 && fc === 6 && address === 0) { // Board 2 Holding Register 0 written
            const targetBoard = cluster.getBoard(3);
            targetBoard.inputRegisters[0] = value;
            console.log(`[Reactive] Board 2 HR 0 written (${value}) -> Board 3 IR 0 updated`);
        }
    };

    async startAll() {
        console.log(`Starting ${this.numBoards} Modbus boards from port ${this.basePort}...`);
        const startPromises = Array.from(this.boards.values()).map(board => board.start());
        await Promise.all(startPromises);
        console.log("All Modbus boards started.");
    }

    async stopAll() {
        console.log("Stopping all Modbus boards...");
        const stopPromises = Array.from(this.boards.values()).map(board => board.stop());
        await Promise.all(stopPromises);
        console.log("All Modbus boards stopped.");
    }

    getBoard(boardId) {
        if (!this.boards.has(boardId)) {
            throw new Error(`Board with ID ${boardId} not found.`);
        }
        return this.boards.get(boardId);
    }

    // Proxy inspection APIs to specific board
    getCoil(boardId, address) {
        return this.getBoard(boardId).getCoil(address);
    }

    getDiscreteInput(boardId, address) {
        return this.getBoard(boardId).getDiscreteInput(address);
    }

    getInputRegister(boardId, address) {
        return this.getBoard(boardId).getInputRegister(address);
    }

    getHoldingRegister(boardId, address) {
        return this.getBoard(boardId).getHoldingRegister(address);
    }

    getWriteHistory(boardId, address = null) {
        return this.getBoard(boardId).getWriteHistory(address);
    }

    getAllBoardPorts() {
        return Array.from(this.boards.values()).map(board => board.port);
    }

    // Reactive engine logic can go here or be injected
    setReactiveLogic(logicFunction) {
        Array.from(this.boards.values()).forEach(board => {
            board._onWrite = (fc, address, value) => {
                logicFunction(this, board.boardId, fc, address, value);
            };
        });
    }
}

// Allow direct CLI execution
if (require.main === module) {
    const simulator = new ModbusSimulatorCluster();
    simulator.startAll().catch(err => {
        console.error("Failed to start simulator cluster:", err);
        process.exit(1);
    });

    // Keep process alive
    process.on('SIGINT', async () => {
        console.log("Received SIGINT. Shutting down simulators...");
        await simulator.stopAll();
        process.exit(0);
    });
}

module.exports = { ModbusSimulatorCluster, ModbusBoard, BASE_PORT, NUM_BOARDS };
