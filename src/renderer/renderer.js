// This file is required by the index.html file and will
// be executed in the renderer process for that window.
// No Node.js APIs are available in this process because
// `nodeIntegration` is turned off. Use `window.api` instead.

const manual_dashboard_max_elements_horz = 15;

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
	const canvasContainer = document.getElementById("canvas-container");

	let isDragging = false;
	let currentWidget = null;
	let offsetX = 0, offsetY = 0;

	// Drag events
	canvasContainer.addEventListener("mousedown", (e) => {
		const widget = e.target.closest('.canvas-widget');
		if (widget && !e.target.closest('button') && !e.target.closest('input')) {
			isDragging = true;
			currentWidget = widget;
			offsetX = e.clientX - widget.offsetLeft;
			offsetY = e.clientY - widget.offsetTop;
		}
	});

	document.addEventListener("mousemove", (e) => {
		if (isDragging && currentWidget) {
			let newX = e.clientX - offsetX;
			let newY = e.clientY - offsetY;
			
			// Constrain to canvas
			newX = Math.max(0, Math.min(newX, canvasContainer.clientWidth - currentWidget.offsetWidth));
			newY = Math.max(0, Math.min(newY, canvasContainer.clientHeight - currentWidget.offsetHeight));

			currentWidget.style.left = newX + "px";
			currentWidget.style.top = newY + "px";
		}
	});

	document.addEventListener("mouseup", async () => {
		if (isDragging && currentWidget) {
			const sigId = currentWidget.dataset.id;
			const x = parseInt(currentWidget.style.left, 10) || 0;
			const y = parseInt(currentWidget.style.top, 10) || 0;
			
			// Save layout
			await window.api.saveLayoutPosition({ signal_id: parseInt(sigId, 10), pos_x: x, pos_y: y });
		}
		isDragging = false;
		currentWidget = null;
	});

	window.renderManualDashboard = async () => {
		const signals = await window.api.getMappedSignals();
		const layout = await window.api.getLayout();

		canvasContainer.innerHTML = "";
		
		let manual_dashboard_max_elements_horz = Math.floor(canvasContainer.clientWidth / 90) || 10;
		if (manual_dashboard_max_elements_horz < 1) manual_dashboard_max_elements_horz = 1;

		for (let i = 0; i < signals.length; i++) {
			const signal = signals[i];
			
			let pos = layout.find(l => l.signal_id === signal.id);
			if (pos && !(pos.pos_x === 10 && pos.pos_y === 10) && !(pos.pos_x === 0 && pos.pos_y === 0)) {
				// Use database position
			} else {
				pos = { pos_x: 10 + (i % manual_dashboard_max_elements_horz) * 105, pos_y: 10 + parseInt(i / manual_dashboard_max_elements_horz) * 75 };
			}

			const div = document.createElement("div");
			div.className = "canvas-widget";
			div.dataset.id = signal.id;
			div.style.left = pos.pos_x + "px";
			div.style.top = pos.pos_y + "px";

			const label = document.createElement("div");
			label.className = "widget-label";
			label.textContent = signal.label;
			div.appendChild(label);

			// SVG Sprites / HTML based on type
			if (signal.type === "analog-in") {
				// Number Read
				const display = document.createElement("div");
				display.className = "number-display";
				display.id = `ui-val-${signal.id}`;
				display.textContent = "0.00";
				div.appendChild(display);
			} 
			else if (signal.type === "analog-out") {
				// Number Write
				const input = document.createElement("input");
				input.type = "number";
				input.className = "number-display";
				input.style.width = "100%";
				input.id = `ui-write-${signal.id}`;
				input.value = "0.00";
				
				const btn = document.createElement("button");
				btn.textContent = "SET";
				btn.style.marginTop = "2px";
				btn.style.fontSize = "10px";
				btn.style.padding = "1px 4px";
				btn.onclick = () => window.api.modbusPreemptWrite(signal.id, parseFloat(input.value));

				div.appendChild(input);
				div.appendChild(btn);
			}
			else if (signal.type === "digital-in") {
				// Digital Read (LED)
				const led = document.createElement("div");
				led.className = "svg-led led-off";
				led.id = `ui-val-${signal.id}`;
				div.appendChild(led);
			}
			else if (signal.type === "digital-out") {
				// Digital Write (Toggle)
				const toggle = document.createElement("input");
				toggle.type = "checkbox";
				toggle.style.transform = "scale(1.2)";
				toggle.style.margin = "5px";
				toggle.id = `ui-write-${signal.id}`;
				toggle.onchange = (e) => window.api.modbusPreemptWrite(signal.id, e.target.checked ? 1 : 0);
				div.appendChild(toggle);
			}

			canvasContainer.appendChild(div);
		}
	};
	renderManualDashboard();
	
	document.getElementById("btn-refresh-layout").addEventListener("click", renderManualDashboard);

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

	// --- Raw Registers Explorer Logic ---
	let currentRawDevIp = "";
	let currentRawDevPort = 0;

	window.selectDeviceForRaw = async (id, name, ip, port) => {
		document.getElementById("raw-dev-id").value = id;
		document.getElementById("raw-active-dev").textContent = `${name} (${ip}:${port})`;
		currentRawDevIp = ip;
		currentRawDevPort = port;
		await loadRawRegisters(id);
	};

	const loadRawRegisters = async (deviceId) => {
		const regs = await window.api.getDeviceRegisters(deviceId);
		const tbody = document.getElementById("raw-reg-list");
		tbody.innerHTML = "";
		
		regs.forEach(r => {
			const tr = document.createElement("tr");
			tr.innerHTML = `
				<td>${r.type}</td>
				<td>${r.address}</td>
				<td>${r.description}</td>
				<td id="raw-val-${r.id}">--</td>
				<td>
					${(r.type === 'coil' || r.type === 'holding') ? `<input type="text" id="raw-input-${r.id}" style="width:50px" placeholder="val"/> <button onclick="writeRawRegister(${r.id}, '${r.type}', ${r.address})">W</button>` : 'ReadOnly'}
				</td>
				<td>
					<button onclick="readRawRegister(${r.id}, '${r.type}', ${r.address})">Read</button>
					<button onclick="editRawRegister(${r.id}, '${r.type}', ${r.address}, '${r.description}')">Edit</button>
					<button onclick="deleteRawRegister(${r.id})">Del</button>
				</td>
			`;
			tbody.appendChild(tr);
		});
	};

	window.readRawRegister = async (regId, type, address) => {
		if(!currentRawDevIp) return alert("Select device first");
		const res = await window.api.readRawRegister({
			deviceIp: currentRawDevIp, port: currentRawDevPort, address, type
		});
		if(res.success) {
			document.getElementById(`raw-val-${regId}`).textContent = res.value;
		} else {
			alert("Read Error: " + res.error);
		}
	};

	window.writeRawRegister = async (regId, type, address) => {
		if(!currentRawDevIp) return alert("Select device first");
		const valStr = document.getElementById(`raw-input-${regId}`).value;
		if(!valStr) return alert("Enter value to write");
		
		const res = await window.api.writeRegister({
			deviceIp: currentRawDevIp, port: currentRawDevPort, address, value: parseFloat(valStr), type
		});
		if(res.success) alert("Write successful");
		else alert("Write Error: " + res.error);
	};

	window.editRawRegister = (id, type, address, desc) => {
		document.getElementById("raw-reg-id").value = id;
		document.getElementById("raw-reg-type").value = type;
		document.getElementById("raw-reg-addr").value = address;
		document.getElementById("raw-reg-desc").value = desc;
	};

	window.deleteRawRegister = async (id) => {
		if(confirm("Delete register?")) {
			const devId = parseInt(document.getElementById("raw-dev-id").value, 10);
			await window.api.deleteDeviceRegister(id);
			if(devId) loadRawRegisters(devId);
		}
	};

	document.getElementById("btn-save-raw-reg").addEventListener("click", async () => {
		const devId = parseInt(document.getElementById("raw-dev-id").value, 10);
		if(!devId) return alert("Select a device from the left panel first.");

		const id = document.getElementById("raw-reg-id").value;
		const address = parseInt(document.getElementById("raw-reg-addr").value, 10);

		if (isNaN(address) || address < 0 || address > 9998) return alert("Protocol Address must be between 0 and 9998.");

		const reg = {
			device_id: devId,
			type: document.getElementById("raw-reg-type").value,
			address,
			description: document.getElementById("raw-reg-desc").value
		};

		let res = id ? await window.api.updateDeviceRegister({ ...reg, id }) : await window.api.addDeviceRegister(reg);
		
		if(res.success) {
			document.getElementById("btn-clear-raw-reg").click();
			loadRawRegisters(devId);
		} else {
			alert("Error saving: " + res.error);
		}
	});

	document.getElementById("btn-clear-raw-reg").addEventListener("click", () => {
		document.getElementById("raw-reg-id").value = "";
		document.getElementById("raw-reg-addr").value = "";
		document.getElementById("raw-reg-desc").value = "";
	});

	// --- Device Registry Logic ---
	const loadDevices = async () => {
		const devices = await window.api.getDevices();
		
		const tbody = document.getElementById("device-list");
		tbody.innerHTML = "";
		
		const ulRaw = document.getElementById("raw-dev-list");
		ulRaw.innerHTML = "";

		const sigDeviceSelect = document.getElementById("cal-sig-device");
		sigDeviceSelect.innerHTML = '<option value="">Select Device...</option>';

		devices.forEach((dev) => {
			// Main device table
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

			// Raw Registers Selection List
			const li = document.createElement("li");
			li.style.marginBottom = "8px";
			li.innerHTML = `
				${dev.display_name} 
				<button class="action-btn" onclick="selectDeviceForRaw(${dev.id}, '${dev.display_name}', '${dev.ip}', ${dev.port})">Select</button>
			`;
			ulRaw.appendChild(li);

			// Populate Signal Mapping Device Dropdown
			const opt = document.createElement("option");
			opt.value = dev.id;
			opt.textContent = `${dev.display_name} (${dev.ip})`;
			document.getElementById("cal-sig-device").appendChild(opt);
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

	document.getElementById("cal-sig-device").addEventListener("change", async (e) => {
		const devId = parseInt(e.target.value, 10);
		const readSelect = document.getElementById("cal-sig-read");
		const scaleSelect = document.getElementById("cal-sig-scale");
		const offsetSelect = document.getElementById("cal-sig-offset");
		const dzSelect = document.getElementById("cal-sig-deadzone");
		
		readSelect.innerHTML = '<option value="">Read Reg...</option>';
		scaleSelect.innerHTML = '<option value="">Scale Reg...</option>';
		offsetSelect.innerHTML = '<option value="">Offset Reg...</option>';
		dzSelect.innerHTML = '<option value="">Deadzone Reg...</option>';
		
		if (!devId) return;

		const regs = await window.api.getDeviceRegisters(devId);
		regs.forEach(r => {
			const optLabel = `${r.description} (${r.type} ${r.address})`;
			
			const opt1 = document.createElement("option"); opt1.value = r.address; opt1.textContent = optLabel;
			const opt2 = document.createElement("option"); opt2.value = r.address; opt2.textContent = optLabel;
			const opt3 = document.createElement("option"); opt3.value = r.address; opt3.textContent = optLabel;
			const opt4 = document.createElement("option"); opt4.value = r.address; opt4.textContent = optLabel;

			readSelect.appendChild(opt1);
			scaleSelect.appendChild(opt2);
			offsetSelect.appendChild(opt3);
			dzSelect.appendChild(opt4);
		});
	});

	// --- Calibration Logic ---

	let currentActiveSignal = null;
	
	const loadMappedSignalsForCal = async () => {
		const signals = await window.api.getMappedSignals();
		const tbodyMap = document.getElementById("signal-list");
		const tbodyCal = document.getElementById("cal-target-list");
		
		tbodyMap.innerHTML = "";
		tbodyCal.innerHTML = "";

		signals.forEach((sig) => {
			// Populate Signal Mapping Management Table
			const trMap = document.createElement("tr");
			trMap.innerHTML = `
				<td>${sig.label}</td>
				<td>${sig.type}</td>
				<td>${sig.ip || 'N/A'}:${sig.port || 'N/A'}</td>
				<td>${sig.encoding}</td>
				<td>R:${sig.read_register}, S:${sig.cal_scale_reg}, O:${sig.cal_offset_reg}, D:${sig.cal_deadzone_reg}</td>
				<td>
					<button onclick="editSignal(${sig.id}, '${sig.label}', '${sig.type}', ${sig.device_id}, ${sig.read_reg_id}, '${sig.encoding}', ${sig.cal_scale_reg_id}, ${sig.cal_offset_reg_id}, ${sig.cal_deadzone_reg_id})">Edit</button>
					<button onclick="deleteSignal(${sig.id})">Del</button>
				</td>
			`;
			tbodyMap.appendChild(trMap);

			// Populate Calibration Target Selection Table
			const trCal = document.createElement("tr");
			trCal.innerHTML = `
				<td>${sig.label}</td>
				<td>
					<button onclick="selectForCal(${sig.id}, '${sig.label}', '${sig.encoding}')" style="background:#007bff;color:white;">Select</button>
				</td>
			`;
			tbodyCal.appendChild(trCal);
		});
	};

	window.editSignal = async (id, label, type, deviceId, readReg, enc, scaleReg, offsetReg, dzReg) => {
		document.getElementById("cal-sig-id").value = id;
		document.getElementById("cal-sig-label").value = label;
		document.getElementById("cal-sig-type").value = type;
		
		const deviceSelect = document.getElementById("cal-sig-device");
		deviceSelect.value = deviceId;
		
		// Manually trigger the change event to populate the register dropdowns
		deviceSelect.dispatchEvent(new Event("change"));

		// Wait a tiny bit for the dropdowns to populate from SQLite
		await new Promise(r => setTimeout(r, 100));

		document.getElementById("cal-sig-read").value = readReg || "";
		document.getElementById("cal-sig-enc").value = enc || "ABCD";
		document.getElementById("cal-sig-scale").value = scaleReg || "";
		document.getElementById("cal-sig-offset").value = offsetReg || "";
		document.getElementById("cal-sig-deadzone").value = dzReg || "";
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
			device_id: parseInt(document.getElementById("cal-sig-device").value, 10),
			read_reg_id: read_register,
			encoding: document.getElementById("cal-sig-enc").value,
			cal_scale_reg_id: cal_scale_reg,
			cal_offset_reg_id: cal_offset_reg,
			cal_deadzone_reg_id: cal_deadzone_reg
		};

		if (isNaN(signal.device_id)) return alert("Please select a valid device.");

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
		document.getElementById("cal-sig-device").value = "";
		document.getElementById("cal-sig-read").innerHTML = '<option value="">Read Reg...</option>';
		document.getElementById("cal-sig-scale").innerHTML = '<option value="">Scale Reg...</option>';
		document.getElementById("cal-sig-offset").innerHTML = '<option value="">Offset Reg...</option>';
		document.getElementById("cal-sig-deadzone").innerHTML = '<option value="">Deadzone Reg...</option>';
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
