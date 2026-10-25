/**
 * Common Locomotive Baseline Presets
 *
 * Implements the 21 digital input presets defined in Sheet 1 / Section 3.1
 * of docs/manuals/mpcs_test_simulation_en.md.
 */

async function applyPreBootPresets(bench) {
	bench.log("Applying 21 Pre-Boot Static Presets...");

	// 1. Locomotive Mode Selection
	await bench.set("I-80", 1, "Loco Selection 1: Active Mode");
	await bench.set("I-81", 0, "Loco Selection 2: Standard Mode");
	await bench.set("I-82", 0, "Loco Selection 3: Rotary Converter Logic");
	await bench.set("I-83", 0, "Loco Selection 4: DBR Logic");

	// 2. Pneumatic Pressure Governors (Healthy air pressures)
	await bench.set(
		"I-17",
		1,
		"RGCP: Main Reservoir Pressure Normal (8.5-10.0 kg/cm²)",
	);
	await bench.set(
		"I-65",
		1,
		"QPDJ FB: DJ Air Reservoir Pressure Healthy (>4.5 kg/cm²)",
	);
	await bench.set("I-45", 1, "RGEB: Brake Pipe Pressure Charged (5.0 kg/cm²)");

	// 3. Tap Changer (Graduator) Physical Interlocks
	await bench.set("I-19", 1, "GR-0: Tap Changer at physical Notch 0 (Neutral)");
	await bench.set(
		"I-20",
		1,
		"GR-0_31: Tap Changer mechanism physically locked on notch",
	);

	// 4. Protective Safety Relays (Fail-safe normally closed contacts)
	await bench.set(
		"I-49",
		1,
		"QOA / QSIT: Auxiliary Circuit Earth Fault Healthy",
	);
	await bench.set("I-50", 1, "QOP1: Power Circuit 1 Earth Fault Healthy");
	await bench.set("I-51", 1, "QOP2: Power Circuit 2 Earth Fault Healthy");
	await bench.set("I-54", 1, "QLM: Primary Transformer HV Overcurrent Healthy");
	await bench.set("I-64", 1, "QLA FB: Auxiliary Winding Overcurrent Healthy");

	// 5. Equipment Isolating Cut-Out Switches (All normal '1' position)
	await bench.set("I-60", 1, "HMCS 1,2: Traction Motor Cutout Normal");
	await bench.set(
		"I-62",
		1,
		"HMCS & QD: Wheel Slip Differential Circuit Normal",
	);
	await bench.set("I-07", 1, "HVMT1_1: TM Blower 1 Switch Normal");
	await bench.set("I-09", 1, "HVMT2_1: TM Blower 2 Switch Normal");
	await bench.set(
		"I-11",
		1,
		"HVRH_1: Dynamic Brake Resistor Blower Switch Normal",
	);
	await bench.set(
		"I-13",
		1,
		"QVSI1 / HVSI1: Silicon Rectifier 1 Airflow Normal",
	);
	await bench.set(
		"I-14",
		1,
		"QVSI2 / HVSI2: Silicon Rectifier 2 Airflow Normal",
	);

	bench.log("All 21 baseline presets successfully asserted.");
}

module.exports = {
	applyPreBootPresets,
};
