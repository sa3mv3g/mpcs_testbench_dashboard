const fs = require("fs");
const path = require("path");

const dir = path.join(__dirname, "build");
if (!fs.existsSync(dir)) {
	fs.mkdirSync(dir, { recursive: true });
}

const src = path.join(__dirname, "assets", "icon.ico");
const dest = path.join(dir, "icon.ico");

if (fs.existsSync(src)) {
	fs.copyFileSync(src, dest);
	console.log(`Copied ${src} to ${dest}`);
} else {
	console.warn(
		`Source icon not found at ${src}. Run node generate-icon.js first.`,
	);
}
