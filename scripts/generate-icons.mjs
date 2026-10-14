// Generates the plugin's PNG icons without any external dependencies.
//
// Shapes are rasterised with 4x supersampling and encoded as RGBA PNGs using Node's zlib.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pluginDir = join(root, "ai.opencode.streamdeck.sdPlugin");

const COLORS = {
	background: [0, 0, 0, 255],
	border: [255, 255, 255, 22],
	grey: [216, 216, 216, 255],
};

const SS = 4;

/** Signed distance from a point to a rounded rectangle boundary (negative inside). */
function roundRectDistance(x, y, cx, cy, hw, hh, r) {
	const qx = Math.abs(x - cx) - (hw - r);
	const qy = Math.abs(y - cy) - (hh - r);

	return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

class Canvas {
	constructor(width, height) {
		this.width = width;
		this.height = height;
		this.w = width * SS;
		this.h = height * SS;
		this.buffer = new Float32Array(this.w * this.h * 4);
	}

	#blend(x, y, [r, g, b, a]) {
		if (x < 0 || y < 0 || x >= this.w || y >= this.h) {
			return;
		}

		const index = (y * this.w + x) * 4;
		const sa = a / 255;
		const da = this.buffer[index + 3] / 255;
		const outA = sa + da * (1 - sa);

		if (outA <= 0) {
			return;
		}

		this.buffer[index] = (r * sa + this.buffer[index] * da * (1 - sa)) / outA;
		this.buffer[index + 1] = (g * sa + this.buffer[index + 1] * da * (1 - sa)) / outA;
		this.buffer[index + 2] = (b * sa + this.buffer[index + 2] * da * (1 - sa)) / outA;
		this.buffer[index + 3] = outA * 255;
	}

	roundRect(x, y, width, height, radius, color) {
		const px = x * this.w;
		const py = y * this.h;
		const pw = width * this.w;
		const ph = height * this.h;
		const cx = px + pw / 2;
		const cy = py + ph / 2;
		const hw = pw / 2;
		const hh = ph / 2;
		const r = radius * Math.min(this.w, this.h);
		const [minX, maxX] = [Math.floor(px - 2) - 1, Math.ceil(px + pw + 2) + 1];
		const [minY, maxY] = [Math.floor(py - 2) - 1, Math.ceil(py + ph + 2) + 1];

		for (let yy = minY; yy <= maxY; yy++) {
			for (let xx = minX; xx <= maxX; xx++) {
				const coverage = Math.min(1, Math.max(0, 0.5 - roundRectDistance(xx + 0.5, yy + 0.5, cx, cy, hw, hh, r)));

				if (coverage > 0) {
					this.#blend(xx, yy, [color[0], color[1], color[2], color[3] * coverage]);
				}
			}
		}
	}

	/** Draws a hollow rounded rectangle (a ring) with the given wall thickness. */
	ring(x, y, width, height, radius, thickness, color) {
		const px = x * this.w;
		const py = y * this.h;
		const pw = width * this.w;
		const ph = height * this.h;
		const cx = px + pw / 2;
		const cy = py + ph / 2;
		const hw = pw / 2;
		const hh = ph / 2;
		const scale = Math.min(this.w, this.h);
		const r = radius * scale;
		const wall = thickness * scale;
		const hwI = hw - wall;
		const hhI = hh - wall;
		const rI = Math.max(0, r - wall);
		const [minX, maxX] = [Math.floor(px - 2) - 1, Math.ceil(px + pw + 2) + 1];
		const [minY, maxY] = [Math.floor(py - 2) - 1, Math.ceil(py + ph + 2) + 1];

		for (let yy = minY; yy <= maxY; yy++) {
			for (let xx = minX; xx <= maxX; xx++) {
				const sx = xx + 0.5;
				const sy = yy + 0.5;
				const outer = Math.min(1, Math.max(0, 0.5 - roundRectDistance(sx, sy, cx, cy, hw, hh, r)));
				const inner =
					hwI > 0 && hhI > 0 ? Math.min(1, Math.max(0, 0.5 - roundRectDistance(sx, sy, cx, cy, hwI, hhI, rI))) : 0;
				const coverage = Math.max(0, outer - inner);

				if (coverage > 0) {
					this.#blend(xx, yy, [color[0], color[1], color[2], color[3] * coverage]);
				}
			}
		}
	}

	capsule(x1, y1, x2, y2, width, color) {
		const ax = x1 * this.w;
		const ay = y1 * this.h;
		const bx = x2 * this.w;
		const by = y2 * this.h;
		const half = (width * this.w) / 2;
		const minX = Math.floor(Math.min(ax, bx) - half - 2);
		const maxX = Math.ceil(Math.max(ax, bx) + half + 2);
		const minY = Math.floor(Math.min(ay, by) - half - 2);
		const maxY = Math.ceil(Math.max(ay, by) + half + 2);
		const dx = bx - ax;
		const dy = by - ay;
		const lengthSq = dx * dx + dy * dy || 1;

		for (let yy = minY; yy <= maxY; yy++) {
			for (let xx = minX; xx <= maxX; xx++) {
				const t = Math.min(1, Math.max(0, ((xx + 0.5 - ax) * dx + (yy + 0.5 - ay) * dy) / lengthSq));
				const dist = Math.hypot(xx + 0.5 - (ax + t * dx), yy + 0.5 - (ay + t * dy));
				const coverage = Math.min(1, Math.max(0, half + 0.5 - dist));

				if (coverage > 0) {
					this.#blend(xx, yy, [color[0], color[1], color[2], color[3] * coverage]);
				}
			}
		}
	}

	downsample() {
		const out = Buffer.alloc(this.width * this.height * 4);

		for (let y = 0; y < this.height; y++) {
			for (let x = 0; x < this.width; x++) {
				let r = 0;
				let g = 0;
				let b = 0;
				let a = 0;

				for (let sy = 0; sy < SS; sy++) {
					for (let sx = 0; sx < SS; sx++) {
						const index = ((y * SS + sy) * this.w + (x * SS + sx)) * 4;
						const alpha = this.buffer[index + 3] / 255;
						r += this.buffer[index] * alpha;
						g += this.buffer[index + 1] * alpha;
						b += this.buffer[index + 2] * alpha;
						a += alpha;
					}
				}

				const samples = SS * SS;
				const index = (y * this.width + x) * 4;

				if (a <= 0) {
					continue;
				}

				out[index] = Math.round(r / a);
				out[index + 1] = Math.round(g / a);
				out[index + 2] = Math.round(b / a);
				out[index + 3] = Math.round((a / samples) * 255);
			}
		}

		return out;
	}
}

// Four hollow OpenCode-style rounded rectangles in an evenly spaced 2x2 grid.
// Proportions mirror the logo: portrait cells (~0.8 ratio) with thick walls.
const CELL = { width: 0.28, height: 0.35, gapX: 0.1, gapY: 0.1, radius: 0.07, thickness: 0.06 };

function drawSessions(canvas) {
	const { width, height, gapX, gapY, radius, thickness } = CELL;
	const marginX = (1 - (2 * width + gapX)) / 2;
	const marginY = (1 - (2 * height + gapY)) / 2;

	for (let row = 0; row < 2; row++) {
		for (let column = 0; column < 2; column++) {
			const x = marginX + column * (width + gapX);
			const y = marginY + row * (height + gapY);

			canvas.ring(x, y, width, height, radius, thickness, COLORS.grey);
		}
	}
}

function drawSessionsApp(canvas) {
	canvas.roundRect(0.02, 0.02, 0.96, 0.96, 0.22, COLORS.background);
	canvas.roundRect(0.02, 0.02, 0.96, 0.96, 0.22, COLORS.border);
	canvas.roundRect(0.045, 0.045, 0.91, 0.91, 0.2, COLORS.background);
	drawSessions(canvas);
}

function png(width, height, rgba) {
	const raw = Buffer.alloc((width * 4 + 1) * height);

	for (let y = 0; y < height; y++) {
		raw[y * (width * 4 + 1)] = 0;
		rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
	}

	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8; // bit depth
	ihdr[9] = 6; // RGBA
	ihdr[10] = 0;
	ihdr[11] = 0;
	ihdr[12] = 0;

	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk("IHDR", ihdr),
		chunk("IDAT", deflateSync(raw, { level: 9 })),
		chunk("IEND", Buffer.alloc(0)),
	]);
}

function chunk(type, data) {
	const length = Buffer.alloc(4);
	length.writeUInt32BE(data.length, 0);
	const typeBuffer = Buffer.from(type, "ascii");
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);

	return Buffer.concat([length, typeBuffer, data, crc]);
}

const CRC_TABLE = (() => {
	const table = new Uint32Array(256);

	for (let n = 0; n < 256; n++) {
		let c = n;

		for (let k = 0; k < 8; k++) {
			c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		}

		table[n] = c >>> 0;
	}

	return table;
})();

function crc32(buffer) {
	let crc = 0xffffffff;

	for (const byte of buffer) {
		crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
	}

	return (crc ^ 0xffffffff) >>> 0;
}

function write(relativePath, size, draw) {
	const canvas = new Canvas(size, size);
	draw(canvas);
	const target = join(pluginDir, relativePath);

	mkdirSync(dirname(target), { recursive: true });
	writeFileSync(target, png(size, size, canvas.downsample()));
	console.log(`wrote ${relativePath} (${size}px)`);
}

// Plugin + category icons.
write("imgs/plugin/icon.png", 256, drawSessionsApp);
write("imgs/plugin/icon@2x.png", 512, drawSessionsApp);
write("imgs/plugin/category-icon.png", 28, drawSessions);
write("imgs/plugin/category-icon@2x.png", 56, drawSessions);

// Session action.
write("imgs/actions/session/action.png", 20, drawSessions);
write("imgs/actions/session/action@2x.png", 40, drawSessions);
write("imgs/actions/session/key.png", 144, drawSessionsApp);
write("imgs/actions/session/key@2x.png", 288, drawSessionsApp);
