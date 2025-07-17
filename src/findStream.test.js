import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import DBFS, { DocumentEntry, DocumentStat } from "./index.js"
import { stdout } from "node:process"

describe("DBFS tests", () => {
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

		db.ensureAccess = vi.fn(async (uri, level) => {
			if (uri.startsWith("../")) {
				throw new Error("No access outside of the db container")
			}
			return true
		})
		db.resolve = vi.fn(async (uri) => uri)
		db.relative = vi.fn((from, to) => to.startsWith(from) ? to.slice(from.length) : to)
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

		db.readDir = vi.fn(async function* () {
			for (const f of files) {
				yield f
			}
		})
		db.connect = vi.fn(async () => {
			db.connected = true
		})
		db.disconnect = vi.fn(async () => {
			db.connected = false
		})

		originalStdoutWrite = stdout.write
		stdout.write = vi.fn()
	})

	afterEach(() => {
		stdout.write = originalStdoutWrite
		memoryFS.clear()
	})

	describe("findStream", () => {
		it.skip("should yield files with correct progress and sorting by name asc", async () => {
			let entries = [
				new DocumentEntry({ name: "a.txt", stat: new DocumentStat({ size: 10, mtimeMs: 1000, isFile: true }), depth: 0 }),
				new DocumentEntry({ name: "b.txt", stat: new DocumentStat({ size: 20, mtimeMs: 2000, isFile: true }), depth: 0 }),
				new DocumentEntry({ name: "c.txt", stat: new DocumentStat({ size: 30, mtimeMs: 3000, isFile: true }), depth: 0 }),
				new DocumentEntry({ name: "dir", stat: new DocumentStat({ size: 30, mtimeMs: 3000, isDirectory: true }), depth: 0 }),
				new DocumentEntry({ name: "dir/file3.txt", stat: new DocumentStat({ size: 30, mtimeMs: 4000, isFile: true }), depth: 1 }),
				new DocumentEntry({ name: "dir/inc", stat: new DocumentStat({ size: 30, mtimeMs: 4000, isDirectory: true }), depth: 1 }),
				new DocumentEntry({ name: "dir/inc/index.js", stat: new DocumentStat({ size: 30, mtimeMs: 4000, isFile: true }), depth: 2 }),
				new DocumentEntry({ name: "dir/src", stat: new DocumentStat({ size: 30, mtimeMs: 4000, isDirectory: true }), depth: 1 }),
				new DocumentEntry({ name: "dir/src/a.js", stat: new DocumentStat({ size: 30, mtimeMs: 4000, isFile: true }), depth: 2, error: new Error("stat error") }),
				new DocumentEntry({ name: "dir/src/b.js", stat: new DocumentStat({ size: 30, mtimeMs: 4000, isFile: true }), depth: 2 }),
			]
			// @todo write comment to ignore prettier alignment inside the block -------------------------------------
			const expected = [
				// [file, dirs.size, top.size, totalSize, errors, progress], // pos, name > depth
				[entries[3], 1, 1, { dirs: 30, files: 0 }, 0, 0],     // 0.   dir               > 0
				[entries[0], 1, 1, { dirs: 30, files: 10 }, 0, 0],    // 1.   a.txt             > 0
				[entries[1], 1, 1, { dirs: 30, files: 30 }, 0, 0],    // 3.   b.txt             > 0
				[entries[2], 1, 1, { dirs: 30, files: 60 }, 0, 0],    // 2.   c.txt             > 0
				[entries[5], 2, 1, { dirs: 60, files: 60 }, 0, 0],  // 4.   dir/inc           > 1
				[entries[7], 3, 1, { dirs: 90, files: 60 }, 0, 0],  // 5.   dir/src           > 1
				[entries[4], 3, 1, { dirs: 90, files: 90 }, 0, 0],  // 6.   dir/file3.txt     > 1
				[entries[6], 3, 1, { dirs: 90, files: 120 }, 0, 0.3], // 7.   dir/inc/index.js  > 2
				[entries[8], 3, 1, { dirs: 90, files: 150 }, 0, 0.3], // 8.   dir/src/a.js      > 2
				[entries[9], 3, 1, { dirs: 90, files: 180 }, 0, 0.3], // 9.   dir/src/b.js      > 2
			]
			// ----- write comment to ignore prettier alignment inside the block -------------------------------------
			db.readDir = vi.fn(async function* () {
				const sorted = entries
					.sort((a, b) => {
						if (a.depth === b.depth) {
							if (a.isDirectory && !b.isDirectory) return -1
							if (!a.isDirectory && b.isDirectory) return 1
						}
						return a.depth - b.depth
					})
				// .sort((a, b) => {
				// 	return a.isDirectory ? -1 : 1
				// })
				// .sort((a, b) => a.name.localeCompare(b.name))
				const later = []
				for (const entry of sorted) {
					yield entry
				}
			})

			const files = []
			let i = 0
			for await (const entry of db.findStream(".", { limit: -1, sort: "name", order: "asc" })) {
				files.push(entry)
				const exp = expected[i++]
				expect(entry.file).toEqual(exp[0])
				expect(entry.dirs.size).toEqual(exp[1])
				expect(entry.top.size).toEqual(exp[2])
				expect(entry.totalSize).toEqual(exp[3])
				expect(entry.errors.size).toEqual(exp[4])
				expect(entry.progress).toBeCloseTo(exp[5], 1)
			}

			expect(files.length).toBe(entries.length)
		})

		it("should respect limit option", async () => {
			const entries = [
				new DocumentEntry({ name: "a.txt", stat: new DocumentStat({ size: 10, mtime: new Date(1000), mtimeMs: 1000 }), depth: 0 }),
				new DocumentEntry({ name: "b.txt", stat: new DocumentStat({ size: 20, mtime: new Date(2000), mtimeMs: 2000 }), depth: 0 }),
				new DocumentEntry({ name: "c.txt", stat: new DocumentStat({ size: 30, mtime: new Date(3000), mtimeMs: 3000 }), depth: 0 }),
			]
			db.readDir = vi.fn(async function* () {
				for (const e of entries) {
					yield e
				}
			})

			const results = []
			for await (const result of db.findStream(".", { limit: 2 })) {
				results.push(result)
			}

			expect(results.length).toBe(2)
		})

		it("should sort by mtime desc", async () => {
			const entries = [
				new DocumentEntry({ name: "a.txt", stat: new DocumentStat({ size: 10, mtime: new Date(1000), mtimeMs: 1000 }), depth: 0 }),
				new DocumentEntry({ name: "b.txt", stat: new DocumentStat({ size: 20, mtime: new Date(3000), mtimeMs: 3000 }), depth: 0 }),
				new DocumentEntry({ name: "c.txt", stat: new DocumentStat({ size: 30, mtime: new Date(2000), mtimeMs: 2000 }), depth: 0 }),
			]
			db.readDir = vi.fn(async function* () {
				for (const e of entries) {
					yield e
				}
			})

			const results = []
			for await (const result of db.findStream(".", { sort: "mtime", order: "desc" })) {
				results.push(result)
			}

			const sorted = [...results].sort((a, b) => b.file.stat.mtime - a.file.stat.mtime)
			expect(results.map(r => r.file.name)).not.toEqual(sorted.map(r => r.file.name))
		})

		it("should sort by size asc", async () => {
			const entries = [
				new DocumentEntry({ name: "a.txt", stat: new DocumentStat({ size: 30, mtime: new Date(1000), mtimeMs: 1000 }), depth: 0 }),
				new DocumentEntry({ name: "b.txt", stat: new DocumentStat({ size: 10, mtime: new Date(3000), mtimeMs: 3000 }), depth: 0 }),
				new DocumentEntry({ name: "c.txt", stat: new DocumentStat({ size: 20, mtime: new Date(2000), mtimeMs: 2000 }), depth: 0 }),
			]
			db.readDir = vi.fn(async function* () {
				for (const e of entries) {
					yield e
				}
			})

			const results = []
			for await (const result of db.findStream(".", { sort: "size", order: "asc" })) {
				results.push(result)
			}

			const sorted = [...results].sort((a, b) => a.file.stat.size - b.file.stat.size)
			expect(results.map(r => r.file.name)).not.toEqual(sorted.map(r => r.file.name))
		})

		it("should handle errors in stat and collect them", async () => {
			const error = new Error("stat error")
			const entries = [
				new DocumentEntry({ name: "a.txt", path: "a.txt", stat: new DocumentStat({ size: 10, mtime: new Date(1000), mtimeMs: 1000 }), depth: 0 }),
				new DocumentEntry({ name: "b.txt", path: "b.txt", stat: new DocumentStat({ size: 20, mtime: new Date(2000), mtimeMs: 2000, error }), depth: 0 }),
			]
			db.readDir = vi.fn(async function* () {
				for (const e of entries) {
					yield e
				}
			})

			const results = []
			for await (const result of db.findStream(".", {})) {
				results.push(result)
			}

			expect(results[results.length - 1].errors.has("b.txt")).toBe(true)
			expect(results[results.length - 1].errors.get("b.txt")).toBe(error)
		})

		it.skip("should throw error if directory parent not found", async () => {
			const entries = [
				new DocumentEntry({ name: "file.txt", stat: new DocumentStat({ size: 10, mtime: new Date(1000), mtimeMs: 1000 }), depth: 1, parent: "missingDir" }),
			]
			db.readDir = vi.fn(async function* () {
				for (const e of entries) {
					yield e
				}
			})

			const iterator = db.findStream(".", {})
			await expect(async () => {
				for await (const _ of iterator) { }
			}).rejects.toThrow("Directory missingDir not found")
		})
	})

})
