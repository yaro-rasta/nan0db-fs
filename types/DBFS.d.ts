export default DBFS;
declare class DBFS extends DB {
    /**
     * Creates a DocumentStat instance from fs.Stats.
     * @param {import("node:fs").Stats} stats The fs.Stats object.
     * @returns {DocumentStat} A new DocumentStat instance.
     */
    static createDocumentStatFrom(stats: import("node:fs").Stats): DocumentStat;
    /**
     * Fixes path separators for Windows systems.
     * @param {string} path The path to fix.
     * @returns {string} The path with forward slashes.
     */
    static winFix(path: string): string;
    /**
     * Creates a DBFS instance from input parameters.
     * @param {object} input The input parameters for DBFS.
     * @returns {DBFS} A new or existing DBFS instance.
     */
    static from(input: object): DBFS;
    /**
     * Array of loader functions that attempt to load data from a file path.
     * Each loader returns false if it cannot handle the data format.
     * @type {((file: string, data: any, ext: string) => any)[]}
     */
    loaders: ((file: string, data: any, ext: string) => any)[];
    /**
     * Array of saver functions that attempt to save data to a file path.
     * Each saver returns false if it cannot handle the data format.
     * @type {((file: string, data: any, ext: string) => any)[]}
     */
    savers: ((file: string, data: any, ext: string) => any)[];
    /**
     * Creates a new DBFS instance with a subset of the data and meta.
     * @param {string} uri The URI to extract from the current DB.
     * @returns {DBFS} A new DBFS instance with extracted data.
     */
    extract(uri: string): DBFS;
    /**
     * Returns the stat of the document, uses meta (cache) if available.
     * @throws {Error} If the document cannot be stat.
     * @param {string} uri The URI to stat the document from.
     * @returns {Promise<DocumentStat>} The document stat.
     */
    stat(uri: string): Promise<DocumentStat>;
    /**
     * Loads a document using a specific extension handler.
     * @param {string} ext The extension of the document.
     * @param {string} uri The URI to load the document from.
     * @param {any} defaultValue The default value to return if the document does not exist.
     * @returns {Promise<any>} The loaded document or the default value.
     */
    loadDocumentAs(ext: string, uri: string, defaultValue?: any): Promise<any>;
    /**
     * Ensures the directory path for a given URI exists, creating it if necessary.
     * @param {string} uri The URI to build the path for.
     * @returns {Promise<void>}
     */
    _buildPath(uri: string): Promise<void>;
    /**
     * Ensures the current operation has proper access rights.
     * @param {string} uri The URI to check access for.
     * @param {"r"|"w"|"d"} [level="r"] The access level: read, write, or delete.
     * @returns {Promise<boolean>} True if access is granted.
     */
    ensureAccess(uri: string, level?: "r" | "w" | "d" | undefined): Promise<boolean>;
    /**
     * Lists the contents of a directory.
     * @param {string} uri The directory URI to list.
     * @param {{depth?: number, skipStat?: boolean}} options Options for listing.
     * @returns {Promise<DocumentEntry[]>} The list of directory entries.
     */
    listDir(uri: string, { depth, skipStat }?: {
        depth?: number;
        skipStat?: boolean;
    }): Promise<DocumentEntry[]>;
}
import DB from "@nan0web/db";
import { DocumentStat } from "@nan0web/db";
import { DocumentEntry } from "@nan0web/db";
