/**
 * Excel Test Certificate Exporter
 *
 * Generates official, read-only .xlsx test certificates for executed action sequences.
 * Adheres to:
 * - docs/adr/0002-manual-dashboard-local-export-and-test-provenance.md
 * - docs/adr/0003-sequence-engine-architecture-and-safety-teardown.md
 */

const ExcelJS = require("exceljs");

/**
 * Build an ExcelJS workbook for a sequence run record.
 *
 * @param {Object} runRecord - Database run record with step_details and metadata
 * @returns {ExcelJS.Workbook}
 */
async function generateSequenceCertificateWorkbook(runRecord) {
	const workbook = new ExcelJS.Workbook();
	workbook.creator = "AICS MPCS Testbench Dashboard";
	workbook.created = new Date();

	const metadata = runRecord.metadata || {};
	const steps = runRecord.step_details || [];
	const isPass = runRecord.status === "PASS";

	// ----------------------------------------------------
	// Sheet 1: Certificate & Provenance Summary
	// ----------------------------------------------------
	const certSheet = workbook.addWorksheet("Certificate", {
		views: [{ showGridLines: true }],
	});

	// Col widths
	certSheet.columns = [
		{ width: 28 }, // Col A: Parameter
		{ width: 45 }, // Col B: Value
	];

	// Title Banner (Row 1, merged A1:B1)
	certSheet.mergeCells("A1:B1");
	const titleCell = certSheet.getCell("A1");
	titleCell.value = "MPCS TESTBENCH - AUTOMATED TEST CERTIFICATE";
	titleCell.font = {
		name: "Calibri",
		size: 14,
		bold: true,
		color: { argb: "FFFFFFFF" },
	};
	titleCell.fill = {
		type: "pattern",
		pattern: "solid",
		fgColor: { argb: "FF0B2545" }, // Navy
	};
	titleCell.alignment = { horizontal: "center", vertical: "middle" };
	certSheet.getRow(1).height = 32;

	// Rows 2..11: Key-Value Provenance
	const certData = [
		["Locomotive Model", "Standard Electric Locomotive"],
		[
			"MPCS Serial Number",
			metadata.mpcs_serial_number || "MPCS-TESTBENCH",
		],
		["Locomotive (LOCO) Number", metadata.loco_number || "LOCO-23145"],
		["Tested By (Technician)", metadata.tested_by || "Testbench Operator"],
		["Tester ID", metadata.tester_id || "TECH-01"],
		["Test Recipe Name", runRecord.sequence_name || runRecord.sequence_id],
		["Test Sequence ID", runRecord.sequence_id],
		["Test Classification", (runRecord.test_type || "positive").toUpperCase()],
		[
			"Test Start Time",
			runRecord.started_at
				? runRecord.started_at.replace("T", " ").substring(0, 19)
				: "N/A",
		],
		[
			"Test Execution Duration",
			`${((runRecord.duration_ms || 0) / 1000).toFixed(1)} seconds`,
		],
		["Overall Test Verdict", runRecord.status],
	];

	certData.forEach(([label, val], idx) => {
		const rowNum = idx + 2;
		const row = certSheet.getRow(rowNum);
		row.height = 20;

		const cellA = certSheet.getCell(`A${rowNum}`);
		cellA.value = label;
		cellA.font = {
			name: "Calibri",
			size: 11,
			bold: true,
			color: { argb: "FF334155" },
		};
		cellA.fill = {
			type: "pattern",
			pattern: "solid",
			fgColor: { argb: "FFF8FAFC" },
		};
		cellA.border = {
			top: { style: "thin", color: { argb: "FFE2E8F0" } },
			bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
			left: { style: "thin", color: { argb: "FFE2E8F0" } },
			right: { style: "thin", color: { argb: "FFE2E8F0" } },
		};

		const cellB = certSheet.getCell(`B${rowNum}`);
		cellB.value = val;
		cellB.font = { name: "Calibri", size: 11, color: { argb: "FF0F172A" } };
		cellB.border = {
			top: { style: "thin", color: { argb: "FFE2E8F0" } },
			bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
			left: { style: "thin", color: { argb: "FFE2E8F0" } },
			right: { style: "thin", color: { argb: "FFE2E8F0" } },
		};

		// Status highlight
		if (label === "Overall Test Verdict") {
			cellB.font = {
				name: "Calibri",
				size: 12,
				bold: true,
				color: { argb: isPass ? "FF047857" : "FFB91C1C" },
			};
			cellB.fill = {
				type: "pattern",
				pattern: "solid",
				fgColor: { argb: isPass ? "FFECFDF5" : "FFFEE2E2" },
			};
		}
	});

	// Standard footer in certificate
	certSheet.getRow(14).height = 18;
	certSheet.mergeCells("A14:B14");
	const footerCell = certSheet.getCell("A14");
	footerCell.value = "Generated using: www.aics.co.in MPCS Testbench Dashboard";
	footerCell.font = {
		name: "Calibri",
		size: 9,
		italic: true,
		color: { argb: "FF64748B" },
	};
	footerCell.alignment = { horizontal: "center", vertical: "middle" };

	await certSheet.protect("aics_readonly", {
		selectLockedCells: true,
		selectUnlockedCells: true,
	});

	// ----------------------------------------------------
	// Sheet 2: Step-by-Step Audit Trail
	// ----------------------------------------------------
	const auditSheet = workbook.addWorksheet("Step Details", {
		views: [{ state: "frozen", ySplit: 1, showGridLines: true }],
	});

	auditSheet.columns = [
		{ header: "Step #", key: "index", width: 10 },
		{ header: "Step Name / Description", key: "name", width: 48 },
		{ header: "Duration (ms)", key: "duration", width: 16 },
		{ header: "Verdict", key: "status", width: 14 },
		{ header: "Diagnostic Error / Notes", key: "error", width: 45 },
	];

	// Header row style
	const headerRow = auditSheet.getRow(1);
	headerRow.height = 26;
	headerRow.eachCell((cell) => {
		cell.font = {
			name: "Calibri",
			size: 11,
			bold: true,
			color: { argb: "FFFFFFFF" },
		};
		cell.fill = {
			type: "pattern",
			pattern: "solid",
			fgColor: { argb: "FF1E293B" },
		};
		cell.alignment = { vertical: "middle", horizontal: "center" };
	});

	steps.forEach((st, idx) => {
		const stepPass = st.status === "PASS";
		const row = auditSheet.addRow({
			index: idx + 1,
			name: st.name || `Step ${idx + 1}`,
			duration: st.durationMs != null ? st.durationMs : "-",
			status: st.status || "UNKNOWN",
			error: st.error || "",
		});

		row.height = 20;

		const statusCell = row.getCell("status");
		statusCell.alignment = { horizontal: "center", vertical: "middle" };
		statusCell.font = {
			name: "Calibri",
			size: 11,
			bold: true,
			color: { argb: stepPass ? "FF047857" : "FFB91C1C" },
		};
		statusCell.fill = {
			type: "pattern",
			pattern: "solid",
			fgColor: { argb: stepPass ? "FFECFDF5" : "FFFEE2E2" },
		};

		row.getCell("duration").alignment = {
			horizontal: "center",
			vertical: "middle",
		};
	});

	auditSheet.autoFilter = {
		from: { row: 1, column: 1 },
		to: { row: steps.length + 1, column: 5 },
	};

	await auditSheet.protect("aics_readonly", {
		selectLockedCells: true,
		selectUnlockedCells: true,
	});

	return workbook;
}

module.exports = {
	generateSequenceCertificateWorkbook,
};
