"use strict";

const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "content", "zotlink.js"), "utf8");
const functionStart = source.indexOf("async extractIdentifierFromPDFMetadata");
const assignmentStart = source.indexOf("let script = [", functionStart);
const arrayStart = source.indexOf("[", assignmentStart);
const joinMarker = "].join(\"\\n\");";
const arrayEnd = source.indexOf(joinMarker, arrayStart);

if (functionStart < 0 || assignmentStart < 0 || arrayStart < 0 || arrayEnd < 0) {
	throw new Error("Could not locate the embedded PDF identifier extraction script");
}

const scriptLines = Function(`return (${source.slice(arrayStart, arrayEnd + 1)});`)();
const extractor = scriptLines.join("\n");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zotlink-doi-test-"));
const extractorPath = path.join(tempDir, "extract.py");
const pdfPath = path.join(tempDir, "chapter.pdf");
const outputPath = path.join(tempDir, "result.txt");
const expected = "doi\t10.4018/978-1-61350-447-5.ch005";

const createPDF = String.raw`
import pikepdf
import sys

path = sys.argv[1]
pdf = pikepdf.Pdf.new()
pdf.add_blank_page()
pdf.docinfo['/doi'] = '10.4018/978-1-61350-447-5.ch005'
pdf.docinfo['/doiURL'] = 'https://doi.org/10.4018/978-1-61350-447-5'
with pdf.open_metadata(set_pikepdf_as_editor=False) as meta:
    meta['dc:identifier'] = '10.4018/978-1-61350-447-5'
pdf.save(path)
pdf.close()
`;

try {
	fs.writeFileSync(extractorPath, extractor, "utf8");
	execFileSync("C:\\Windows\\py.exe", ["-3", "-c", createPDF, pdfPath], { stdio: "inherit" });
	execFileSync("C:\\Windows\\py.exe", ["-3", extractorPath, pdfPath, outputPath], { stdio: "inherit" });
	const actual = fs.readFileSync(outputPath, "utf8").trim();
	if (actual !== expected) {
		throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
	}
	console.log(`DOI extraction regression passed: ${actual}`);
}
finally {
	for (const file of [outputPath, pdfPath, extractorPath]) {
		if (fs.existsSync(file)) {
			fs.unlinkSync(file);
		}
	}
	if (fs.existsSync(tempDir)) {
		fs.rmdirSync(tempDir);
	}
}
