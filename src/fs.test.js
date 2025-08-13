import { suite, it, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import DBFS from "./index.js"
import path, { sep } from "node:path"

/**
 * @desc Tests the complete file lifecycle: save, load, write, drop.
 */
suite("File lifecycle tests", () => {
	/** @type {DBFS} */
	let db
	const cwd = process.cwd()
	const testRoot = path.join(cwd, "__test_fs__")

	const mockRoot = "__mock_fs__"

	beforeEach(() => {
		// Reset root for each test
		db = new DBFS({ root: "__test_fs__", cwd: process.cwd() })
	})

	afterEach(() => {
		try {
			if (typeof db.disconnect === "function") db.disconnect()
		} catch (err) {
			console.error("Error in disconnect:", err.message)
		}
	})

	it("should resolve relative file within root boundary", async () => {
		db.cwd = mockRoot
		db.root = path.join("private")

		const resolved = await db.resolve("test.txt")
		assert.strictEqual(resolved, "test.txt", "Should resolve file within root without duplication")
	})

	it("should create and read files with correct formatting", async () => {
		const data = { name: "Alice", age: 30 }
		const expectedOutput = JSON.stringify(data, null, 2)

		await db.saveDocument("users/user1.json", data)
		await db.writeDocument("logs/greet.txt", "Hello World\n")
		await db.writeDocument("logs/greet.txt", "Goodbye")

		const user = await db.loadDocument("users/user1.json")
		const greet = await db.loadDocument("logs/greet.txt")
		await db.dropDocument("users/user1.json")
		await db.dropDocument("logs/greet.txt")

		assert.strictEqual(JSON.stringify(user, null, 2), expectedOutput)
		assert.strictEqual(greet, "Hello World\nGoodbye")
	})

	it("should build directory structure automatically", async () => {
		await db.saveDocument("modules/utils/handlers/validator.js", "const a = 'dummy content'")

		const files = Array.from(db.meta.keys()).sort()
		assert.deepStrictEqual(
			files,
			[
				DBFS.winFix(path.join(testRoot, "modules", "utils", "handlers", "validator.js"))
			].map(file => DBFS.winFix(file.replace(testRoot + sep, "")))
		)
	})

	const expected = [
		[["private/test.txt"], "private/test.txt"],
		[["private", "test.txt"], "private/test.txt"],
		[["a", "b", "c.txt"], "a/b/c.txt"],
		[["../../", "var", "www"], "../../var/www"]
	]

	for (const [args, exp] of expected) {
		it(`should resolve [${args}] => ${exp}`, async () => {
			const resolved = await db.resolve(...args)
			assert.equal(resolved, exp)
		})
	}

	it("should properly handle root as subdirectory", async () => {
		db.cwd = mockRoot
		db.root = "testfs/"

		const resolved = await db.resolve("data/file.json")
		const abs = db.absolute("data/file.json")
		assert.ok(abs.endsWith("/testfs/data/file.json"))
	})
})
