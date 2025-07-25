# NaN•Web DataBase FileSystem (DBFS)

A pure Node.js filesystem database for managing documents and directories with a familiar API. DBFS provides a simple, extensible interface for reading, writing, listing, and managing files and directories, with support for custom loaders and savers, access control, and streaming file discovery.

## Features

- **Filesystem-backed database**: Store and manage documents as files and directories.
- **Customizable loaders and savers**: Plug in your own serialization/deserialization logic.
- **Access control**: Prevent access outside the database root.
- **Streaming file discovery**: Efficiently traverse and process large directory trees.
- **Progress reporting**: Real-time progress and statistics during file operations.
- **Extensive test coverage**: Includes tests for all major features.

## Installation

```bash
npm install @nanoweb/db
```

## Usage

### Basic Example

```js
import DBFS from "./src/index.js"

const db = new DBFS({ root: "./data" })

async function run() {
  await db.connect()

  // Save a document
  await db.saveDocument("example.json", { hello: "world" })

  // Load a document
  const doc = await db.loadDocument("example.json")
  console.log(doc)

  // List directory entries
  const entries = await db.listDir(".")
  for (const entry of entries) {
    console.log(entry.name, entry.stat.size)
  }

  await db.disconnect()
}

run()
```

### Streaming File Discovery

Use the provided CLI tool or the `findStream` method to traverse large directory trees with progress reporting.

#### CLI Usage

```bash
node ./bin/find.js [root-directory]
```

This will recursively scan the directory, reporting progress, memory usage, and file group statistics.

#### Programmatic Usage

```js
for await (const entry of db.findStream(".", { limit: -1, sort: "name", order: "desc" })) {
  console.log(entry.file.name, entry.file.stat.size)
}
```

## API

### `DBFS` Class

#### Constructor

```js
new DBFS({ root: string })
```

- `root`: The root directory for the database.

#### Methods

- `connect()`: Connect to the database (prepares internal state).
- `disconnect()`: Disconnect from the database.
- `saveDocument(uri, document)`: Save a document to a file.
- `loadDocument(uri, defaultValue)`: Load a document from a file, or return `defaultValue` if not found.
- `writeDocument(uri, chunk)`: Append a chunk to a document.
- `dropDocument(uri)`: Delete a document.
- `statDocument(uri)`: Get file stats for a document.
- `listDir(uri, options)`: List directory entries.
- `findStream(root, options)`: Async generator for streaming file discovery.

#### Access Control

DBFS prevents access to files outside the configured root directory. Attempts to access files outside the root will throw an error.

#### Custom Loaders and Savers

You can extend the `loaders` and `savers` arrays to support custom file formats.

## Development & Testing

Run the test suite using [node:test](https://nodejs.org/api/test.html):

```bash
npx node --test
```

Or run specific test files:

```bash
npx node --test ./src/index.test.js
npx node --test ./src/findStream.test.js
```

## License

ISC

## Acknowledgements

- [@nanoweb/db](https://npmjs.com/package/@nanoweb/db)
- [nanoweb-fs](https://npmjs.com/package/nanoweb-fs)
