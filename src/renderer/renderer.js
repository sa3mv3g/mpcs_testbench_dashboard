// This file is required by the index.html file and will
// be executed in the renderer process for that window.
// No Node.js APIs are available in this process because
// `nodeIntegration` is turned off. Use `window.api` instead.

window.openTab = function (evt, tabName) {
	const tabcontent = document.getElementsByClassName("tab-content");
	for (let i = 0; i < tabcontent.length; i++) {
		tabcontent[i].style.display = "none";
	}

	const tablinks = document.getElementsByClassName("tablinks");
	for (let i = 0; i < tablinks.length; i++) {
		tablinks[i].className = tablinks[i].className.replace(" active", "");
	}

	document.getElementById(tabName).style.display = "block";
	evt.currentTarget.className += " active";
};

document.addEventListener("DOMContentLoaded", async () => {
	const controlsContainer = document.getElementById("controls-container");

	// --- 1. Manual Dashboard Logic ---
	const renderManualDashboard = async () => {
		const signals = await window.api.getMappedSignals();
		controlsContainer.innerHTML = "";
		
		signals.forEach((signal) => {
			const div = document.createElement("div");
			div.className = "control-group";

			const label = document.createElement("span");
			label.className = "control-label";
			label.textContent = signal.label;

			const valueDisplay = document.createElement("span");
			valueDisplay.id = `val-${signal.label}`;
			valueDisplay.textContent = "0.00"; 

			const readBtn = document.createElement("button");
			readBtn.textContent = "Read";
			readBtn.onclick = async () => {
				const result = await window.api.readRegisters({
					deviceIp: signal.ip,
					port: signal.port,
					startAddress: signal.read_register,
					length: 2,
				});
				if (result.success) {
					valueDisplay.textContent = "Updated..."; 
				}
			};

			div.appendChild(label);
			div.appendChild(valueDisplay);
			div.appendChild(readBtn);
			controlsContainer.appendChild(div);
		});
	};
	renderManualDashboard();

	document.getElementById("btn-snapshot").addEventListener("click", async () => {
		const res = await window.api.saveManualSnapshot({});
		if (res.success) alert("Snapshot saved!");
	});

	// --- Sequence Logic ---
	document.getElementById("btn-start-seq").addEventListener("click", async () => {
		document.getElementById("seq-status").textContent = "Running...";
		await window.api.startSequence(1);
	});

	document.getElementById("btn-stop-seq").addEventListener("click", async () => {
		document.getElementById("seq-status").textContent = "Idle";
		await window.api.stopSequence();
	});

	// --- Device Registry Logic ---
	const loadDevices = async () => {
		const devices = await window.api.getDevices();
		const tbody = document.getElementById("device-list");
		tbody.innerHTML = "";
		devices.forEach((dev) => {
			const tr = document.createElement("tr");
			tr.innerHTML = `
				<td>${dev.id}</td>
				<td>${dev.display_name}</td>
				<td>${dev.ip}</td>
				<td>${dev.port}</td>
				<td>
					<button class="action-btn" onclick="editDevice(${dev.id}, '${dev.display_name}', '${dev.ip}', ${dev.port}, ${dev.key1}, ${dev.key2})">Edit</button>
					<button class="action-btn" onclick="deleteDevice(${dev.id})">Delete</button>
				</td>
			`;
			tbody.appendChild(tr);
		});
	};

	window.editDevice = (id, name, ip, port, key1, key2) => {
		document.getElementById("dev-id").value = id;
		document.getElementById("dev-name").value = name;
		document.getElementById("dev-ip").value = ip;
		document.getElementById("dev-port").value = port;
		document.getElementById("dev-key1").value = key1 || "";
		document.getElementById("dev-key2").value = key2 || "";
		document.getElementById("device-registry").style.display = "block";
	};

	window.deleteDevice = async (id) => {
		if (confirm("Are you sure you want to delete this device?")) {
			const res = await window.api.deleteDevice(id);
			if (res.success) loadDevices();
			else alert("Error deleting device: " + res.error);
		}
	};

	document.getElementById("btn-save-device").addEventListener("click", async () => {
		const id = document.getElementById("dev-id").value;
		const name = document.getElementById("dev-name").value;
		const ip = document.getElementById("dev-ip").value;
		const port = parseInt(document.getElementById("dev-port").value, 10);
		const key1 = parseInt(document.getElementById("dev-key1").value, 10);
		const key2 = parseInt(document.getElementById("dev-key2").value, 10);

		if (!isNaN(key1) && (key1 < 0 || key1 > 9998)) return alert("Key 1 Address must be between 0 and 9998.");
		if (!isNaN(key2) && (key2 < 0 || key2 > 9998)) return alert("Key 2 Address must be between 0 and 9998.");

		const device = { display_name: name, ip, port, key1: isNaN(key1) ? null : key1, key2: isNaN(key2) ? null : key2 };

		let res = id ? await window.api.updateDevice({ ...device, id }) : await window.api.addDevice(device);
		if (res.success) {
			document.getElementById("btn-clear-form").click();
			loadDevices();
		} else {
			alert("Error saving device: " + res.error);
		}
	});

	document.getElementById("btn-clear-form").addEventListener("click", () => {
		document.getElementById("dev-id").value = "";
		document.getElementById("dev-name").value = "";
		document.getElementById("dev-ip").value = "";
		document.getElementById("dev-port").value = "502";
		document.getElementById("dev-key1").value = "";
		document.getElementById("dev-key2").value = "";
	});

	loadDevices();


	// --- Calibration Logic ---

	let currentActiveSignal = null;
	
	const loadMappedSignalsForCal = async () => {
		const signals = await window.api.getMappedSignals();
		const tbody = document.getElementById("signal-list");
		tbody.innerHTML = "";
		signals.forEach((sig) => {
			const tr = document.createElement("tr");
			tr.innerHTML = `
				<td>${sig.label}</td>
				<td>${sig.ip}:${sig.port}</td>
				<td>${sig.encoding}</td>
				<td>S:${sig.cal_scale_reg}, O:${sig.cal_offset_reg}, D:${sig.cal_deadzone_reg}</td>
				<td>
					<button onclick="editSignal(${sig.id}, '${sig.label}', '${sig.type}', '${sig.ip}', ${sig.port}, ${sig.read_register}, '${sig.encoding}', ${sig.cal_scale_reg}, ${sig.cal_offset_reg}, ${sig.cal_deadzone_reg})">Edit</button>
					<button onclick="deleteSignal(${sig.id})">Del</button>
					<button onclick="selectForCal(${sig.id}, '${sig.label}', '${sig.encoding}')" style="background:#007bff;color:white;">Select</button>
				</td>
			`;
			tbody.appendChild(tr);
		});
	};

	window.editSignal = (id, label, type, ip, port, readReg, enc, scaleReg, offsetReg, dzReg) => {
		document.getElementById("cal-sig-id").value = id;
		document.getElementById("cal-sig-label").value = label;
		document.getElementById("cal-sig-type").value = type;
		document.getElementById("cal-sig-ip").value = ip;
		document.getElementById("cal-sig-port").value = port;
		document.getElementById("cal-sig-read").value = readReg;
		document.getElementById("cal-sig-enc").value = enc;
		document.getElementById("cal-sig-scale").value = scaleReg;
		document.getElementById("cal-sig-offset").value = offsetReg;
		document.getElementById("cal-sig-deadzone").value = dzReg;
	};

	window.deleteSignal = async (id) => {
		if(confirm("Delete signal?")) {
			const res = await window.api.deleteMappedSignal(id);
			if(res.success) {
				loadMappedSignalsForCal();
				renderManualDashboard();
			}
		}
	};

	window.selectForCal = (id, label, encoding) => {
		currentActiveSignal = { id, label, encoding };
		document.getElementById("active-cal-target").textContent = `${label} (${encoding})`;
		loadCalibrationHistoryForSignal(label);
	};

	document.getElementById("btn-save-signal").addEventListener("click", async () => {
		const id = document.getElementById("cal-sig-id").value;
		
		const read_register = parseInt(document.getElementById("cal-sig-read").value, 10);
		const cal_scale_reg = parseInt(document.getElementById("cal-sig-scale").value, 10);
		const cal_offset_reg = parseInt(document.getElementById("cal-sig-offset").value, 10);
		const cal_deadzone_reg = parseInt(document.getElementById("cal-sig-deadzone").value, 10);

		if (isNaN(read_register) || read_register < 0 || read_register > 9998) return alert("Read Register must be between 0 and 9998.");
		if (isNaN(cal_scale_reg) || cal_scale_reg < 0 || cal_scale_reg > 9998) return alert("Scale Register must be between 0 and 9998.");
		if (isNaN(cal_offset_reg) || cal_offset_reg < 0 || cal_offset_reg > 9998) return alert("Offset Register must be between 0 and 9998.");
		if (isNaN(cal_deadzone_reg) || cal_deadzone_reg < 0 || cal_deadzone_reg > 9998) return alert("Deadzone Register must be between 0 and 9998.");

		const signal = {
			label: document.getElementById("cal-sig-label").value,
			type: document.getElementById("cal-sig-type").value,
			ip: document.getElementById("cal-sig-ip").value,
			port: parseInt(document.getElementById("cal-sig-port").value, 10),
			read_register,
			encoding: document.getElementById("cal-sig-enc").value,
			cal_scale_reg,
			cal_offset_reg,
			cal_deadzone_reg
		};

		let res = id ? await window.api.updateMappedSignal({...signal, id}) : await window.api.addMappedSignal(signal);
		if(res.success) {
			document.getElementById("btn-clear-signal").click();
			loadMappedSignalsForCal();
			renderManualDashboard();
		} else {
			alert("Error: " + res.error);
		}
	});

	document.getElementById("btn-clear-signal").addEventListener("click", () => {
		document.getElementById("cal-sig-id").value = "";
		document.getElementById("cal-sig-label").value = "";
		document.getElementById("cal-sig-ip").value = "";
		document.getElementById("cal-sig-port").value = "502";
		document.getElementById("cal-sig-read").value = "";
		document.getElementById("cal-sig-scale").value = "";
		document.getElementById("cal-sig-offset").value = "";
		document.getElementById("cal-sig-deadzone").value = "";
	});

	// --- Calibration Process Data Points ---
	const ptsContainer = document.getElementById("data-points-container");
	let pointsCount = 0;

	const addPointRow = (xVal = "", yVal = "") => {
		const div = document.createElement("div");
		div.style.marginBottom = "5px";
		div.innerHTML = `
			<input type="number" step="any" class="pt-x" placeholder="Expected (X)" value="${xVal}" style="width: 100px;">
			<input type="number" step="any" class="pt-y" placeholder="Actual (Y)" value="${yVal}" style="width: 100px;">
			<button onclick="this.parentElement.remove()">X</button>
		`;
		ptsContainer.appendChild(div);
		pointsCount++;
	};

	document.getElementById("btn-add-point").addEventListener("click", () => addPointRow());
	addPointRow(); addPointRow(); // Init 2 points

	document.getElementById("btn-cal-calculate").addEventListener("click", () => {
		const xs = Array.from(document.getElementsByClassName("pt-x")).map(i => parseFloat(i.value));
		const ys = Array.from(document.getElementsByClassName("pt-y")).map(i => parseFloat(i.value));
		
		if(xs.length < 2 || xs.some(isNaN) || ys.some(isNaN)) {
			alert("Need at least 2 valid data points.");
			return;
		}

		// Linear Regression y = mx + c
		let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
		const n = xs.length;
		for(let i = 0; i < n; i++) {
			sumX += xs[i]; sumY += ys[i];
			sumXY += xs[i]*ys[i]; sumX2 += xs[i]*xs[i];
		}
		
		const m = (n*sumXY - sumX*sumY) / (n*sumX2 - sumX*sumX);
		const c = (sumY - m*sumX) / n;

		document.getElementById("cal-calc-m").value = m.toFixed(4);
		document.getElementById("cal-calc-c").value = c.toFixed(4);
	});

	document.getElementById("btn-cal-zero").addEventListener("click", async () => {
		if(!currentActiveSignal) return alert("Select a signal first.");
		const res = await window.api.performCalibration({
			label: currentActiveSignal.label,
			scale: 1.0, offset: 0.0, deadzone: 0.0
		});
		if(res.success) alert("Device Zeroed!");
	});

	document.getElementById("btn-cal-program").addEventListener("click", async () => {
		if(!currentActiveSignal) return alert("Select a signal first.");
		
		const m = parseFloat(document.getElementById("cal-calc-m").value);
		const c = parseFloat(document.getElementById("cal-calc-c").value);
		const dz = parseFloat(document.getElementById("cal-input-dz").value);

		if(isNaN(m) || isNaN(c) || isNaN(dz)) return alert("Invalid m, c, or deadzone values.");

		const xs = Array.from(document.getElementsByClassName("pt-x")).map(i => parseFloat(i.value));
		const ys = Array.from(document.getElementsByClassName("pt-y")).map(i => parseFloat(i.value));
		const dataPoints = xs.map((x, i) => ({ expected: x, actual: ys[i] }));

		// 1. Program
		const res = await window.api.performCalibration({
			label: currentActiveSignal.label,
			scale: m, offset: c, deadzone: dz
		});

		if(res.success) {
			alert("Successfully programmed and handshaked!");
			// 2. Audit Log
			await window.api.saveCalibrationHistory({
				signal_label: currentActiveSignal.label,
				m_value: m, c_value: c, deadzone: dz,
				data_points: dataPoints
			});
			loadCalibrationHistoryForSignal(currentActiveSignal.label);
		} else {
			alert("Error programming: " + res.error);
		}
	});

	// --- Calibration History ---
	const loadCalibrationHistoryForSignal = async (label) => {
		const history = await window.api.getCalibrationHistory(label);
		const ul = document.getElementById("cal-history-list");
		ul.innerHTML = "";
		history.forEach(h => {
			const li = document.createElement("li");
			li.style.marginBottom = "8px";
			li.style.cursor = "pointer";
			li.style.color = "blue";
			li.textContent = `[${h.timestamp}] m:${h.m_value.toFixed(4)}, c:${h.c_value.toFixed(4)}, dz:${h.deadzone.toFixed(4)}`;
			li.onclick = () => {
				document.getElementById("cal-calc-m").value = h.m_value;
				document.getElementById("cal-calc-c").value = h.c_value;
				document.getElementById("cal-input-dz").value = h.deadzone;
				// Load points
				ptsContainer.innerHTML = "";
				if(h.data_points && Array.isArray(h.data_points)) {
					h.data_points.forEach(pt => addPointRow(pt.expected, pt.actual));
				}
			};
			ul.appendChild(li);
		});
	};

	// Init Dashboard
	loadMappedSignalsForCal();
});
