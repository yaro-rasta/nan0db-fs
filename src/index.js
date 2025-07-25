import { resolve, extname, relative } from "node:path"
import { appendFileSync, existsSync, mkdirSync, statSync, readdirSync, unlinkSync } from "node:fs"
import DB, { DocumentStat, DocumentEntry } from "@nanoweb/db"
import { load, save } from "nanoweb-fs"

class DBFS extends DB {
	/**
	 * @type {((file: string, data: any, ext: string) => any)[]}
	 */
	loaders = [
		(file, data) => load(file, data),
	]
	/**
	 * @type {((file: string, data: any, ext: string) => any)[]}
	 */
	savers = [
		(file, data, ext) => ".json" === ext ? save(file, data, null, 2) : false,
		(file, data) => save(file, data),
	]
	/**
	 * Creates a new DBFS instance with a subset of the data and meta.
	 * @param {string} uri The URI to extract from the current DB.
	 * @returns {DBFS}
	 */
	extract(uri) {
		return super.extract(uri)
	}
	/**
	 * @param {string} uri The URI to get the extension from.
	 * @returns {string} The extension.
	 */
	extname(uri) {
		return extname(uri)
	}
	/**
	 * In case of web requests function is async.
	 * @param {...string} args The arguments to resolve.
	 * @returns {Promise<string>} The resolved path.
	 */
	async resolve(...args) {
		const root = this.root.endsWith("/") ? this.root.slice(0, -1) : this.root
		return new Promise((res) => {
			const result = resolve(...[root, ...args])
			res(result)
		})
	}
	/**
	 * @param {string} from The path to resolve from.
	 * @param {string} to The path to resolve to.
	 * @returns {string} The relative path.
	 */
	relative(from, to) {
		return relative(from, to)
	}
	/**
	 * Returns the stat of the document, uses meta (cache) if available.
	 * @throws {Error} If the document cannot be stat.
	 * @param {string} uri The URI to stat the document from.
	 * @returns {Promise<DocumentStat>} The document stat.
	 */
	async stat(uri) {
		return super.stat(uri)
	}
	/**
	 * Returns the stat of the document without meta (cache) check.
	 * ```
	 * NO ACCESS CHECK!
	 * ```
	 * @param {string} uri The URI to stat the document from.
	 * @returns {Promise<DocumentStat>} The document stat.
	 */
	async statDocument(uri) {
		const file = await this.resolve(uri)
		return new DocumentStat(existsSync(file) ? statSync(file) : {})
	}
	/**
	 * @param {string} uri The URI to load the document from.
	 * @param {any} defaultValue The default value to return if the document does not exist.
	 * @returns {Promise<any>} The loaded document.
	 */
	async loadDocument(uri, defaultValue = "") {
		await this.ensureAccess(uri, "r")
		const file = await this.resolve(uri)
		if (!existsSync(file)) return defaultValue
		return load(file)
	}
	/**
	 * @param {string} uri The URI to build the path for.
	 * @returns {Promise<void>}
	 */
	async _buildPath(uri) {
		const dir = await this.resolve(uri, "..")
		mkdirSync(dir, { recursive: true })
	}
	/**
	 * @throws {Error} If the document cannot be saved.
	 * @param {string} uri The URI to save the document to.
	 * @param {any} document The document to save.
	 * @returns {Promise<boolean>} True if saved, false otherwise
	 */
	async saveDocument(uri, document) {
		await this.ensureAccess(uri, "w")
		await this._buildPath(uri)
		const file = await this.resolve(uri)
		const ext = this.extname(uri)
		for (const saver of this.savers) {
			if (false !== saver(file, document, ext)) return true
		}
		return false
	}
	/**
	 * @throws {Error} If the document cannot be written.
	 * @param {string} uri The URI to write the document to.
	 * @param {string} chunk The chunk to write.
	 * @returns {Promise<boolean>} True if written, false otherwise
	 */
	async writeDocument(uri, chunk) {
		await this.ensureAccess(uri, "w")
		await this._buildPath(uri)
		const file = await this.resolve(uri)
		appendFileSync(file, chunk, this.encoding)
		return true
	}
	/**
	 * @throws {Error} If the document cannot be dropped.
	 * @param {string} uri The URI to drop the document from.
	 * @returns {Promise<boolean>} True if dropped, false otherwise
	 */
	async dropDocument(uri) {
		await this.ensureAccess(uri, "d")
		const file = await this.resolve(uri)
		let stat = await this.statDocument(uri)
		if (!stat.exists) return false
		unlinkSync(file)
		stat = await this.statDocument(uri)
		return !stat.exists
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
