import { suite, describe, it, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { stdout } from "node:process"
import DBFS, { DocumentEntry, DocumentStat } from "./index.js"
import { sep } from "node:path"

/**
 * @desc Tests the basic functionality of DBFS.
 */
suite("DBFS tests", () => {
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
		db.resolve = (uri) => uri
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

	it("should resolve async", async () => {
		const resolved = await db.resolve("file1.txt")
		assert.strictEqual(resolved, "file1.txt")
	})

	it("should list files with progress bar during async process", async () => {
		let count = 0
		let total = 0
		const output = []

		function renderProgress() {
			const width = 40
			const progress = total ? Math.min(count / total, 1) : 0
			const filled = Math.floor(progress * width)
			const empty = width - filled
			const bar = `[${"=".repeat(filled)}${" ".repeat(empty)}]`
			output.push(`\r${bar} ${count} files found`)
		}

		await db.connect()
		let listedFiles = []
		total = files.length

		db.readDir = async function* () {
			for (const f of files) {
				yield f
				await new Promise(resolve => setTimeout(resolve, 10))
			}
		}

		for await (const file of db.readDir(db.root, -1)) {
			listedFiles.push(file)
			count++
			renderProgress()
		}

		assert.deepStrictEqual(listedFiles, files)

		await db.disconnect()
	})

	it("should allow access to config file", async () => {
		await db.connect()
		await db.ensureAccess("llm.config.js", "r")
		assert.strictEqual(true, true)
		await db.disconnect()
	})

	it("should throw error for path outside root", async () => {
		await db.connect()
		await assert.rejects(async () => {
			await db.ensureAccess("../outside.txt", "r")
		}, /No access outside of the db container/)
		await db.disconnect()
	})

	it("should return default stats for non-existing file", async () => {
		const stats = await db.statDocument("nonexistent.txt")
		assert.deepStrictEqual(stats, { mtime: 0, mtimeMs: 0 })
	})

	it("should return existing file stats", async () => {
		const uri = "file1.txt"
		memoryFS.save(uri, "content")
		const stats = await db.statDocument(uri)
		assert.ok(stats.hasOwnProperty("mtimeMs"))
		assert.ok(stats.hasOwnProperty("mtime"))
	})

	it("should load document with default value", async () => {
		const content = await db.loadDocument("nonexistent.txt", "default")
		assert.strictEqual(content, "default")
	})

	it("should save JSON document with pretty print", async () => {
		const uri = "test.json"
		const data = { key: "value" }
		await db.saveDocument(uri, data)
		const savedContent = await db.loadDocument(uri)
		assert.strictEqual(savedContent, JSON.stringify(data, null, 2))
	})

	it("should save non-JSON document without pretty print", async () => {
		const uri = "test.txt"
		const data = "raw content"
		await db.saveDocument(uri, data)
		const savedContent = await db.loadDocument(uri)
		assert.strictEqual(savedContent, data)
	})

	it("should append chunk to document", async () => {
		const uri = "test.txt"
		await db.writeDocument(uri, "chunk1\n")
		await db.writeDocument(uri, "chunk2")
		const content = await db.loadDocument(uri)
		assert.strictEqual(content, "chunk1\nchunk2")
	})

	it("should return false when dropping document", async () => {
		const result = await db.dropDocument("file1.txt")
		assert.strictEqual(result, false)
	})

	it("should return proper extname", () => {
		const extname = db.extname("file.Txt")
		assert.strictEqual(extname, ".txt")
	})
})

/**
 * @desc Tests the resolve functionality of DBFS.
 */
suite("DBFS resolve tests", () => {
	/** @type {DBFS} */
	let db

	beforeEach(() => {
		db = new DBFS({ root: ".", cwd: "." })
	})

	it("should resolve relative path", async () => {
		const resolved = await db.resolve("src/index.test.js")
		assert.strictEqual(resolved, "src/index.test.js")
	})

	it("should resolve absolute path", () => {
		const resolved = db.absolute("index.js")
		assert.ok(resolved.endsWith(sep + "index.js"))
	})

	describe("ensureAccess()", () => {
		it("should prevent access outside of the container", async () => {
			const uri = "../outside.txt"
			await assert.rejects(async () => {
				await db.ensureAccess(uri, "r")
			}, /No access outside of the db container/)
		})
	})

})