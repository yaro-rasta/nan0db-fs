import { suite, it, beforeEach } from "node:test"
import assert from "node:assert/strict"
import DBFS from "./index.js"

suite("DBFS async resolve tests", () => {
	/** @type {DBFS} */
	let db

	beforeEach(() => {
		db = new DBFS({ root: "." })
	})

	it("should resolve async", async () => {
		const resolved = await db.resolve("file1.txt")
		assert.strictEqual(resolved, "file1.txt")
	})
	it("should not resolve return promise anymore", () => {
		const resolved = db.resolve("file1.txt")
		assert.ok(!(resolved instanceof Promise))
	})
})
