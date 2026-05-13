const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const log = require("electron-log");
const sqlite3 = require("sqlite3").verbose();

// Configure electron-log
log.transports.file.level = "info";
log.info("Application starting...");

let mainWindow;
let db;

function initDatabase() {
	const dbPath = path.join(app.getPath("userData"), "database.sqlite");
	log.info(`Initializing SQLite database at: ${dbPath}`);

	db = new sqlite3.Database(dbPath, (err) => {
		if (err) {
			log.error("Failed to connect to database", err);
		} else {
			log.info("Connected to SQLite database");
			// Create necessary tables if they don't exist
			db.run(`CREATE TABLE IF NOT EXISTS mapped_signals (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                label TEXT,
                type TEXT,
                ip TEXT,
                port INTEGER,
                register INTEGER
            )`);

			db.run(`CREATE TABLE IF NOT EXISTS device_registry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                display_name TEXT,
                ip TEXT,
                port INTEGER
            )`);

			// Insert a mock signal if empty (for demo purposes)
			db.get("SELECT COUNT(*) as count FROM mapped_signals", (err, row) => {
				if (!err && row.count === 0) {
					db.run(`INSERT INTO mapped_signals (label, type, ip, port, register) 
                            VALUES ('AO-05', 'analog-out', '192.168.1.100', 502, 100)`);
				}
			});
		}
	});
}

function createWindow() {
	mainWindow = new BrowserWindow({
		width: 1200,
		height: 800,
		webPreferences: {
			preload: path.join(__dirname, "preload.js"),
			nodeIntegration: false,
			contextIsolation: true,
		},
	});

	mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));

	// Open the DevTools.
	// mainWindow.webContents.openDevTools();
}

app.whenReady().then(() => {
	initDatabase();
	createWindow();

	app.on("activate", function () {
		if (BrowserWindow.getAllWindows().length === 0) createWindow();
	});
});

app.on("window-all-closed", function () {
	if (db) db.close();
	if (process.platform !== "darwin") app.quit();
});

// --- High Level IPC Handlers ---

// Modbus interactions
ipcMain.handle(
	"modbus:readRegisters",
	async (event, { deviceIp, port, startAddress, length }) => {
		log.info(`Reading registers from ${deviceIp}:${port}`);
		// TODO: Implement actual Modbus TCP read logic using modbus-serial
		return { success: true, data: [0, 0] }; // Mock data
	},
);

ipcMain.handle(
	"modbus:writeRegister",
	async (event, { deviceIp, port, address, value }) => {
		log.info(`Writing register to ${deviceIp}:${port}`);
		// TODO: Implement actual Modbus TCP write logic
		return { success: true };
	},
);

// SQLite Database interactions
ipcMain.handle("db:getMappedSignals", async (event) => {
	return new Promise((resolve, reject) => {
		if (!db) return resolve([]);
		db.all("SELECT * FROM mapped_signals", (err, rows) => {
			if (err) {
				log.error("Error fetching signals", err);
				resolve([]);
			} else {
				resolve(rows);
			}
		});
	});
});

ipcMain.handle("db:saveManualSnapshot", async (event, data) => {
	log.info("Saving manual snapshot");
	// TODO: Insert into SQLite
	return { success: true };
});

// Device Registry interactions
ipcMain.handle("db:getDevices", async () => {
	return new Promise((resolve, reject) => {
		if (!db) return resolve([]);
		db.all("SELECT * FROM device_registry", (err, rows) => {
			if (err) {
				log.error("Error fetching devices", err);
				resolve([]);
			} else {
				resolve(rows);
			}
		});
	});
});

ipcMain.handle("db:addDevice", async (event, device) => {
	return new Promise((resolve, reject) => {
		const { display_name, ip, port } = device;
		db.run(
			"INSERT INTO device_registry (display_name, ip, port) VALUES (?, ?, ?)",
			[display_name, ip, port],
			function (err) {
				if (err) {
					log.error("Error adding device", err);
					resolve({ success: false, error: err.message });
				} else {
					resolve({ success: true, id: this.lastID });
				}
			},
		);
	});
});

ipcMain.handle("db:updateDevice", async (event, device) => {
	return new Promise((resolve, reject) => {
		const { id, display_name, ip, port } = device;
		db.run(
			"UPDATE device_registry SET display_name = ?, ip = ?, port = ? WHERE id = ?",
			[display_name, ip, port, id],
			function (err) {
				if (err) {
					log.error("Error updating device", err);
					resolve({ success: false, error: err.message });
				} else {
					resolve({ success: true, changes: this.changes });
				}
			},
		);
	});
});

ipcMain.handle("db:deleteDevice", async (event, id) => {
	return new Promise((resolve, reject) => {
		db.run("DELETE FROM device_registry WHERE id = ?", [id], function (err) {
			if (err) {
				log.error("Error deleting device", err);
				resolve({ success: false, error: err.message });
			} else {
				resolve({ success: true, changes: this.changes });
			}
		});
	});
});

// Test Sequence execution
ipcMain.handle("sequence:start", async (event, sequenceId) => {
	log.info(`Starting sequence ${sequenceId}`);
	// TODO: Start sequence engine execution
	return { success: true };
});

ipcMain.handle("sequence:stop", async (event) => {
	log.info("Stopping sequence");
	// TODO: Stop sequence engine execution
	return { success: true };
});

// Hardware Calibration
ipcMain.handle(
	"calibration:perform",
	async (event, { label, scale, offset, deadzone }) => {
		log.info(`Performing calibration for ${label}`);
		// TODO: Implement hardware calibration protocol (Zeroing, Writing, Handshake)
		return { success: true };
	},
);
