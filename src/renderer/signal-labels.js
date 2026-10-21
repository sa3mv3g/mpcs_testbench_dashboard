/**
 * MPCS Testbench Signal Labels Dictionary & Resolver
 * Provides dual human-readable label support for Version 2 (V2) and Version 3 (V3).
 *
 * In V3, labels reflect the modern MPCS V3 hardware ferrule & legend mappings.
 * In V2, labels reflect the MBFDS (RDSO ELRS/SPEC/MPC-FDS/001 Rev 2) specification.
 * If a signal has no V2 definition or is empty/missing, resolveSignalLabel falls back to (I-XX) or (O-XX).
 */

const SIGNAL_LABELS = {
	"I-00": {
		v3: "BP1DJ / BLDJ",
		v2: "BP1DJ / BLDJ",
	},
	"I-01": {
		v3: "BP2DJ / BLRDJ",
		v2: "BP2DJ / BLRDJ",
	},
	"I-02": {
		v3: "QVTM1",
		v2: "QVTM1",
	},
	"I-03": {
		v3: "QVTM2",
		v2: "QVTM2",
	},
	"I-04": {
		v3: "QVRH",
		v2: "QVRH",
	},
	"I-05": {
		v3: "ZPT1_2",
		v2: "ZPT1_2",
	},
	"I-06": {
		v3: "ZPT2_1",
		v2: "ZPT2_1",
	},
	"I-07": {
		v3: "HVMT1_1",
		v2: "HVMT1_1",
	},
	"I-08": {
		v3: "HVMT1_2",
		v2: "HVMT1_2",
	},
	"I-09": {
		v3: "HVMT2_1",
		v2: "HVMT2_1",
	},
	"I-10": {
		v3: "HVMT2_2",
		v2: "HVMT2_2",
	},
	"I-11": {
		v3: "HVRH_1",
		v2: "HVRH_1",
	},
	"I-12": {
		v3: "HVRH_2",
		v2: "HVRH_2",
	},
	"I-13": {
		v3: "QVSI1 / HVSI1",
		v2: "QVSI1 / HVSI1",
	},
	"I-14": {
		v3: "QVSI2 / HVSI2",
		v2: "QVSI2 / HVSI2",
	},
	"I-15": {
		v3: "BLVMT",
		v2: "BLVMT",
	},
	"I-16": {
		v3: "ASMGR (BN)",
		v2: "ASMGR (BN)",
	},
	"I-17": {
		v3: "BLCP/ BLCPD",
		v2: "BLCP/ BLCPD",
	},
	"I-18": {
		v3: "C101_3FB",
		v2: "C101_3FB",
	},
	"I-19": {
		v3: "GR-0",
		v2: "GR-0",
	},
	"I-20": {
		v3: "GR-0_31",
		v2: "GR-0_31",
	},
	"I-21": {
		v3: "QPH/HPH",
		v2: "QPH/HPH",
	},
	"I-22": {
		v3: "QVSL1/ HVSL1",
		v2: "QVSL1/ HVSL1",
	},
	"I-23": {
		v3: "C105_FB",
		v2: "C105_FB",
	},
	"I-24": {
		v3: "ASMGR (ON)",
		v2: "ASMGR (ON)",
	},
	"I-25": {
		v3: "QVSL2/ HVSL2",
		v2: "QVSL2/ HVSL2",
	},
	"I-26": {
		v3: "MP + (R,B)",
		v2: "MP + (R,B)",
	},
	"I-27": {
		v3: "MPJ (FOR)",
		v2: "MPJ (FOR)",
	},
	"I-28": {
		v3: "J1, J2 (FOR)",
		v2: "J1, J2 (FOR)",
	},
	"I-29": {
		v3: "MP-(R,B)",
		v2: "MP-(R,B)",
	},
	"I-30": {
		v3: "MP (+,N,-) R",
		v2: "MP (+,N,-) R",
	},
	"I-31": {
		v3: "CTF (RUN)",
		v2: "CTF (RUN)",
	},
	"I-32": {
		v3: "MPJ (REV)",
		v2: "MPJ (REV)",
	},
	"I-33": {
		v3: "CTF (BRK)",
		v2: "CTF (BRK)",
	},
	"I-34": {
		v3: "MP (+,N,-) B",
		v2: "MP (+,N,-) B",
	},
	"I-35": {
		v3: "DJ_FB",
		v2: "DJ_FB",
	},
	"I-36": {
		v3: "J1, J2 (REV)",
		v2: "J1, J2 (REV)",
	},
	"I-37": {
		v3: "ZQWC",
		v2: "ZQWC",
	},
	"I-38": {
		v3: "MPS (1-4)",
		v2: "MPS (1-4)",
	},
	"I-39": {
		v3: "MPS (2-4)",
		v2: "MPS (2-4)",
	},
	"I-40": {
		v3: "MPS (3-4)",
		v2: "MPS (3-4)",
	},
	"I-41": {
		v3: "MPS4",
		v2: "MPS4",
	},
	"I-42": {
		v3: "PVEF",
		v2: "PVEF",
	},
	"I-43": {
		v3: "PSA",
		v2: "PSA",
	},
	"I-44": {
		v3: "BPQD",
		v2: "BPQD",
	},
	"I-45": {
		v3: "RGEB",
		v2: "RGEB",
	},
	"I-46": {
		v3: "SWC",
		v2: "SWC",
	},
	"I-47": {
		v3: "QF & QE",
		v2: "QF & QE",
	},
	"I-48": {
		v3: "BL",
		v2: "BL",
	},
	"I-49": {
		v3: "QOA/ QSIT",
		v2: "QOA/ QSIT",
	},
	"I-50": {
		v3: "QOP1",
		v2: "QOP1",
	},
	"I-51": {
		v3: "QOP2",
		v2: "QOP2",
	},
	"I-52": {
		v3: "QRSI1",
		v2: "QRSI1",
	},
	"I-53": {
		v3: "QRSI2",
		v2: "QRSI2",
	},
	"I-54": {
		v3: "QLM",
		v2: "QLM",
	},
	"I-55": {
		v3: "BV",
		v2: "BV",
	},
	"I-56": {
		v3: "C106_FB",
		v2: "C106_FB",
	},
	"I-57": {
		v3: "ZSMGR",
		v2: "ZSMGR",
	},
	"I-58": {
		v3: "ZSMS",
		v2: "ZSMS",
	},
	"I-59": {
		v3: "RSI",
		v2: "RSI",
	},
	"I-60": {
		v3: "HMCS",
		v2: "HMCS",
	},
	"I-61": {
		v3: "L1 TO L6_FB",
		v2: "L1 TO L6_FB",
	},
	"I-62": {
		v3: "HMCS & QD",
		v2: "HMCS & QD",
	},
	"I-63": {
		v3: "C118N/C/QCON",
		v2: "C118N/C/QCON",
	},
	"I-64": {
		v3: "QLA_FB/SI <br>INT FAULT",
		v2: "QLA_FB/SI INT FAULT",
	},
	"I-65": {
		v3: "QPDJ_FB",
		v2: "QPDJ_FB",
	},
	"I-66": {
		v3: "C107_FB",
		v2: "C107_FB",
	},
	"I-67": {
		v3: "SI EXT FAULT",
		v2: "SI EXT FAULT",
	},
	"I-68": {
		v3: "C 145 N/O",
		v2: "C 145 N/O",
	},
	"I-69": {
		v3: "LSGRP_O",
		v2: "",
	},
	"I-70": {
		v3: "HQ51",
		v2: "HQ51",
	},
	"I-71": {
		v3: "CHBA",
		v2: "CHBA",
	},
	"I-72": {
		v3: "BL1",
		v2: "BL1",
	},
	"I-73": {
		v3: "SWITI/ DBR",
		v2: "SWITI/ DBR",
	},
	"I-74": {
		v3: "LSGRP_5",
		v2: "",
	},
	"I-75": {
		v3: "RGAF (ACP)",
		v2: "RGAF (ACP)",
	},
	"I-76": {
		v3: "P2",
		v2: "P2",
	},
	"I-77": {
		v3: "BPT",
		v2: "BPT",
	},
	"I-78": {
		v3: "RGPA/P1 (ACP)",
		v2: "RGPA/P1 (ACP)",
	},
	"I-79": {
		v3: "BPSW1/2/ACK (ACP)",
		v2: "BPSW1/2/ACK (ACP)",
	},
	"I-80": {
		v3: "LOCO SEL 1",
		v2: "LOCO SEL 1",
	},
	"I-81": {
		v3: "LOCO SEL 2",
		v2: "LOCO SEL 2",
	},
	"I-82": {
		v3: "LOCO SEL 3",
		v2: "LOCO SEL 3",
	},
	"I-83": {
		v3: "LOCO SEL 4",
		v2: "LOCO SEL 4",
	},
	"I-84": {
		v3: "Q51_FB",
		v2: "MU_FB",
	},
	"I-85": {
		v3: "ES_DJ",
		v2: "ES_DJ",
	},
	"I-86": {
		v3: "VCD_ACK",
		v2: "",
	},
	"I-87": {
		v3: "VCD_BP",
		v2: "",
	},
	"I-88": {
		v3: "VCD_RST",
		v2: "",
	},
	"I-89": {
		v3: "CCPT",
		v2: "",
	},
	"I-90": {
		v3: "LSGR_R1",
		v2: "",
	},
	"I-91": {
		v3: "LSGR_R2",
		v2: "",
	},
	"I-92": {
		v3: "Q49_FB",
		v2: "",
	},
	"I-93": {
		v3: "BL_MU",
		v2: "",
	},
	"I-94": {
		v3: "HMCS-2_1",
		v2: "",
	},
	"I-95": {
		v3: "HMCS-2_1,4",
		v2: "",
	},
	"I-96": {
		v3: "BL2",
		v2: "QVSI1/ HVSI1",
	},
	"I-97": {
		v3: "QOA/QSIT",
		v2: "QPH/HPH",
	},
	"I-98": {
		v3: "QOP1",
		v2: "QVSL1/HVSL1",
	},
	"I-99": {
		v3: "QOP2",
		v2: "QVSL2/HVSL2",
	},
	"I-100": {
		v3: "QRSI1",
		v2: "QOA/ QSIT",
	},
	"I-101": {
		v3: "QRSI2",
		v2: "QOP1",
	},
	"I-102": {
		v3: "QLM",
		v2: "QOP2",
	},
	"I-103": {
		v3: "QVSI1/HVSI1",
		v2: "QRSI1",
	},
	"I-104": {
		v3: "QVSI2/HVSI2",
		v2: "QRSI2",
	},
	"I-105": {
		v3: "QPH/HPH",
		v2: "QLM",
	},
	"I-106": {
		v3: "QVSL1/HVSL1",
		v2: "QLA",
	},
	"I-107": {
		v3: "QVSL2/HVSL2",
		v2: "C118N/C/QCON",
	},
	"I-108": {
		v3: "DJ_NO1",
		v2: "BL",
	},
	"I-109": {
		v3: "BLVMT",
		v2: "BLVMT",
	},
	"I-110": {
		v3: "BLCPD",
		v2: "BLCPD",
	},
	"I-111": {
		v3: "QCON/C118 N/C",
		v2: "QPDJ FB",
	},
	"I-112": {
		v3: "L2_FB",
		v2: "",
	},
	"I-113": {
		v3: "L3_FB",
		v2: "",
	},
	"I-114": {
		v3: "L4_FB",
		v2: "",
	},
	"I-115": {
		v3: "L5_FB",
		v2: "",
	},
	"I-116": {
		v3: "L6_FB",
		v2: "",
	},
	"I-117": {
		v3: "HCP_I-1",
		v2: "",
	},
	"I-118": {
		v3: "HCP_I-2",
		v2: "",
	},
	"I-119": {
		v3: "HCP_I-3",
		v2: "",
	},
	"I-120": {
		v3: "DJ_NO2",
		v2: "",
	},
	"I-121": {
		v3: "DJ_NC",
		v2: "",
	},
	"I-122": {
		v3: "C102_FB",
		v2: "",
	},
	"I-123": {
		v3: "C103_FB",
		v2: "HORN",
	},
	"I-124": {
		v3: "C108_FB",
		v2: "A9",
	},
	"I-125": {
		v3: "LOCO SEL 5",
		v2: "SA9",
	},
	"I-126": {
		v3: "NU",
		v2: "RESET",
	},
	"I-127": {
		v3: "NU",
		v2: "LOW SPEED",
	},
	"O-00": {
		v3: "DJ",
		v2: "DJ",
	},
	"O-01": {
		v3: "C118 BLSI",
		v2: "C118 BLSI",
	},
	"O-02": {
		v3: "VEPT1",
		v2: "VEPT1",
	},
	"O-03": {
		v3: "VEPT2",
		v2: "VEPT2",
	},
	"O-04": {
		v3: "DJ",
		v2: "DJ",
	},
	"O-05": {
		v3: "C107",
		v2: "C107",
	},
	"O-06": {
		v3: "C106",
		v2: "C106",
	},
	"O-07": {
		v3: "C105",
		v2: "C105",
	},
	"O-08": {
		v3: "C101, C103",
		v2: "C101, C103",
	},
	"O-09": {
		v3: "VEUL",
		v2: "VEUL",
	},
	"O-10": {
		v3: "J1, J2(FOR)",
		v2: "J1, J2(FOR)",
	},
	"O-11": {
		v3: "J1, J2 (REV)",
		v2: "J1, J2 (REV)",
	},
	"O-12": {
		v3: "CTF (RUN)",
		v2: "CTF (RUN)",
	},
	"O-13": {
		v3: "CTF (BRK)",
		v2: "CTF (BRK)",
	},
	"O-14": {
		v3: "VE (UP)",
		v2: "VE (UP)",
	},
	"O-15": {
		v3: "C 145",
		v2: "C 145",
	},
	"O-16": {
		v3: "VE (DN)",
		v2: "VE (DN)",
	},
	"O-17": {
		v3: "EVPHGH",
		v2: "EVPHGH",
	},
	"O-18": {
		v3: "SX 1",
		v2: "SX 1",
	},
	"O-19": {
		v3: "SX2",
		v2: "SX2",
	},
	"O-20": {
		v3: "SX31",
		v2: "SX31",
	},
	"O-21": {
		v3: "SX32",
		v2: "SX32",
	},
	"O-22": {
		v3: "IP",
		v2: "IP",
	},
	"O-23": {
		v3: "VESA2",
		v2: "VESA2",
	},
	"O-24": {
		v3: "VEF",
		v2: "VEF",
	},
	"O-25": {
		v3: "VESA1",
		v2: "VESA1",
	},
	"O-26": {
		v3: "L1, L2, L3",
		v2: "L1, L2, L3",
	},
	"O-27": {
		v3: "L4, L5, L6",
		v2: "L4, L5, L6",
	},
	"O-28": {
		v3: "LSDJ (R)",
		v2: "LSDJ (R)",
	},
	"O-29": {
		v3: "LSCHBA (G)",
		v2: "LSCHBA (G)",
	},
	"O-30": {
		v3: "LSGR (G)",
		v2: "LSGR (G)",
	},
	"O-31": {
		v3: "LSB (Y)",
		v2: "LSB (Y)",
	},
	"O-32": {
		v3: "LSP (R)",
		v2: "LSP (R)",
	},
	"O-33": {
		v3: "LSRSI (Y)",
		v2: "LSRSI (Y)",
	},
	"O-34": {
		v3: "SX 41",
		v2: "SX 41",
	},
	"O-35": {
		v3: "SX 42",
		v2: "SX 42",
	},
	"O-36": {
		v3: "LSGROUP (R)",
		v2: "LSGROUP (R)",
	},
	"O-37": {
		v3: "LSOL (Y)",
		v2: "LSOL (Y)",
	},
	"O-38": {
		v3: "LPAR (R)",
		v2: "LPAR (R)",
	},
	"O-39": {
		v3: "SON (ALARM)",
		v2: "SON (ALARM)",
	},
	"O-40": {
		v3: "Q49/MU",
		v2: "Q49/MU",
	},
	"O-41": {
		v3: "B1, B2 (CPA)",
		v2: "B1, B2 (CPA)",
	},
	"O-42": {
		v3: "LSDBR (Y)",
		v2: "LSDBR (Y)",
	},
	"O-43": {
		v3: "LSFL",
		v2: "LSFL",
	},
	"O-44": {
		v3: "QFL",
		v2: "QFL",
	},
	"O-45": {
		v3: "FL_LP",
		v2: "FL_LP",
	},
	"O-46": {
		v3: "C102",
		v2: "C102",
	},
	"O-47": {
		v3: "C108",
		v2: "C108",
	},
	"O-48": {
		v3: "DJ",
		v2: "DJ",
	},
	"O-49": {
		v3: "C118/BLSI",
		v2: "C118/BLSI",
	},
	"O-50": {
		v3: "VEPT 1",
		v2: "VEPT 1",
	},
	"O-51": {
		v3: "VEPT 2",
		v2: "VEPT 2",
	},
	"O-52": {
		v3: "DJ",
		v2: "DJ",
	},
	"O-53": {
		v3: "C 107",
		v2: "C 107",
	},
	"O-54": {
		v3: "C 106",
		v2: "C 106",
	},
	"O-55": {
		v3: "C 105",
		v2: "C 105",
	},
	"O-56": {
		v3: "C101, C 103",
		v2: "C101, C 103",
	},
	"O-57": {
		v3: "VE (DN)",
		v2: "VE (DN)",
	},
	"O-58": {
		v3: "J1, J2 (FOR)",
		v2: "J1, J2 (FOR)",
	},
	"O-59": {
		v3: "J1, J2 (REV)",
		v2: "J1, J2 (REV)",
	},
	"O-60": {
		v3: "CTF (RUN)",
		v2: "CTF (RUN)",
	},
	"O-61": {
		v3: "L1, L2, L3",
		v2: "L1, L2, L3",
	},
	"O-62": {
		v3: "VE_UP",
		v2: "VE_UP",
	},
	"O-63": {
		v3: "L4, L5, L6",
		v2: "L4, L5, L6",
	},
	"O-64": {
		v3: "",
		v2: "",
	},
	"O-65": {
		v3: "",
		v2: "",
	},
	"O-66": {
		v3: "",
		v2: "",
	},
	"O-67": {
		v3: "",
		v2: "",
	},
	"O-68": {
		v3: "",
		v2: "",
	},
	"O-69": {
		v3: "",
		v2: "",
	},
	"O-70": {
		v3: "",
		v2: "",
	},
	"O-71": {
		v3: "",
		v2: "",
	},
	"O-72": {
		v3: "",
		v2: "",
	},
	"O-73": {
		v3: "",
		v2: "",
	},
	"O-74": {
		v3: "",
		v2: "",
	},
	"O-75": {
		v3: "WORKING",
		v2: "WORKING",
	},
	"O-76": {
		v3: "FAULT",
		v2: "FAULT",
	},
	"O-77": {
		v3: "EM VALVE",
		v2: "EM VALVE",
	},
	"O-78": {
		v3: "BUZZER",
		v2: "BUZZER",
	},
	"O-79": {
		v3: "WARNING",
		v2: "WARNING",
	},
	"1 EN": {
		v3: "1 EN",
		v2: "1 EN",
	},
	"AO-CH-1": {
		v3: "110VAC (AO-CH-1)",
		v2: "110VAC (AO-CH-1)",
	},
	"AO-CH-2": {
		v3: "5A AC (AO-CH-2)",
		v2: "5A AC (AO-CH-2)",
	},
	"AO-CH-3": {
		v3: "4-20mA (AO-CH-3)",
		v2: "4-20mA (AO-CH-3)",
	},
	"AO-CH-4": {
		v3: "0-10V (AO-CH-4)",
		v2: "0-10V (AO-CH-4)",
	},
	"AI-CH-1": {
		v3: "110VAC (AI-CH-1)",
		v2: "110VAC (AI-CH-1)",
	},
	"AI-CH-2": {
		v3: "110VAC (AI-CH-2)",
		v2: "110VAC (AI-CH-2)",
	},
	"AI-CH-3": {
		v3: "5A AC (AI-CH-3)",
		v2: "5A AC (AI-CH-3)",
	},
	"AI-CH-4": {
		v3: "5A AC (AI-CH-4)",
		v2: "5A AC (AI-CH-4)",
	},
	"AI-CH-5": {
		v3: "0-10V (AI-CH-5)",
		v2: "0-10V (AI-CH-5)",
	},
	"AI-CH-6": {
		v3: "0-10V (AI-CH-6)",
		v2: "0-10V (AI-CH-6)",
	},
	"AI-CH-7": {
		v3: "4-20mA (AI-CH-7)",
		v2: "4-20mA (AI-CH-7)",
	},
	"AI-CH-8": {
		v3: "4-20mA (AI-CH-8)",
		v2: "4-20mA (AI-CH-8)",
	},
};

/**
 * Resolves the display HTML for a given signal according to the requested version.
 * @param {string} signalId - The canonical signal ID (e.g. 'I-00', 'O-05', etc.)
 * @param {string} [version='v3'] - 'v2' or 'v3' (defaults to 'v3')
 * @returns {string} Formatted HTML label string
 */
function resolveSignalLabel(signalId, version = "v3") {
	if (!signalId) return "";
	const normVersion = String(version).toLowerCase() === "v2" ? "v2" : "v3";
	const entry = SIGNAL_LABELS[signalId];

	const isDigital = signalId.startsWith("I-") || signalId.startsWith("O-");

	if (!entry) {
		return isDigital ? `(${signalId})` : signalId;
	}

	const text = entry[normVersion];
	if (text && text.trim().length > 0) {
		return isDigital ? `(${signalId})<br><b>${text}</b>` : text;
	}

	// Fallback: If missing/empty in V2 (or V3), fall back to canonical ID
	return isDigital ? `(${signalId})` : entry.v3 || signalId;
}

// Browser & CommonJS export bindings
if (typeof window !== "undefined") {
	window.SIGNAL_LABELS = SIGNAL_LABELS;
	window.resolveSignalLabel = resolveSignalLabel;
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		SIGNAL_LABELS,
		resolveSignalLabel,
	};
}
