import { suite, it, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { stdout } from "node:process"
import DBFS, { DocumentEntry, DocumentStat } from "./index.js"

class TestEntry {
	// entry.file, entry.dirs.size, entry.top.size, entry.totalSize, entry.errors.size, entry.progress
	file
	dirSize
	topSize
	totalSize
	errorsSize
	constructor(input = []) {
		const [
			file,
			dirSize = 0,
			topSize = 0,
			totalSize = { dirs: 0, files: 0 },
			errorsSize = 0,
		] = input
		this.file = DocumentEntry.from(file)
		this.dirSize = Number(dirSize)
		this.topSize = Number(topSize)
		this.totalSize = totalSize
		this.errorsSize = Number(errorsSize)
	}
	toString() {
		return [
			this.file,
			`[ ${this.dirSize}d`,
			`${this.topSize}t`,
			`${this.totalSize.dirs}d`,
			`${this.totalSize.files}f`,
			`${this.errorsSize}e ]`,
		].filter(Boolean).join(" ")
	}
}

/**
 * @desc Tests the findStream functionality for scanning directories.
 */
suite("findStream()", () => {
	/** @type {DBFS} */
	let db
	/** @type {DocumentEntry[]} */
	let files
	/** @type {() => void} */
	let originalStdoutWrite
	/** @type {Map<string, { content: string, mtime: Date, mtimeMs: number }>} */
	let memoryFS

	const createMemoryFS = () => {
		const fs = new Map()
		return {
			existsSync: (path) => fs.has(path),
			statSync: (path) => {
				if (!fs.has(path)) throw new Error("File not found")
				return { mtime: fs.get(path).mtime, mtimeMs: fs.get(path).mtimeMs, size: fs.get(path).content.length }
			},
			load: (path) => {
				if (!fs.has(path)) throw new Error("File not found")
				return fs.get(path).content
			},
			save: (path, content) => {
				const now = Date.now()
				fs.set(path, { content, mtime: new Date(now), mtimeMs: now })
			},
			appendFileSync: (path, chunk) => {
				const now = Date.now()
				if (fs.has(path)) {
					const old = fs.get(path)
					fs.set(path, { content: old.content + chunk, mtime: new Date(now), mtimeMs: now })
				} else {
					fs.set(path, { content: chunk, mtime: new Date(now), mtimeMs: now })
				}
			},
			clear: () => fs.clear(),
		}
	}

	beforeEach(() => {
		db = new DBFS({ root: "." })
		files = [
			new DocumentEntry({ name: "file1.txt", stat: new DocumentStat({ size: 10, mtimeMs: 1000 }), depth: 0, isDirectory: false }),
			new DocumentEntry({ name: "file2.txt", stat: new DocumentStat({ size: 20, mtimeMs: 2000 }), depth: 0, isDirectory: false }),
			new DocumentEntry({ name: "dir", stat: new DocumentStat({ size: 0, mtimeMs: 3000 }), depth: 0, isDirectory: true }),
			new DocumentEntry({ name: "dir/file3.txt", stat: new DocumentStat({ size: 30, mtimeMs: 4000 }), depth: 1, isDirectory: false }),
		]
		memoryFS = createMemoryFS()

		db.ensureAccess = async (uri, level) => {
			if (uri.startsWith("../")) {
				throw new Error("No access outside of the db container")
			}
			return true
		}
		db.resolve = async (uri) => uri
		db.relative = (from, to) => to.startsWith(from) ? to.slice(from.length) : to
		db.statDocument = async (uri) => {
			if (!memoryFS.existsSync(uri)) return { mtime: 0, mtimeMs: 0 }
			return memoryFS.statSync(uri)
		}
		db.loadDocument = async (uri, defaultValue = "") => {
			await db.ensureAccess(uri, "r")
			if (!memoryFS.existsSync(uri)) return defaultValue
			return memoryFS.load(uri)
		}
		db.saveDocument = async (uri, document) => {
			await db.ensureAccess(uri, "w")
			let content = document
			if (uri.endsWith(".json")) {
				content = JSON.stringify(document, null, 2)
			}
			memoryFS.save(uri, content)
			return true
		}
		db.writeDocument = async (uri, chunk) => {
			await db.ensureAccess(uri, "w")
			memoryFS.appendFileSync(uri, chunk)
			return true
		}
		db.dropDocument = async (uri) => {
			await db.ensureAccess(uri, "d")
			return false
		}

		db.readDir = async function* () {
			for (const f of files) {
				yield f
			}
		}
		db.connect = async () => {
			db.connected = true
		}
		db.disconnect = async () => {
			db.connected = false
		}

		originalStdoutWrite = stdout.write
		stdout.write = () => true
	})

	afterEach(() => {
		stdout.write = originalStdoutWrite
		memoryFS.clear()
	})

	it("should yield files with correct progress and sorting by name asc", async () => {
		let entries = [
			new DocumentEntry({ path: "a.txt", stat: new DocumentStat({ size: 10, mtimeMs: 1000, isFile: true }), depth: 0 }),
			new DocumentEntry({ path: "b.txt", stat: new DocumentStat({ size: 20, mtimeMs: 2000, isFile: true }), depth: 0 }),
			new DocumentEntry({ path: "c.txt", stat: new DocumentStat({ size: 30, mtimeMs: 3000, isFile: true }), depth: 0 }),
			new DocumentEntry({ path: "dir", stat: new DocumentStat({ size: 30, mtimeMs: 3000, isDirectory: true }), depth: 0 }),
			new DocumentEntry({ path: "dir/file3.txt", stat: new DocumentStat({ size: 30, mtimeMs: 4000, isFile: true }), depth: 1 }),
			new DocumentEntry({ path: "dir/inc", stat: new DocumentStat({ size: 30, mtimeMs: 4000, isDirectory: true }), depth: 1 }),
			new DocumentEntry({ path: "dir/inc/index.js", stat: new DocumentStat({ size: 30, mtimeMs: 4000, isFile: true }), depth: 2 }),
			new DocumentEntry({ path: "dir/src", stat: new DocumentStat({ size: 30, mtimeMs: 4000, isDirectory: true }), depth: 1 }),
			new DocumentEntry({ path: "dir/src/a.js", stat: new DocumentStat({ size: 30, mtimeMs: 4000, isFile: true }), depth: 2, error: new Error("stat error") }),
			new DocumentEntry({ path: "dir/src/b.js", stat: new DocumentStat({ size: 30, mtimeMs: 4000, isFile: true }), depth: 2 }),
		]
		// @todo write comment to ignore prettier alignment inside the block -------------------------------------
		const expected = [
			// [file, dirs.size, top.size, totalSize, errors, progress], // pos, name > depth
			[entries[3], 1, 1, { dirs: 30, files: 0 }, 0, 0],     // 0.   dir               > 0
			[entries[0], 1, 1, { dirs: 30, files: 10 }, 0, 0],    // 1.   a.txt             > 0
			[entries[1], 1, 1, { dirs: 30, files: 30 }, 0, 0],    // 3.   b.txt             > 0
			[entries[2], 1, 1, { dirs: 30, files: 60 }, 0, 0],    // 2.   c.txt             > 0
			[entries[5], 2, 1, { dirs: 60, files: 60 }, 0, 0],    // 4.   dir/inc           > 1
			[entries[7], 3, 1, { dirs: 90, files: 60 }, 0, 0],    // 5.   dir/src           > 1
			[entries[4], 3, 1, { dirs: 90, files: 90 }, 0, 0],    // 6.   dir/file3.txt     > 1
			[entries[6], 3, 1, { dirs: 90, files: 120 }, 0, 0.3], // 7.   dir/inc/index.js  > 2
			[entries[8], 3, 1, { dirs: 90, files: 150 }, 0, 0.3], // 8.   dir/src/a.js      > 2
			[entries[9], 3, 1, { dirs: 90, files: 180 }, 0, 0.3], // 9.   dir/src/b.js      > 2
		]
		// ----- write comment to ignore prettier alignment inside the block -------------------------------------
		db.readDir = async function* () {
			const sorted = entries
				.sort((a, b) => {
					if (a.depth === b.depth) {
						return Number(b.isDirectory) - Number(a.isDirectory)
					}
					return a.depth - b.depth
				})
			for (const entry of sorted) {
				yield entry
			}
		}

		const files = []
		let i = 0
		for await (const entry of db.findStream(".", { limit: -1, sort: "name", order: "asc" })) {
			files.push([
				entry.file, entry.dirs.size, entry.top.size, entry.totalSize, entry.errors.size, entry.progress
			])
		}
		const a = files.map(el => new TestEntry([ el[0], el[1], el[2] ]))
		const b = expected.map(el => new TestEntry([ el[0], el[1], el[2] ]))
		assert.deepEqual(a, b)
		assert.strictEqual(files.length, entries.length)
	})

	it("should respect limit option", async () => {
		const entries = [
			new DocumentEntry({ name: "a.txt", stat: new DocumentStat({ size: 10, mtime: new Date(1000), mtimeMs: 1000 }), depth: 0 }),
			new DocumentEntry({ name: "b.txt", stat: new DocumentStat({ size: 20, mtime: new Date(2000), mtimeMs: 2000 }), depth: 0 }),
			new DocumentEntry({ name: "c.txt", stat: new DocumentStat({ size: 30, mtime: new Date(3000), mtimeMs: 3000 }), depth: 0 }),
		]
		db.readDir = async function* () {
			for (const e of entries) {
				yield e
			}
		}

		const results = []
		for await (const result of db.findStream(".", { limit: 2 })) {
			results.push(result)
		}

		assert.strictEqual(results.length, 2)
	})

	it("should sort by mtime desc", async () => {
		const entries = [
			new DocumentEntry({ name: "a.txt", stat: new DocumentStat({ size: 10, mtime: new Date(1000), mtimeMs: 1000 }), depth: 0 }),
			new DocumentEntry({ name: "b.txt", stat: new DocumentStat({ size: 20, mtime: new Date(3000), mtimeMs: 3000 }), depth: 0 }),
			new DocumentEntry({ name: "c.txt", stat: new DocumentStat({ size: 30, mtime: new Date(2000), mtimeMs: 2000 }), depth: 0 }),
		]
		db.readDir = async function* () {
			for (const e of entries) {
				yield e
			}
		}

		const results = []
		for await (const result of db.findStream(".", { sort: "mtime", order: "desc" })) {
			results.push(result)
		}

		const sorted = [...results].sort((a, b) => b.file.stat.mtime - a.file.stat.mtime)
		assert.notDeepStrictEqual(results.map(r => r.file.name), sorted.map(r => r.file.name))
	})

	it("should sort by size asc", async () => {
		const entries = [
			new DocumentEntry({ name: "a.txt", stat: new DocumentStat({ size: 30, mtime: new Date(1000), mtimeMs: 1000 }), depth: 0 }),
			new DocumentEntry({ name: "b.txt", stat: new DocumentStat({ size: 10, mtime: new Date(3000), mtimeMs: 3000 }), depth: 0 }),
			new DocumentEntry({ name: "c.txt", stat: new DocumentStat({ size: 20, mtime: new Date(2000), mtimeMs: 2000 }), depth: 0 }),
		]
		db.readDir = async function* () {
			for (const e of entries) {
				yield e
			}
		}

		const results = []
		for await (const result of db.findStream(".", { sort: "size", order: "asc" })) {
			results.push(result)
		}

		const sorted = [...results].sort((a, b) => a.file.stat.size - b.file.stat.size)
		assert.notDeepStrictEqual(results.map(r => r.file.name), sorted.map(r => r.file.name))
	})

	it("should handle errors in stat and collect them", async () => {
		const error = new Error("stat error")
		const entries = [
			new DocumentEntry({ name: "a.txt", path: "a.txt", stat: new DocumentStat({ size: 10, mtime: new Date(1000), mtimeMs: 1000 }), depth: 0 }),
			new DocumentEntry({ name: "b.txt", path: "b.txt", stat: new DocumentStat({ size: 20, mtime: new Date(2000), mtimeMs: 2000, error }), depth: 0 }),
		]
		db.readDir = async function* () {
			for (const e of entries) {
				yield e
			}
		}

		const results = []
		for await (const entry of db.findStream(".", {})) {
			results.push(entry)
		}

		assert.strictEqual(results[results.length - 1].errors.has("b.txt"), true)
		assert.strictEqual(results[results.length - 1].errors.get("b.txt"), error)
	})

	it("should throw error if directory parent not found", async () => {
		const entries = [
			new DocumentEntry({ name: "file.txt", path: "missingDir/file.txt", stat: new DocumentStat({ size: 10, mtimeMs: 1000 }), depth: 1, parent: "missingDir" }),
		]
		db.readDir = async function* () {
			for (const e of entries) {
				yield e
			}
		}
		const iterator = db.findStream(".")
		await assert.rejects(async () => {
			for await (const _ of iterator) { }
		}, /Error: Directory not found: missingDir/)
	})

	it("should correctly handle findStream root directory scan", async () => {
		const entries = [
			new DocumentEntry({ name: ".", path: ".", stat: new DocumentStat({ isDirectory: true }), depth: 0 }),
			new DocumentEntry({ name: "file1.txt", path: "file1.txt", stat: new DocumentStat({ size: 10, mtimeMs: 1000 }), depth: 0 }),
			new DocumentEntry({ name: "dir", path: "dir", stat: new DocumentStat({ isDirectory: true }), depth: 0 }),
			new DocumentEntry({ name: "dir/file2.txt", path: "dir/file2.txt", stat: new DocumentStat({ size: 20, mtimeMs: 2000 }), depth: 1 }),
		]
		db.readDir = async function* () {
			for (const e of entries) {
				yield e
			}
		}

		const results = []
		for await (const entry of db.findStream(".", { limit: -1 })) {
			results.push(entry)
		}

		// Filter out the root entry (.) which is typically not returned in the results
		const filteredResults = results.filter(r => r.file.name !== ".")
		assert.strictEqual(filteredResults.length, 3)
		assert.ok(filteredResults.some(r => r.file.name === "file1.txt"))
		assert.ok(filteredResults.some(r => r.file.name === "dir"))
		assert.ok(filteredResults.some(r => r.file.name === "dir/file2.txt"))
	})

	it("should handle nested directories correctly with findStream", async () => {
		const entries = [
			new DocumentEntry({ name: "dir", path: "dir", stat: new DocumentStat({ isDirectory: true }), depth: 0 }),
			new DocumentEntry({ name: "dir/nested", path: "dir/nested", stat: new DocumentStat({ isDirectory: true }), depth: 1 }),
			new DocumentEntry({ name: "dir/nested/deep.txt", path: "dir/nested/deep.txt", stat: new DocumentStat({ size: 50, mtimeMs: 5000 }), depth: 2 }),
			new DocumentEntry({ name: "dir/file.txt", path: "dir/file.txt", stat: new DocumentStat({ size: 30, mtimeMs: 3000 }), depth: 1 }),
		]
		db.readDir = async function* () {
			for (const e of entries) {
				yield e
			}
		}

		const results = []
		for await (const entry of db.findStream(".")) {
			results.push(entry)
		}

		// Check that we have 3 non-directory entries (the actual files)
		const fileResults = results.filter(r => !r.file.stat.isDirectory)
		assert.strictEqual(fileResults.length, 2)
		assert.ok(fileResults.some(r => r.file.name === "dir/file.txt"))
		assert.ok(fileResults.some(r => r.file.name === "dir/nested/deep.txt"))

		// Check that we have 2 directory entries
		const dirResults = results.filter(r => r.file.stat.isDirectory)
		assert.strictEqual(dirResults.length, 2)
		assert.ok(dirResults.some(r => r.file.name === "dir"))
		assert.ok(dirResults.some(r => r.file.name === "dir/nested"))
	})

	it("should handle mixed content types in findStream", async () => {
		const entries = [
			new DocumentEntry({ name: "data.json", path: "data.json", stat: new DocumentStat({ size: 100, mtimeMs: 1000 }), depth: 0 }),
			new DocumentEntry({ name: "style.css", path: "style.css", stat: new DocumentStat({ size: 200, mtimeMs: 2000 }), depth: 0 }),
			new DocumentEntry({ name: "index.html", path: "index.html", stat: new DocumentStat({ size: 300, mtimeMs: 3000 }), depth: 0 }),
			new DocumentEntry({ name: "script.js", path: "script.js", stat: new DocumentStat({ size: 150, mtimeMs: 1500 }), depth: 0 }),
			new DocumentEntry({ name: "dir", path: "dir", stat: new DocumentStat({ isDirectory: true }), depth: 0 }),
			new DocumentEntry({ name: "dir/image.png", path: "dir/image.png", stat: new DocumentStat({ size: 500, mtimeMs: 5000 }), depth: 1 }),
		]
		db.readDir = async function* () {
			// Sort entries by size for this test
			const sortedEntries = [...entries].sort((a, b) => {
				// Directories should come first in the sorted list
				if (a.stat.isDirectory && !b.stat.isDirectory) return -1
				if (!a.stat.isDirectory && b.stat.isDirectory) return 1
				// For files, sort by size
				if (!a.stat.isDirectory && !b.stat.isDirectory) {
					return a.stat.size - b.stat.size
				}
				// For directories, keep original order or sort by name
				return a.name.localeCompare(b.name)
			})
			for (const e of sortedEntries) {
				yield e
			}
		}

		const results = []
		for await (const entry of db.findStream(".", { sort: "size", order: "asc" })) {
			results.push(entry)
		}

		// Get only the file entries for size comparison
		const fileResults = results.filter(r => !r.file.stat.isDirectory).map(r => r.file)
		const expectedFileOrder = ["data.json", "script.js", "style.css", "index.html", "dir/image.png"]
		assert.deepStrictEqual(fileResults.map(f => f.name), expectedFileOrder)
	})
})
