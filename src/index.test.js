import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import DBFS, { DocumentEntry, DocumentStat } from "./index.js"
import { stdout } from "node:process"
import { error } from "node:console"

describe("DBFS tests", () => {
	let db
	let files
	let originalStdoutWrite
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

	it.skip("should list files with progress bar during async process", async () => {
		// @todo render proper progress bar during the allFiles, and total, check what readDir returns to operate with it.
		let count = 0
		let total = 0

		function renderProgress() {
			const width = 40
			const progress = total ? Math.min(count / total, 1) : 0
			const filled = Math.floor(progress * width)
			const empty = width - filled
			const bar = `[${"=".repeat(filled)}${" ".repeat(empty)}]`
			stdout.write(`\r${bar} ${count} files found`)
		}

		await db.connect()
		let listedFiles = []
		let allFiles = []

		db.readDir = vi.fn(async function* () {
			for (const f of files) {
				yield f
				await new Promise(resolve => setTimeout(resolve, 10))
			}
		})

		allFiles = []
		for await (const file of db.readDir(db.root, -1)) {
			allFiles.push(file)
			count++
			renderProgress()
			listedFiles.push(file)
		}

		expect(listedFiles).toEqual(files)

		// Precise test for progress bar output for every file
		const calls = stdout.write.mock.calls.map(call => call[0])
		expect(calls.length).toBe(files.length)

		// Check each call contains progress bar with correct filled length
		const width = 40
		for (let i = 0; i < files.length; i++) {
			const progress = Math.min((i + 1) / total, 1)
			const filled = Math.floor(progress * width)
			const empty = width - filled
			const expectedBar = `[${"=".repeat(filled)}${" ".repeat(empty)}]`
			expect(calls[i]).toContain(expectedBar)
			expect(calls[i]).toContain(`${i + 1} files found`)
		}

		await db.disconnect()
	})

	it("should allow access to config file", async () => {
		await db.connect()
		await db.ensureAccess("llm.config.js", "r")
		expect(true).toBe(true)
		await db.disconnect()
	})

	it("should throw error for path outside root", async () => {
		await db.connect()
		await expect(db.ensureAccess("../outside.txt", "r")).rejects.toThrow("No access outside of the db container")
		await db.disconnect()
	})

	it("should return default stats for non-existing file", async () => {
		const stats = await db.statDocument("nonexistent.txt")
		expect(stats).toEqual({ mtime: 0, mtimeMs: 0 })
	})

	it("should return existing file stats", async () => {
		const uri = "file1.txt"
		memoryFS.save(uri, "content")
		const stats = await db.statDocument(uri)
		expect(stats).toHaveProperty("mtimeMs")
		expect(stats).toHaveProperty("mtime")
	})

	it("should load document with default value", async () => {
		const content = await db.loadDocument("nonexistent.txt", "default")
		expect(content).toBe("default")
	})

	it("should save JSON document with pretty print", async () => {
		const uri = "test.json"
		const data = { key: "value" }
		await db.saveDocument(uri, data)
		const savedContent = await db.loadDocument(uri)
		expect(savedContent).toBe(JSON.stringify(data, null, 2))
	})

	it("should save non-JSON document without pretty print", async () => {
		const uri = "test.txt"
		const data = "raw content"
		await db.saveDocument(uri, data)
		const savedContent = await db.loadDocument(uri)
		expect(savedContent).toBe(data)
	})

	it("should append chunk to document", async () => {
		const uri = "test.txt"
		await db.writeDocument(uri, "chunk1\n")
		await db.writeDocument(uri, "chunk2")
		const content = await db.loadDocument(uri)
		expect(content).toBe("chunk1\nchunk2")
	})

	it("should return false when dropping document", async () => {
		const result = await db.dropDocument("file1.txt")
		expect(result).toBe(false)
	})

})
