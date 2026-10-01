"use strict";

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const outPath = path.join(dist, `${manifest.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${manifest.version}.xpi`);

const entries = [
	"manifest.json",
	"LICENSE",
	"README.md",
	"FUNCTIONS.md",
	"VERSION_LOG.md",
	"bootstrap.js",
	"prefs.js",
	"defaults/preferences/prefs.js",
	"content/zotlink.js",
	"content/preferences.xhtml",
	"icons/zotlink-48.png",
	"icons/zotlink-96.png",
	"icons/zotlink-128.png",
	"locale/en-US/zotlink.ftl",
	"locale/zh-CN/zotlink.ftl"
];

fs.mkdirSync(dist, { recursive: true });
writeZip(outPath, entries.map(name => ({
	name: name.replace(/\\/g, "/"),
	data: fs.readFileSync(path.join(root, name))
})));

const updatesPath = path.join(root, "updates.json");
if (fs.existsSync(updatesPath)) {
	fs.copyFileSync(updatesPath, path.join(dist, "updates.json"));
}

console.log(outPath);

function writeZip(file, files) {
	const chunks = [];
	const central = [];
	let offset = 0;

	for (const entry of files) {
		const name = Buffer.from(entry.name);
		const data = Buffer.from(entry.data);
		const crc = crc32(data);
		const compressed = zlib.deflateRawSync(data);
		const local = Buffer.alloc(30);

		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(20, 4);
		local.writeUInt16LE(0, 6);
		local.writeUInt16LE(8, 8);
		local.writeUInt16LE(0, 10);
		local.writeUInt16LE(0, 12);
		local.writeUInt32LE(crc, 14);
		local.writeUInt32LE(compressed.length, 18);
		local.writeUInt32LE(data.length, 22);
		local.writeUInt16LE(name.length, 26);
		local.writeUInt16LE(0, 28);

		chunks.push(local, name, compressed);

		const header = Buffer.alloc(46);
		header.writeUInt32LE(0x02014b50, 0);
		header.writeUInt16LE(20, 4);
		header.writeUInt16LE(20, 6);
		header.writeUInt16LE(0, 8);
		header.writeUInt16LE(8, 10);
		header.writeUInt16LE(0, 12);
		header.writeUInt16LE(0, 14);
		header.writeUInt32LE(crc, 16);
		header.writeUInt32LE(compressed.length, 20);
		header.writeUInt32LE(data.length, 24);
		header.writeUInt16LE(name.length, 28);
		header.writeUInt16LE(0, 30);
		header.writeUInt16LE(0, 32);
		header.writeUInt16LE(0, 34);
		header.writeUInt16LE(0, 36);
		header.writeUInt32LE(0, 38);
		header.writeUInt32LE(offset, 42);
		central.push(header, name);

		offset += local.length + name.length + compressed.length;
	}

	const centralSize = central.reduce((sum, buffer) => sum + buffer.length, 0);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(0, 4);
	end.writeUInt16LE(0, 6);
	end.writeUInt16LE(files.length, 8);
	end.writeUInt16LE(files.length, 10);
	end.writeUInt32LE(centralSize, 12);
	end.writeUInt32LE(offset, 16);
	end.writeUInt16LE(0, 20);

	fs.writeFileSync(file, Buffer.concat([...chunks, ...central, end]));
}

function crc32(buffer) {
	let table = crc32.table;
	if (!table) {
		table = crc32.table = Array.from({ length: 256 }, (_, n) => {
			let c = n;
			for (let k = 0; k < 8; k++) {
				c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
			}
			return c >>> 0;
		});
	}

	let crc = 0xffffffff;
	for (const byte of buffer) {
		crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
	}
	return (crc ^ 0xffffffff) >>> 0;
}
