const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
	// Modbus API
	readRegisters: (params) => ipcRenderer.invoke("modbus:readRegisters", params),
	writeRegister: (params) => ipcRenderer.invoke("modbus:writeRegister", params),

	// Database API
	getMappedSignals: () => ipcRenderer.invoke("db:getMappedSignals"),
	addMappedSignal: (signal) => ipcRenderer.invoke("db:addMappedSignal", signal),
	updateMappedSignal: (signal) => ipcRenderer.invoke("db:updateMappedSignal", signal),
	deleteMappedSignal: (id) => ipcRenderer.invoke("db:deleteMappedSignal", id),
	saveManualSnapshot: (data) =>
		ipcRenderer.invoke("db:saveManualSnapshot", data),

	// Device Registry API
	getDevices: () => ipcRenderer.invoke("db:getDevices"),
	addDevice: (device) => ipcRenderer.invoke("db:addDevice", device),
	updateDevice: (device) => ipcRenderer.invoke("db:updateDevice", device),
	deleteDevice: (id) => ipcRenderer.invoke("db:deleteDevice", id),

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
});
