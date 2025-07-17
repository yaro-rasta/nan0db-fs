#!/usr/bin/env node
import { stdout } from "node:process"
import DBFS, { DocumentEntry } from "../src/index.js"
import { extname } from "node:path"

async function main(argv = []) {
	const root = argv[0] || "."
	const db = new DBFS({ root })
	await db.connect()

	/** @type {DocumentEntry[]} */
	let files = []
	let prev = []
	let ram = []
	const checkpoint = Date.now()

	function renderProgress(entry, groups) {
		const [width] = stdout.getWindowSize()
		const recent = files[files.length - 1]
		const elapsed = Date.now() - checkpoint
		ram.push(process.memoryUsage().heapUsed)
		const avgRam = ram.reduce((a, b) => a + b, 0) / ram.length
		let str = [
			files.length.toLocaleString(),
			// "found",
			"[" + elapsed.toLocaleString(), "ms]",
			"[" + (entry.totalSize.dirs / 1024 / 1024).toFixed(2), "Mb /",
			(entry.totalSize.files / 1024 / 1024).toFixed(2), "Mb]",
			"[" + `${parseInt(avgRam / 1024 / 1024).toLocaleString()}`, "Mb RAM]",
			"[!" + entry.errors.size + "]",
			"(" + entry.file.path + ")",
			// `${(entry.progress * 100).toFixed(2)}%`,
			// "fulfilled",
		].join(" ")
		if (str.length > width) str = str.slice(0, width - 3) + "..."
		const frame = []
		frame.push("\r\n" + str + " ".repeat(Math.max(0, String(prev[0] ?? "").trim().length - str.length)))
		const groupEntries = Object.entries(groups)
		// const rows = groupEntries.length + 1
		for (const [name, size] of groupEntries) {
			frame.push(`\r\n${name}: ${(size / 1024 / 1024).toFixed(2)} Mb     `)
		}
		stdout.write(`\x1b[${prev.length}A` + frame.join(""))
		prev = frame
	}

	const groups = {
		git: entry => `./${entry.file}`.includes("/.git/"),
		bin: entry => `./${entry.file}`.includes("/bin/"),
		node: entry => `./${entry.file}`.includes("/node_modules/"),
		images: entry => [".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp"].includes(extname(entry.file.name).toLocaleLowerCase()),
		"> 100G": entry => entry.file.stat.size > 1024 * 1024 * 1024 * 100,
		"> 10G": entry => entry.file.stat.size > 1024 * 1024 * 1024 * 10,
		"> 1G": entry => entry.file.stat.size > 1024 * 1024 * 1024,
		"> 100M": entry => entry.file.stat.size > 100 * 1024 * 1024,
	}
	const groupStats = {}

	stdout.write("root: " + root + "\n")

	const options = { limit: -1, sort: "name", order: "desc", skipStat: false, skipSymbolicLink: false }
	for await (const entry of db.findStream(root, options)) {
		files.push(entry.file)
		for (const [name, filter] of Object.entries(groups)) {
			if (filter(entry)) {
				if (!groupStats[name]) groupStats[name] = 0
				groupStats[name] += entry.file.stat.size
			}
		}
		renderProgress(entry, groupStats)
	}

	const { errors } = files.pop()
	stdout.write("\n")
	for (const error of errors) {
		stdout.write(`${error.file.name}: ${error.message}\n`)
	}

	stdout.write("\nDone.\n")
	await db.disconnect()
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main(process.argv.slice(2)).catch((e) => {
		console.error(e)
		process.exit(1)
	})
}
