const fs = require("fs");
const path = require("path");
const packageJson = require("../package.json");

describe("Basic Infrastructure & Metadata Test", () => {
	it("should run jest correctly", () => {
		expect(true).toBe(true);
	});

	it("package.json should have valid version, productName, author, and homepage", () => {
		expect(packageJson.version).toBeDefined();
		expect(packageJson.version).toMatch(/^\d+\.\d+\.\d+/);
		expect(packageJson.productName).toBe("MPCS Testbench Dashboard");
		expect(packageJson.author).toBe("Advance Instrumentation 'n' Control Systems");
		expect(packageJson.homepage).toBe("http://www.aics.co.in");
	});

	it("assets/icon.png should exist and have a valid PNG header", () => {
		const iconPath = path.join(__dirname, "..", "assets", "icon.png");
		expect(fs.existsSync(iconPath)).toBe(true);

		const buffer = fs.readFileSync(iconPath);
		// PNG signature: 89 50 4E 47 0D 0A 1A 0A
		const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
		expect(buffer.subarray(0, 8)).toEqual(pngSignature);
	});

	it("assets/logo.png should exist and have a valid PNG header", () => {
		const logoPath = path.join(__dirname, "..", "assets", "logo.png");
		expect(fs.existsSync(logoPath)).toBe(true);

		const buffer = fs.readFileSync(logoPath);
		const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
		expect(buffer.subarray(0, 8)).toEqual(pngSignature);
	});

	it("src/renderer/index.html should include title, icon, company logo, about modal, and footer", () => {
		const htmlPath = path.join(__dirname, "..", "src", "renderer", "index.html");
		expect(fs.existsSync(htmlPath)).toBe(true);
		const html = fs.readFileSync(htmlPath, "utf-8");

		expect(html).toContain("<title>MPCS Testbench Dashboard</title>");
		expect(html).toContain('id="btn-about-dialog"');
		expect(html).toContain('id="modal-about"');
		expect(html).toContain('id="app-footer"');
		expect(html).toContain("Advance Instrumentation 'n' Control Systems");
		expect(html).toContain("www.aics.co.in");
		expect(html).toContain('assets/logo.png');
		expect(html).toContain('company-logo-header');
		expect(html).toContain('company-logo-about');
		expect(html).toContain('company-logo-footer');
	});

	it("src/main.js should disable default application menu bar", () => {
		const mainPath = path.join(__dirname, "..", "src", "main.js");
		expect(fs.existsSync(mainPath)).toBe(true);
		const mainContent = fs.readFileSync(mainPath, "utf-8");

		expect(mainContent).toContain("autoHideMenuBar: true");
		expect(mainContent).toContain("Menu.setApplicationMenu(null)");
	});
});
