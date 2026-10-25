/**
 * TC-04: Staggered Auxiliary Blower Acceleration Sequence
 * Source: Step 6, docs/manuals/mpcs_test_simulation_en.md
 */

const { applyPreBootPresets } = require("./common-presets");

module.exports = {
	id: "TC-04",
	name: "Staggered Auxiliary Blower Acceleration (Q118 Timer Protection)",
	type: "positive",
	category: "Operational Sequences",
	description:
		"Simulates time-lagged airflow differential feedback (QVRH at +2s, QVMT1 at +5s, QVMT2 at +8s) preventing internal 5.6s Q118 safety trips.",
	estimatedDurationMs: 12000,
	steps: [
		{
			name: "1. Baseline Preconditions: DJ Closed & Arno Running",
			run: async (bench) => {
				await applyPreBootPresets(bench);
				await bench.set("BATTERY_VOLTAGE", 110);
				await bench.set("I-48", 1);
				await bench.set("I-72", 1);
				await bench.set("I-05", 1);
				await bench.set("I-63", 1);
				await bench.set("OHE_CATENARY", 25);
				await bench.set("AUX_WINDING", 380);
				await bench.set("I-00", 1);
				await bench.set("I-35", 1, "DJ Closed");
				await bench.set("I-18", 1, "MCP Running");
				await bench.set("ARNO_BUS", 380);
				await bench.wait(500);
			},
		},
		{
			name: "2. Stage 1 Blower Feedback (+2s): Transformer Oil Cooler (QVRH)",
			run: async (bench) => {
				await bench.wait(2000);
				await bench.set(
					"I-04",
					1,
					"I-04 (QVRH): Oil cooler radiator airflow established",
				);
			},
		},
		{
			name: "3. Stage 2 Blower Feedback (+5s): Traction Motor Blower 1 (QVMT1)",
			run: async (bench) => {
				await bench.wait(3000); // 2s + 3s = 5s
				await bench.set(
					"I-02",
					1,
					"I-02 (QVMT1): TM-1..3 cooling blower airflow established",
				);
			},
		},
		{
			name: "4. Stage 3 Blower Feedback (+8s): Traction Motor Blower 2 (QVMT2)",
			run: async (bench) => {
				await bench.wait(3000); // 5s + 3s = 8s
				await bench.set(
					"I-03",
					1,
					"I-03 (QVMT2): TM-4..6 cooling blower airflow established",
				);
			},
		},
		{
			name: "5. Verify Q118 Timer Satisfied & DJ Circuit Breaker Sustained",
			run: async (bench) => {
				// DJ must remain sustained with LSDJ lamp off
				await bench.expect("O-00", 1, {
					within: 1000,
					desc: "O-00 (DJ Coil) sustained closed",
				});
				await bench.expect("O-28", 0, {
					within: 1000,
					desc: "O-28 (LSDJ) remains OFF",
				});
			},
		},
	],
};
