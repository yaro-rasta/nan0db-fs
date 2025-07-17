import { resolve, extname, relative } from "node:path"
import { appendFileSync, existsSync, mkdirSync, statSync, readdirSync } from "node:fs"
import DB, { DocumentStat, DocumentEntry } from "@nanoweb/db"
import { load, save } from "nanoweb-fs"

class DBFS extends DB {
	extname(uri) {
		return extname(uri)
	}
	async resolve(...args) {
		return resolve(...[this.root, ...args])
	}
	relative(from, to) {
		return relative(from, to)
	}
	async statDocument(uri) {
		const file = await this.resolve(uri)
		return existsSync(file) ? statSync(file) : { mtime: 0, mtimeMs: 0 }
	}
	async loadDocument(uri, defaultValue = "") {
		await this.ensureAccess(uri, "r")
		if (!existsSync(uri)) return defaultValue
		const file = await this.resolve(uri)
		return load(file)
	}
	async _buildPath(uri) {
		const dir = await this.resolve(uri, "..")
		mkdirSync(dir, { recursive: true })
	}
	async saveDocument(uri, document) {
		await this.ensureAccess(uri, "w")
		await this._buildPath(uri)
		const args = []
		if (uri.endsWith(".json")) {
			args.push(null)
			args.push(2)
		}
		const file = await this.resolve(uri)
		return save(file, document, ...args)
	}
	async writeDocument(uri, chunk) {
		await this.ensureAccess(uri, "w")
		await this._buildPath(uri)
		const file = await this.resolve(uri)
		appendFileSync(file, chunk, this.encoding)
		return true
	}
	async dropDocument(uri) {
		await this.ensureAccess(uri, "d")
		return false
	}
	async ensureAccess(uri, level = "r") {
		await super.ensureAccess(uri, level)
		const path = await this.resolve(uri)
		const rel = this.relative(this.root, path)
		if (uri.endsWith("/llm.config.js")) {
			/** @note load config file from anywhere */
			return true
		}
		if (rel.startsWith("..")) {
			throw new Error("No access outside of the db container")
		}
		return true
	}

	async listDir(uri, { depth = 0, skipStat = false } = {}) {
		const path = resolve(this.root, uri)
		const entries = readdirSync(path, { withFileTypes: true })
		return entries.map((entry) => {
			let stat = entry
			if (!skipStat) {
				try {
					stat = statSync(resolve(path, entry.name))
				} catch (err) {
					stat.error = err
				}
			}
			return new DocumentEntry({
				stat: new DocumentStat(stat),
				name: entry.name,
				depth,
			})
		})
	}
}

export { DBFS, DocumentEntry, DocumentStat }

export default DBFS
