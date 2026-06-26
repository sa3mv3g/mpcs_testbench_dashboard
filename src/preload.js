const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
	// Modbus API
	connectAllDevices: () => ipcRenderer.invoke("modbus:connectAll"),
	disconnectAllDevices: () => ipcRenderer.invoke("modbus:disconnectAll"),
	refreshConnections: () => ipcRenderer.invoke("modbus:refreshConnections"),
	readRegisters: (params) => ipcRenderer.invoke("modbus:readRegisters", params),
	writeRegister: (params) => ipcRenderer.invoke("modbus:writeRegister", params),
	readRawRegister: (params) => ipcRenderer.invoke("modbus:readRawRegister", params),

	// Database API
	getMappedSignals: () => ipcRenderer.invoke("db:getMappedSignals"),
	addMappedSignal: (signal) => ipcRenderer.invoke("db:addMappedSignal", signal),
	updateMappedSignal: (signal) => ipcRenderer.invoke("db:updateMappedSignal", signal),
	deleteMappedSignal: (id) => ipcRenderer.invoke("db:deleteMappedSignal", id),
	saveManualSnapshot: (data) =>
		ipcRenderer.invoke("db:saveManualSnapshot", data),
	getLayout: () => ipcRenderer.invoke("db:getLayout"),
	clearLayout: () => ipcRenderer.invoke("db:clearLayout"),
	saveLayoutPosition: (params) => ipcRenderer.invoke("db:saveLayoutPosition", params),

	modbusPreemptWrite: (signal_id, value) => ipcRenderer.invoke("modbus:preemptWrite", { signal_id, value }),
	directWrite: (params) => ipcRenderer.invoke("modbus:directWrite", params),

	// Device Registry API
	getDevices: () => ipcRenderer.invoke("db:getDevices"),
	addDevice: (device) => ipcRenderer.invoke("db:addDevice", device),
	updateDevice: (device) => ipcRenderer.invoke("db:updateDevice", device),
	deleteDevice: (id) => ipcRenderer.invoke("db:deleteDevice", id),

	getDeviceRegisters: (device_id) => ipcRenderer.invoke("db:getDeviceRegisters", device_id),
	addDeviceRegister: (reg) => ipcRenderer.invoke("db:addDeviceRegister", reg),
	updateDeviceRegister: (reg) => ipcRenderer.invoke("db:updateDeviceRegister", reg),
	deleteDeviceRegister: (id) => ipcRenderer.invoke("db:deleteDeviceRegister", id),

	// Sequence Engine API
	startSequence: (sequenceId) =>
		ipcRenderer.invoke("sequence:start", sequenceId),
	stopSequence: () => ipcRenderer.invoke("sequence:stop"),

	// Calibration API
	performCalibration: (params) =>
		ipcRenderer.invoke("calibration:perform", params),
	saveCalibrationHistory: (history) =>
		ipcRenderer.invoke("db:saveCalibrationHistory", history),
	getCalibrationHistory: (signal_label) =>
		ipcRenderer.invoke("db:getCalibrationHistory", signal_label),

	// Receive events from Main Process (e.g. state updates)
	onStateUpdate: (callback) =>
		ipcRenderer.on("state-update", (event, data) => callback(data)),
	removeStateUpdateListener: () =>
		ipcRenderer.removeAllListeners("state-update"),

	onNetworkUpdate: (callback) =>
		ipcRenderer.on("network-update", (event, data) => callback(data)),

	// Send events to Main Process (e.g. active dashboard changes)
	setActiveDashboard: (tabName) => ipcRenderer.send("app:setActiveDashboard", tabName),
});
