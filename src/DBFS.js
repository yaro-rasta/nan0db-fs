import { resolve, extname, relative, sep } from "node:path"
import { appendFileSync, existsSync, mkdirSync, statSync, readdirSync, unlinkSync, rmdirSync } from "node:fs"
import DB, { DocumentStat, DocumentEntry } from "@nanoweb/db"
import { load, loadFile, save } from "nanoweb-fs"

class DBFS extends DB {
	/**
	 * @type {((file: string, data: any, ext: string) => any)[]}
	 */
	loaders = [
		(file, ext) => ".txt" === ext ? loadFile(file, "") : false,
		(file) => load(file),
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
	 * @returns {string} The extension in lowercase.
	 */
	extname(uri) {
		return extname(uri).toLowerCase()
	}
	/**
	 * @param {...string} args The arguments to resolve.
	 * @returns {Promise<string>} The resolved absolute path.
	 */
	resolve(...args) {
		const root = this.absolute()
		const path = this.absolute(...args)
		return this.relative(root, path)
	}
	/**
	 * Returns the absolute path of the resolved path.
	 * @param  {...string[]} args The arguments to resolve.
	 * @return {string} The resolved absolute path.
	 */
	absolute(...args) {
		const root = this.root.endsWith("/") ? this.root.slice(0, -1) : this.root
		return DBFS.winFix(resolve(...[this.cwd, root, ...args]))
	}
	/**
	 * @param {string} from The path to resolve from.
	 * @param {string} to The path to resolve to.
	 * @returns {string} The relative path.
	 */
	relative(from, to) {
		return DBFS.winFix(relative(from, to))
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
		const path = resolve(this.cwd, this.root, file)
		return new DocumentStat(existsSync(path) ? statSync(path) : {})
	}
	/**
	 * @param {string} uri The URI to load the document from.
	 * @param {any} defaultValue The default value to return if the document does not exist.
	 * @returns {Promise<any>} The loaded document.
	 */
	async loadDocument(uri, defaultValue = "") {
		await this.ensureAccess(uri, "r")
		const file = await this.resolve(uri)
		const path = resolve(this.cwd, this.root, file)
		if (!existsSync(path)) return defaultValue
		const ext = this.extname(uri)
		for (const loader of this.loaders) {
			const res = loader(path, ext)
			if (false !== res) {
				return res
			}
		}
		return false
	}
	/**
	 * @param {string} uri The URI to build the path for.
	 * @returns {Promise<void>}
	 */
	async _buildPath(uri) {
		const dir = await this.resolve(uri, "..")
		const path = resolve(this.cwd, this.root, dir)
		mkdirSync(path, { recursive: true })
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
		const path = resolve(this.cwd, this.root, file)
		const ext = this.extname(uri)
		for (const saver of this.savers) {
			if (false !== saver(path, document, ext)) {
				const stat = await this.statDocument(uri)
				this.meta.set(uri, stat)
				this.data.set(uri, false)
				return true
			}
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
		const path = resolve(this.cwd, this.root, file)
		appendFileSync(path, chunk, this.encoding)
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
		const path = resolve(this.cwd, this.root, file)
		if (stat.isDirectory) {
			const nested = Array.from(this.meta.keys()).filter(u => u.startsWith(file + "/")).length
			if (nested > 0) {
				throw new Error("Directory has children, delete them first")
			}
			rmdirSync(path)
			this.meta.delete(file)
			this.data.delete(file)
			return true
		}
		unlinkSync(path)
		stat = await this.statDocument(uri)
		if (!stat.exists) {
			this.data.delete(file)
			this.meta.delete(file)
		}
		return !stat.exists
	}
	async ensureAccess(uri, level = "r") {
		await super.ensureAccess(uri, level)
		const path = await this.resolve(uri)
		if (uri.endsWith("/llm.config.js")) {
			/** @note load config file from anywhere */
			return true
		}
		if (path.startsWith("..")) {
			throw new Error("No access outside of the db container")
		}
		return true
	}

	async listDir(uri, { depth = 0, skipStat = false } = {}) {
		const path = resolve(this.root, uri)
		const entries = readdirSync(path, { withFileTypes: true })
		const files = entries.map((entry) => {
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
		files.sort((a, b) => Number(b.stat.isDirectory) - Number(a.stat.isDirectory))
		return files
	}

	static winFix(path) {
		return "/" === sep ? path : path.replaceAll(sep, "/")
	}
}

export default DBFS
