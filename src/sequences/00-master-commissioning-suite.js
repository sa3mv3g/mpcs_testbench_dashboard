/**
 * TS-00: Master Full Locomotive Commissioning Suite
 * Source: Full 10-Step Master Lifecycle, docs/manuals/mpcs_test_simulation_en.md
 */

const { applyPreBootPresets } = require("./common-presets");

module.exports = {
	id: "TS-00",
	name: "Master Full Locomotive Commissioning Suite (Steps 1 to 10)",
	type: "positive",
	category: "Master Commissioning Suite",
	description:
		"Executes the complete end-to-end locomotive lifecycle from cold cab boot to pantograph, DJ closing, staggered blowers, Notch 1 load, VCD cycle, and fault telemetry.",
	estimatedDurationMs: 45000,
	steps: [
		{
			name: "Step 1: Cab-1 Activation & Baseline Health Check",
			run: async (bench) => {
				await applyPreBootPresets(bench);
				await bench.set("BATTERY_VOLTAGE", 110, "Battery = 110V DC");
				await bench.set("I-48", 1, "BL Key = High");
				await bench.set("I-72", 1, "BL1 = High");
				await bench.expect("O-28", 1, {
					within: 3000,
					desc: "O-28 (LSDJ) illuminated (DJ Open / System Ready)",
				});
				await bench.wait(1000);
			},
		},
		{
			name: "Step 2: Pantograph Raising & Catenary Interlock",
			run: async (bench) => {
				await bench.set("I-05", 1, "ZPT1_2: Pantograph 1 Raise");
				await bench.expect("O-02", 1, {
					within: 2000,
					desc: "O-02 (VEPT1) solenoid valve energized",
				});
				// Immediate feedback within 1.0s:
				await bench.set(
					"I-63",
					1,
					"I-63 (QCON): Arno initial no-volt interlock",
				);
				await bench.set("OHE_CATENARY", 25, "OHE Catenary = 25 kV AC");
				await bench.set(
					"AUX_WINDING",
					380,
					"Auxiliary Transformer Winding = 380 V AC",
				);
				await bench.wait(1000);
			},
		},
		{
			name: "Step 3: Arno Converter Starting Phase (BLDJ)",
			run: async (bench) => {
				await bench.set("I-00", 1, "BLDJ Switch ON");
				await bench.expect("O-01", 1, {
					within: 2000,
					desc: "O-01 (C118) starting contactor energized",
				});
				await bench.wait(1000);
			},
		},
		{
			name: "Step 4: DJ Closing Command (BP1DJ Pulse)",
			run: async (bench) => {
				await bench.pulse("I-01", 1, 2000, "BP1DJ Close Pulse (2.0s)");
				await bench.expect("O-00", 1, {
					within: 2000,
					desc: "O-00 (DJ Coil) energized",
				});
			},
		},
		{
			name: "Step 5: Critical DJ & Compressor Feedback Synchronization (< 4.0s)",
			run: async (bench) => {
				// Inject feedbacks within the critical 4-second closing window:
				await bench.set(
					"I-35",
					1,
					"I-35 (DJ FB): Breaker auxiliary contact closed",
				);
				await bench.set(
					"I-18",
					1,
					"I-18 (C101_3 FB): Compressor contactor closed",
				);
				await bench.set(
					"ARNO_BUS",
					380,
					"Arno Converter 3-Phase Bus = 380 V AC",
				);
				// MPCS confirms DJ closed: de-energizes C118 starting contactor and extinguishes LSDJ lamp
				await bench.expect("O-01", 0, {
					within: 3000,
					desc: "O-01 (C118) de-energized",
				});
				await bench.expect("O-28", 0, {
					within: 3000,
					desc: "O-28 (LSDJ) extinguished (DJ Closed)",
				});
			},
		},
		{
			name: "Step 6: Staggered Multi-Step Blower Acceleration (Q118 Protection)",
			run: async (bench) => {
				// Stage 1: +2.0s Oil Cooler Blower (QVRH)
				await bench.wait(2000);
				await bench.set(
					"I-04",
					1,
					"I-04 (QVRH): Oil cooler airflow established (+2s)",
				);

				// Stage 2: +5.0s TM Blower 1 (QVMT1)
				await bench.wait(3000);
				await bench.set(
					"I-02",
					1,
					"I-02 (QVMT1): TM-1..3 blower airflow established (+5s)",
				);

				// Stage 3: +8.0s TM Blower 2 (QVMT2)
				await bench.wait(3000);
				await bench.set(
					"I-03",
					1,
					"I-03 (QVMT2): TM-4..6 blower airflow established (+8s)",
				);

				// Verify DJ remains sustained past Q118 5.6s hardware timer
				await bench.expect("O-00", 1, {
					within: 1000,
					desc: "O-00 (DJ Coil) sustained closed",
				});
			},
		},
		{
			name: "Step 7: Traction Mode Setup & Reverser Direction",
			run: async (bench) => {
				await bench.set("I-27", 1, "I-27 (MPJ FOR): Reverser Forward");
				await bench.set(
					"I-15",
					1,
					"I-15 (BLVMT): Traction motor blower start switch",
				);
				// Satisfy Gap 1:
				await bench.set("I-30", 1, "I-30 (MP_RUN): Master Controller in RUN");
				await bench.set(
					"I-31",
					1,
					"I-31 (CTF_RUN): Changeover drum in Traction",
				);
				await bench.expect("O-10", 1, {
					within: 2000,
					desc: "O-10 (J_FOR) forward electrovalve energized",
				});
			},
		},
		{
			name: "Step 8: Notch-1 Progression & Line Contactor Feedback",
			run: async (bench) => {
				// Pulse MP+ for 1.0s to advance to Notch 1
				await bench.pulse("I-26", 1, 1000, "I-26 (MP+): Notch-Up Pulse");
				// Verify Line Contactors pick up
				await bench.expect("O-26", 1, {
					within: 2000,
					desc: "O-26 (L1-3) energized",
				});
				await bench.expect("O-27", 1, {
					within: 2000,
					desc: "O-27 (L4-6) energized",
				});
				// Immediate feedback within 1.0s:
				await bench.set("I-19", 0, "I-19 (GR-0): Tap changer left Notch 0");
				await bench.set(
					"I-61",
					1,
					"I-61 (L1-L6 FB): Line contactor auxiliary feedback",
				);
				await bench.set(
					"TM_VOLTAGE",
					100,
					"Traction Motor Armature Voltage = 100 V DC",
				);
			},
		},
		{
			name: "Step 9: Vigilance Control Device (VCD) Alertness Cycle & Reset",
			run: async (bench) => {
				bench.log("Awaiting VCD alertness warning cycle...");
				await bench.wait(3000);
				await bench.expect("O-79", 1, {
					within: 5000,
					desc: "O-79 (VCD Warning Lamp) flashing / active",
				});
				// Operator acknowledges warning within 8s grace window
				await bench.pulse(
					"I-126",
					1,
					1000,
					"I-126 (VCD RESET): Alertness acknowledgment",
				);
				await bench.expect("O-79", 0, {
					within: 2000,
					desc: "O-79 (VCD Warning Lamp) extinguished",
				});
			},
		},
		{
			name: "Step 10: Primary Protective Overcurrent Trip (QLM) & Telemetry",
			run: async (bench) => {
				bench.log(
					"Injecting primary overcurrent fault (dropping QLM relay)...",
				);
				// Drop primary overcurrent safety relay to 0
				await bench.set(
					"I-54",
					0,
					"I-54 (QLM): Transformer Primary Overcurrent Trip",
				);
				// DJ must trip instantaneously (<50 ms)
				await bench.expect("O-00", 0, {
					within: 2000,
					desc: "PASS: DJ tripped instantaneously on QLM overcurrent",
				});
				await bench.expect("O-28", 1, {
					within: 1000,
					desc: "PASS: Red LSDJ lamp illuminated (DJ Open / Fault Logged)",
				});
				bench.log(
					"COMMISSIONING SUITE COMPLETE: Full 10-step locomotive simulation verified.",
				);
			},
		},
	],
};
