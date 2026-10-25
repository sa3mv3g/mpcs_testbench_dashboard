/**
 * Action Sequence Engine Unit & Integration Tests
 *
 * Verifies:
 * - Signal Map (I-xx, O-xx, Analog aliases)
 * - Sequence Registry loading and discovery
 * - Testbench Harness (set, pulse, expect, teardown)
 * - Sequence Runner lifecycle & abort
 * - Excel Test Certificate generation
 */

const path = require("path");
const { resolveSignal } = require("../src/sequence-engine/signal-map");
const { SequenceRegistry } = require("../src/sequence-engine/registry");
const {
	TestbenchHarness,
	AssertionError,
} = require("../src/sequence-engine/harness");
const { SequenceRunner } = require("../src/sequence-engine/runner");
const {
	generateSequenceCertificateWorkbook,
} = require("../src/sequence-engine/exporter");

describe("Action Sequence Engine Test Suite", () => {
	describe("1. Signal Map Resolution", () => {
		test("Resolves stimulus signals (I-00 to I-127) to correct controller & coil", () => {
			const sig0 = resolveSignal("I-00");
			expect(sig0).toEqual({
				tag: "I-00",
				type: "stimulus",
				devId: 1,
				address: 0,
				guiId: "do-1-0",
			});

			const sig15 = resolveSignal("I-15");
			expect(sig15).toEqual({
				tag: "I-15",
				type: "stimulus",
				devId: 1,
				address: 15,
				guiId: "do-1-15",
			});

			const sig16 = resolveSignal("I-16");
			expect(sig16).toEqual({
				tag: "I-16",
				type: "stimulus",
				devId: 2,
				address: 0,
				guiId: "do-2-0",
			});

			const sig80 = resolveSignal("I-80"); // Mode Selection
			expect(sig80).toEqual({
				tag: "I-80",
				type: "stimulus",
				devId: 6,
				address: 0,
				guiId: "do-6-0",
			});
		});

		test("Resolves response signals (O-00 to O-79) to correct controller & discrete input address", () => {
			const o0 = resolveSignal("O-00"); // DJ Coil
			expect(o0).toEqual({
				tag: "O-00",
				type: "response",
				devId: 1,
				address: 23,
				guiId: "di-1-23",
			});

			const o1 = resolveSignal("O-01"); // C118 Contactor
			expect(o1).toEqual({
				tag: "O-01",
				type: "response",
				devId: 1,
				address: 17,
				guiId: "di-1-17",
			});

			const o28 = resolveSignal("O-28"); // LSDJ Red Lamp
			expect(o28).toEqual({
				tag: "O-28",
				type: "response",
				devId: 4,
				address: 21,
				guiId: "di-4-21",
			});
		});

		test("Resolves analog aliases (Battery, Catenary, Arno, TM)", () => {
			const batt = resolveSignal("BATTERY_VOLTAGE");
			expect(batt.type).toBe("analog-out");
			expect(batt.guiId).toBe("ao-1-0");

			const cat = resolveSignal("OHE_CATENARY");
			expect(cat.type).toBe("analog-out");
			expect(cat.guiId).toBe("ao-2-0");
		});

		test("Throws on invalid signal format", () => {
			expect(() => resolveSignal("INVALID_SIG")).toThrow();
			expect(() => resolveSignal("I-999")).toThrow();
			expect(() => resolveSignal("O-999")).toThrow();
		});
	});

	describe("2. Sequence Registry", () => {
		test("Discovers and registers all test sequence modules in src/sequences/", () => {
			const registry = new SequenceRegistry(
				path.join(__dirname, "..", "src", "sequences"),
			);
			registry.loadAll();

			const list = registry.list();
			expect(list.length).toBeGreaterThanOrEqual(11);

			const ids = list.map((s) => s.id);
			expect(ids).toContain("TS-00"); // Master Suite
			expect(ids).toContain("TC-01"); // Cab Activation
			expect(ids).toContain("TC-02"); // Pantograph
			expect(ids).toContain("TC-03"); // DJ Closing
			expect(ids).toContain("TC-04"); // Staggered Blowers
			expect(ids).toContain("TC-05"); // Notch 1
			expect(ids).toContain("TC-06"); // VCD Normal
			expect(ids).toContain("TC-07"); // DJ Watchdog Negative
			expect(ids).toContain("TC-08"); // Compressor Fault Negative
			expect(ids).toContain("TC-09"); // Blower Q118 Trip Negative
			expect(ids).toContain("TC-10"); // VCD Penalty Negative
		});

		test("Can fetch sequence by ID", () => {
			const registry = new SequenceRegistry(
				path.join(__dirname, "..", "src", "sequences"),
			);
			registry.loadAll();

			const tc03 = registry.get("TC-03");
			expect(tc03).toBeDefined();
			expect(tc03.name).toContain("DJ Circuit Breaker Closing");
			expect(Array.isArray(tc03.steps)).toBe(true);
		});
	});

	describe("3. Testbench Harness API", () => {
		let written = [];
		let mockCache = {};
		let harness;

		beforeEach(() => {
			written = [];
			mockCache = {};
			harness = new TestbenchHarness({
				directWrite: async (params) => {
					written.push(params);
					// Update mock cache so feedback is available
					const target = resolveSignal(
						params.fc === "writeCoil"
							? `do-${params.unitId}-${params.address}`
							: `ao-${params.unitId}-${params.address}`,
					);
					mockCache[target.guiId] = { processValue: params.value };
					return { success: true };
				},
				getDeviceIp: async () => "127.0.0.1",
				latestIndicatorState: mockCache,
			});
		});

		test("set() sends correct writeCoil and tracks energized signals", async () => {
			await harness.set("I-00", 1);
			expect(written).toHaveLength(1);
			expect(written[0]).toEqual({
				ip: "127.0.0.1",
				port: 502,
				fc: "writeCoil",
				address: 0,
				value: 1,
				unitId: 1,
			});
			expect(harness.energizedSignals.has("I-00")).toBe(true);

			// Clearing removes from energizedSignals
			await harness.set("I-00", 0);
			expect(harness.energizedSignals.has("I-00")).toBe(false);
		});

		test("pulse() sets signal to 1 and reverts to 0 after duration", async () => {
			await harness.pulse("I-01", 1, 50);
			expect(written).toHaveLength(2);
			expect(written[0].value).toBe(1);
			expect(written[1].value).toBe(0);
		});

		test("expect() resolves successfully when signal matches within timeout", async () => {
			// Pre-populate response signal O-00 (di-1-23)
			mockCache["di-1-23"] = { processValue: 1 };

			const res = await harness.expect("O-00", 1, { within: 500 });
			expect(res.passed).toBe(true);
			expect(res.value).toBe(1);
		});

		test("expect() throws AssertionError on timeout if signal never reaches target", async () => {
			mockCache["di-1-23"] = { processValue: 0 };

			await expect(harness.expect("O-00", 1, { within: 150 })).rejects.toThrow(
				AssertionError,
			);
		});

		test("teardown() drives all energized signals back to 0", async () => {
			await harness.set("I-00", 1);
			await harness.set("I-05", 1);
			await harness.set("I-48", 1);
			expect(harness.energizedSignals.size).toBe(3);

			written = []; // Clear
			await harness.teardown();

			expect(written).toHaveLength(3);
			for (const w of written) {
				expect(w.value).toBe(0);
			}
			expect(harness.energizedSignals.size).toBe(0);
		});
	});

	describe("4. Sequence Runner Execution", () => {
		test("Runs a multi-step sequence to PASS verdict and executes safe teardown", async () => {
			const mockCache = {};
			const written = [];
			let teardownCalled = false;
			const pollingSwitched = [];

			const runner = new SequenceRunner({
				directWrite: async (params) => {
					written.push(params);
					// Auto-simulate MPCS response: if BP1DJ (do-1-1) is written 1, MPCS turns on O-00 (di-1-23)
					if (
						params.fc === "writeCoil" &&
						params.unitId === 1 &&
						params.address === 1 &&
						params.value === 1
					) {
						mockCache["di-1-23"] = { processValue: 1 };
					}
					return { success: true };
				},
				getDeviceIp: async () => "127.0.0.1",
				latestIndicatorState: mockCache,
				onSequenceStateChange: (isActive) => pollingSwitched.push(isActive),
				resetAllDesiredStates: async () => {
					teardownCalled = true;
				},
			});

			const testSeq = {
				id: "TEST-01",
				name: "Mock Closing Test",
				type: "positive",
				steps: [
					{
						name: "Step 1: Driver Press BP1DJ",
						run: async (bench) => {
							await bench.set("I-01", 1);
						},
					},
					{
						name: "Step 2: Expect DJ Coil O-00 ON",
						run: async (bench) => {
							await bench.expect("O-00", 1, { within: 500 });
						},
					},
				],
			};

			const result = await runner.start(testSeq);
			expect(result.status).toBe("PASS");
			expect(result.passedSteps).toBe(2);
			expect(teardownCalled).toBe(true);
			expect(pollingSwitched).toEqual([true, false]);
		});

		test("Catches assertion failure, stops execution, and marks status FAIL", async () => {
			const mockCache = {};
			let teardownCalled = false;

			const runner = new SequenceRunner({
				directWrite: async () => ({ success: true }),
				getDeviceIp: async () => "127.0.0.1",
				latestIndicatorState: mockCache,
				resetAllDesiredStates: async () => {
					teardownCalled = true;
				},
			});

			const testSeq = {
				id: "TEST-FAIL",
				name: "Mock Failing Test",
				type: "positive",
				steps: [
					{
						name: "Step 1: Expect Non-Existent Signal",
						run: async (bench) => {
							await bench.expect("O-00", 1, { within: 100 });
						},
					},
					{
						name: "Step 2: Should Not Execute",
						run: async () => {
							throw new Error("Should never reach step 2");
						},
					},
				],
			};

			const result = await runner.start(testSeq);
			expect(result.status).toBe("FAIL");
			expect(result.passedSteps).toBe(0);
			expect(result.failureReason).toContain("O-00");
			expect(teardownCalled).toBe(true);
		});

		test("Supports abort/emergency stop cleanly", async () => {
			const runner = new SequenceRunner({
				directWrite: async () => ({ success: true }),
				getDeviceIp: async () => "127.0.0.1",
				latestIndicatorState: {},
			});

			const testSeq = {
				id: "TEST-ABORT",
				name: "Mock Long Test",
				type: "positive",
				steps: [
					{
						name: "Step 1: Wait Long Time",
						run: async (bench) => {
							await bench.wait(5000);
						},
					},
				],
			};

			// Start sequence in background and abort 50ms later
			const runPromise = runner.start(testSeq);
			setTimeout(() => {
				runner.abort();
			}, 50);

			const result = await runPromise;
			expect(result.status).toBe("ABORTED");
		});
	});

	describe("5. Excel Test Certificate Exporter", () => {
		test("Generates valid two-sheet workbook conforming to ADR 0002 & ADR 0003", async () => {
			const mockRun = {
				id: 42,
				sequence_id: "TC-03",
				sequence_name: "DJ Circuit Breaker Closing",
				test_type: "positive",
				status: "PASS",
				started_at: "2026-10-24T04:00:00.000Z",
				duration_ms: 7850,
				total_steps: 7,
				passed_steps: 7,
				metadata: {
					mpcs_serial_number: "MPCS-8891-MEDHA",
					loco_number: "LOCO-23145",
					tested_by: "S. Sharma",
					tester_id: "TECH-884",
				},
				step_details: [
					{
						stepIndex: 0,
						name: "Step 1: Baseline Presets",
						status: "PASS",
						durationMs: 450,
					},
					{
						stepIndex: 1,
						name: "Step 2: BLDJ Switch ON",
						status: "PASS",
						durationMs: 120,
					},
					{
						stepIndex: 2,
						name: "Step 3: Verify C118 Contactor",
						status: "PASS",
						durationMs: 80,
					},
					{
						stepIndex: 3,
						name: "Step 4: BP1DJ Pulse",
						status: "PASS",
						durationMs: 2010,
					},
					{
						stepIndex: 4,
						name: "Step 5: Verify DJ Coil",
						status: "PASS",
						durationMs: 140,
					},
					{
						stepIndex: 5,
						name: "Step 6: Inject Feedback",
						status: "PASS",
						durationMs: 50,
					},
					{
						stepIndex: 6,
						name: "Step 7: Verify LSDJ OFF",
						status: "PASS",
						durationMs: 250,
					},
				],
			};

			const workbook = await generateSequenceCertificateWorkbook(mockRun);
			expect(workbook.worksheets).toHaveLength(2);

			const certSheet = workbook.getWorksheet("Certificate");
			expect(certSheet).toBeDefined();
			expect(certSheet.getCell("A1").value).toContain(
				"AUTOMATED TEST CERTIFICATE",
			);
			expect(certSheet.getCell("B2").value).toContain("Electric Locomotive");
			expect(certSheet.getCell("B3").value).toBe("MPCS-8891-MEDHA");
			expect(certSheet.getCell("B12").value).toBe("PASS");

			const auditSheet = workbook.getWorksheet("Step Details");
			expect(auditSheet).toBeDefined();
			expect(auditSheet.rowCount).toBe(8); // Header + 7 steps
		});
	});
});
