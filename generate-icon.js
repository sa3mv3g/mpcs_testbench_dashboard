const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

// CRC32 implementation for PNG chunks
const crcTable = [];
for (let n = 0; n < 256; n++) {
	let c = n;
	for (let k = 0; k < 8; k++) {
		if (c & 1) {
			c = 0xedb88320 ^ (c >>> 1);
		} else {
			c = c >>> 1;
		}
	}
	crcTable[n] = c;
}

function crc32(buf) {
	let c = 0xffffffff;
	for (let i = 0; i < buf.length; i++) {
		c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
	}
	return (c ^ 0xffffffff) >>> 0;
}

function createChunk(type, data) {
	const len = data.length;
	const buf = Buffer.alloc(4 + 4 + len + 4);
	buf.writeUInt32BE(len, 0);
	buf.write(type, 4, 4, "ascii");
	data.copy(buf, 8);
	const crc = crc32(buf.subarray(4, 8 + len));
	buf.writeUInt32BE(crc, 8 + len);
	return buf;
}

function createPNGFromBuffer(rawDataRGBA, width, height) {
	const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

	// IHDR chunk
	const ihdrData = Buffer.alloc(13);
	ihdrData.writeUInt32BE(width, 0);
	ihdrData.writeUInt32BE(height, 4);
	ihdrData[8] = 8; // 8 bit depth
	ihdrData[9] = 6; // RGBA
	ihdrData[10] = 0; // compression
	ihdrData[11] = 0; // filter
	ihdrData[12] = 0; // interlace
	const ihdrChunk = createChunk("IHDR", ihdrData);

	// Raw image data with filter byte 0 at start of each scanline
	const stride = width * 4;
	const scanlines = Buffer.alloc(height * (stride + 1));

	for (let y = 0; y < height; y++) {
		const rowOffset = y * (stride + 1);
		scanlines[rowOffset] = 0; // Filter: None
		rawDataRGBA.copy(scanlines, rowOffset + 1, y * stride, (y + 1) * stride);
	}

	const compressedData = zlib.deflateSync(scanlines, { level: 9 });
	const idatChunk = createChunk("IDAT", compressedData);
	const iendChunk = createChunk("IEND", Buffer.alloc(0));

	return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function createPNG(width, height, getPixel) {
	const rawData = Buffer.alloc(width * height * 4);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const pxOffset = (y * width + x) * 4;
			const [r, g, b, a] = getPixel(x, y, width, height);
			rawData[pxOffset] = r;
			rawData[pxOffset + 1] = g;
			rawData[pxOffset + 2] = b;
			rawData[pxOffset + 3] = a;
		}
	}
	return { pngBuffer: createPNGFromBuffer(rawData, width, height), rawData };
}

// Downsample high-res master RGBA buffer using area-averaging for crisp sub-pixel antialiasing
function downsample(masterBuffer, srcSize, targetSize) {
	if (srcSize === targetSize) {
		return Buffer.from(masterBuffer);
	}
	const dstBuffer = Buffer.alloc(targetSize * targetSize * 4);
	const ratio = srcSize / targetSize;

	for (let ty = 0; ty < targetSize; ty++) {
		const syStart = ty * ratio;
		const syEnd = (ty + 1) * ratio;
		const y0 = Math.floor(syStart);
		const y1 = Math.min(srcSize - 1, Math.ceil(syEnd));

		for (let tx = 0; tx < targetSize; tx++) {
			const sxStart = tx * ratio;
			const sxEnd = (tx + 1) * ratio;
			const x0 = Math.floor(sxStart);
			const x1 = Math.min(srcSize - 1, Math.ceil(sxEnd));

			let totalR = 0,
				totalG = 0,
				totalB = 0,
				totalA = 0,
				totalWeight = 0;

			for (let y = y0; y < y1; y++) {
				const yOverlap = Math.min(y + 1, syEnd) - Math.max(y, syStart);
				if (yOverlap <= 0) continue;

				for (let x = x0; x < x1; x++) {
					const xOverlap = Math.min(x + 1, sxEnd) - Math.max(x, sxStart);
					if (xOverlap <= 0) continue;

					const weight = xOverlap * yOverlap;
					const srcIdx = (y * srcSize + x) * 4;

					const a = masterBuffer[srcIdx + 3] / 255;
					totalR += masterBuffer[srcIdx] * a * weight;
					totalG += masterBuffer[srcIdx + 1] * a * weight;
					totalB += masterBuffer[srcIdx + 2] * a * weight;
					totalA += masterBuffer[srcIdx + 3] * weight;
					totalWeight += weight;
				}
			}

			const dstIdx = (ty * targetSize + tx) * 4;
			if (totalWeight > 0) {
				const finalA = totalA / totalWeight;
				if (finalA > 0) {
					dstBuffer[dstIdx] = Math.min(
						255,
						Math.max(0, Math.round(totalR / totalWeight / (finalA / 255))),
					);
					dstBuffer[dstIdx + 1] = Math.min(
						255,
						Math.max(0, Math.round(totalG / totalWeight / (finalA / 255))),
					);
					dstBuffer[dstIdx + 2] = Math.min(
						255,
						Math.max(0, Math.round(totalB / totalWeight / (finalA / 255))),
					);
					dstBuffer[dstIdx + 3] = Math.min(
						255,
						Math.max(0, Math.round(finalA)),
					);
				}
			}
		}
	}
	return dstBuffer;
}

// Generate Windows .ico file containing multiple embedded PNG resolutions
function createICO(images) {
	const count = images.length;
	const headerSize = 6;
	const dirEntrySize = 16;
	let offset = headerSize + count * dirEntrySize;

	const header = Buffer.alloc(headerSize);
	header.writeUInt16LE(0, 0); // reserved
	header.writeUInt16LE(1, 2); // type: 1 for ICO
	header.writeUInt16LE(count, 4); // count of images

	const dirEntries = [];
	const imageBuffers = [];

	for (const { size, pngBuffer } of images) {
		const entry = Buffer.alloc(dirEntrySize);
		entry.writeUInt8(size >= 256 ? 0 : size, 0); // width (0 means 256)
		entry.writeUInt8(size >= 256 ? 0 : size, 1); // height (0 means 256)
		entry.writeUInt8(0, 2); // color palette
		entry.writeUInt8(0, 3); // reserved
		entry.writeUInt16LE(1, 4); // color planes
		entry.writeUInt16LE(32, 6); // bits per pixel
		entry.writeUInt32LE(pngBuffer.length, 8); // size of image data
		entry.writeUInt32LE(offset, 12); // file offset to image data

		dirEntries.push(entry);
		imageBuffers.push(pngBuffer);
		offset += pngBuffer.length;
	}

	return Buffer.concat([header, ...dirEntries, ...imageBuffers]);
}

// Generate 512x512 Gauge & Waveform icon in AICS Vibrant Orange & Crimson theme
const SIZE = 512;
const CX = SIZE / 2;
const CY = SIZE / 2;
const R_OUTER = 230;
const R_INNER = 205;

// Waveform function: active telemetry waveform (sine with ECG/pulse peak in middle)
function getWaveformY(x) {
	const nx = (x - CX) / (SIZE * 0.4); // -1 to 1
	if (Math.abs(nx) > 1.1) return null;

	// Baseline slightly below center
	const baseY = CY + 45;

	// Composite signal: carrier + sharp telemetry pulse peak at center
	const carrier = Math.sin(nx * 14) * 8 * Math.cos(nx * 1.5);
	let pulse = 0;
	if (Math.abs(nx) < 0.35) {
		const px = nx / 0.35;
		// P-Q-R-S-T like sharp industrial telemetry spike
		pulse = Math.sin(px * Math.PI * 4) * Math.exp(-px * px * 6) * 65;
	}
	return baseY - carrier - pulse;
}

const { pngBuffer: masterPngBuffer, rawData: masterRawData } = createPNG(
	SIZE,
	SIZE,
	(x, y, w, h) => {
		const dx = x - CX;
		const dy = y - CY;
		const dist = Math.sqrt(dx * dx + dy * dy);
		const angle = Math.atan2(dy, dx); // -PI to PI (0 is right, PI/2 is down)

		// Background rounded rectangle
		const cornerR = 90;
		const rx = Math.max(0, Math.abs(dx) - (CX - cornerR - 16));
		const ry = Math.max(0, Math.abs(dy) - (CY - cornerR - 16));
		const rectDist = Math.sqrt(rx * rx + ry * ry);

		if (rectDist > cornerR) {
			return [0, 0, 0, 0]; // Transparent outside rounded icon boundary
		}

		// Default icon background: Dark industrial slate gradient (#12161F to #1A202C)
		const bgGrad = y / h;
		let r = Math.floor(18 + bgGrad * 12);
		let g = Math.floor(22 + bgGrad * 14);
		let b = Math.floor(31 + bgGrad * 18);
		let a = 255;

		// Outer metallic bezel ring (dist between R_INNER and R_OUTER)
		if (dist <= R_OUTER && dist >= R_INNER) {
			// Metallic specular shading based on angle
			const shine = Math.cos(angle * 2 - Math.PI / 4) * 0.5 + 0.5;
			const bezelV = 0.6 + 0.4 * shine;
			r = Math.floor(65 * bezelV + (1 - bezelV) * 38);
			g = Math.floor(75 * bezelV + (1 - bezelV) * 45);
			b = Math.floor(92 * bezelV + (1 - bezelV) * 58);
		}

		// Bezel border rings with warm orange-slate highlight
		if (Math.abs(dist - R_OUTER) < 2) {
			r = 140;
			g = 150;
			b = 170;
		}
		if (Math.abs(dist - R_INNER) < 2) {
			// Vibrant orange inner accent rim
			r = 255;
			g = 110;
			b = 20;
		}

		// Dial interior face (dist < R_INNER)
		if (dist < R_INNER) {
			// Subtle radial dark gradient for depth
			const dialNorm = dist / R_INNER;
			r = Math.floor(14 + (1 - dialNorm) * 16);
			g = Math.floor(18 + (1 - dialNorm) * 18);
			b = Math.floor(26 + (1 - dialNorm) * 22);

			// Gauge arc track (from -215 deg to +35 deg, i.e. 250 degree sweep)
			const deg = (angle * 180) / Math.PI;
			const inGaugeArc = (deg >= -215 && deg <= 35) || deg >= 145;

			// Gauge background track
			if (dist >= 145 && dist <= 170 && inGaugeArc) {
				r = 35;
				g = 25;
				b = 28;
			}

			// Active gauge filled value arc (from 145 deg up to -20 deg)
			const inActiveValueArc =
				(deg >= 145 && deg <= 180) || (deg >= -180 && deg <= -20);
			if (dist >= 148 && dist <= 167 && inActiveValueArc) {
				// Gradient crimson-red (#D32F2F) to vibrant orange (#FF6600) to bright gold-orange (#FFA040)
				const progress = (deg > 0 ? deg - 145 : deg + 215) / 220;
				// Crimson -> Vibrant Orange -> Warm Amber
				if (progress < 0.5) {
					const p2 = progress / 0.5;
					r = Math.floor(215 * (1 - p2) + 255 * p2); // 215 -> 255
					g = Math.floor(40 * (1 - p2) + 102 * p2); // 40 -> 102 (#FF6600)
					b = Math.floor(40 * (1 - p2) + 0 * p2);
				} else {
					const p2 = (progress - 0.5) / 0.5;
					r = 255;
					g = Math.floor(102 * (1 - p2) + 165 * p2); // 102 -> 165 (#FFA500)
					b = Math.floor(0 * (1 - p2) + 40 * p2);
				}
			}

			// Gauge tick marks (every 15 degrees)
			for (let t = -210; t <= 30; t += 15) {
				const rad = (t * Math.PI) / 180;
				const cosT = Math.cos(rad);
				const sinT = Math.sin(rad);
				const isMajor = t % 30 === 0;
				const tLen = isMajor ? 18 : 10;
				const tStart = 172;
				const tEnd = tStart - tLen;

				// Distance along tick normal
				const tickDist = dx * cosT + dy * sinT;
				const tickPerp = Math.abs(-dx * sinT + dy * cosT);

				if (
					tickDist >= tEnd &&
					tickDist <= tStart &&
					tickPerp < (isMajor ? 1.8 : 1.0)
				) {
					if (isMajor) {
						// Bright warm ivory-orange major tick
						r = 255;
						g = 230;
						b = 200;
					} else {
						// Vibrant orange-amber minor tick
						r = 255;
						g = 130;
						b = 45;
					}
				}
			}

			// Center needle hub (circular center cap)
			if (dist <= 24) {
				const hubGrad = 1 - dist / 24;
				r = Math.floor(50 + hubGrad * 80);
				g = Math.floor(45 + hubGrad * 65);
				b = Math.floor(48 + hubGrad * 60);
			}
			if (dist <= 12) {
				r = 255;
				g = 102;
				b = 0; // Glowing vibrant orange center jewel (#FF6600)
			}
			if (dist <= 5) {
				r = 255;
				g = 210;
				b = 140; // High-intensity center spark
			}

			// Gauge Needle pointing at ~ -35 degrees (high active industrial readout)
			const needleAngle = (-35 * Math.PI) / 180;
			const nCos = Math.cos(needleAngle);
			const nSin = Math.sin(needleAngle);
			const nDist = dx * nCos + dy * nSin;
			const nPerp = Math.abs(-dx * nSin + dy * nCos);

			if (nDist >= -20 && nDist <= 150) {
				const widthAtDist = 5.5 * (1 - nDist / 170);
				if (nPerp <= widthAtDist) {
					// High-visibility Crimson-Red (#D32F2F) to Vibrant Orange (#FF6600) to Golden Tip (#FFD54F)
					if (nDist > 125) {
						r = 255;
						g = 225;
						b = 110; // Bright golden tip highlight
					} else if (nDist > 60) {
						r = 255;
						g = 105;
						b = 10; // Vibrant orange body
					} else {
						r = 220;
						g = 35;
						b = 30; // Crimson-red needle base
					}
				}
			}
		}

		// Telemetry Waveform Signal (Glowing Vibrant Orange / Amber across center)
		const waveY = getWaveformY(x);
		if (waveY !== null) {
			const yDist = Math.abs(y - waveY);
			// Core beam (2.2px thick)
			if (yDist <= 2.2) {
				r = 255;
				g = 245;
				b = 225; // Bright warm white core beam
			} else if (yDist <= 6.0) {
				// Intense vibrant orange neon glow (#FF7A00)
				const glow = 1 - (yDist - 2.2) / 3.8;
				r = Math.min(255, r + Math.floor(255 * glow));
				g = Math.min(255, g + Math.floor(122 * glow));
				b = Math.min(255, b + Math.floor(10 * glow));
			} else if (yDist <= 14.0) {
				// Diffuse warm amber / crimson-orange ambient glow
				const glow = 1 - (yDist - 6.0) / 8.0;
				r = Math.min(255, r + Math.floor(230 * glow * 0.45));
				g = Math.min(255, g + Math.floor(65 * glow * 0.45));
				b = Math.min(255, b + Math.floor(10 * glow * 0.3));
			}
		}

		// Small status indicator LED dot at top right of dial (Vibrant orange/crimson status indicator)
		const ledDx = x - (CX + 85);
		const ledDy = y - (CY - 120);
		const ledDist = Math.sqrt(ledDx * ledDx + ledDy * ledDy);
		if (ledDist <= 8) {
			if (ledDist <= 4) {
				r = 255;
				g = 220;
				b = 150; // bright active orange-white LED center
			} else {
				r = 255;
				g = 90;
				b = 0; // vibrant orange LED ring
			}
		} else if (ledDist <= 16) {
			const ledGlow = 1 - (ledDist - 8) / 8;
			r = Math.min(255, r + Math.floor(240 * ledGlow));
			g = Math.min(255, g + Math.floor(100 * ledGlow));
		}

		return [r, g, b, a];
	},
);

const assetsDir = path.join(__dirname, "assets");
if (!fs.existsSync(assetsDir)) {
	fs.mkdirSync(assetsDir, { recursive: true });
}

// 1. Write master 512x512 icon.png
const pngOutPath = path.join(assetsDir, "icon.png");
fs.writeFileSync(pngOutPath, masterPngBuffer);
console.log(
	`Generated high quality icon (${SIZE}x${SIZE}) at: ${pngOutPath} (${masterPngBuffer.length} bytes)`,
);

// 2. Generate standard multi-resolution Windows ICO (16, 24, 32, 48, 64, 128, 256)
const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const icoFrames = icoSizes.map((size) => {
	const downsampledBuffer = downsample(masterRawData, SIZE, size);
	const pngBuf = createPNGFromBuffer(downsampledBuffer, size, size);
	return { size, pngBuffer: pngBuf };
});

const icoBuffer = createICO(icoFrames);
const icoOutPath = path.join(assetsDir, "icon.ico");
fs.writeFileSync(icoOutPath, icoBuffer);
console.log(
	`Generated multi-resolution Windows ICO (${icoSizes.join(", ")}) at: ${icoOutPath} (${icoBuffer.length} bytes)`,
);
