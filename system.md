# NaN•Web DataBase FileSystem

Pure node.js filesystem database.

## Rules for Users and LLM

### 1. Access Control
- Always respect the root directory boundary.
- Do not attempt to access files outside the designated root.
- Use `ensureAccess()` method before any file operation to verify permissions.
- For config files like `llm.config.js`, special access rules may apply, but generally restrict outside access.

### 2. File Operations
- Use `loadDocument()` to read files, with fallback defaults.
- Use `saveDocument()` to write files, supporting JSON and raw formats.
- Use `writeDocument()` to append data to existing files.
- Use `dropDocument()` to delete files, with proper error handling.

### 3. Directory Listing
- Use `listDir()` with options for depth and skipping stat info.
- Handle errors gracefully, especially for missing directories.

### 4. Streaming and Progress
- Use `findStream()` for large directory traversal.
- Implement progress reporting during long operations.
- Monitor memory and time for large scans.

### 5. Custom Loaders and Savers
- Extend `loaders` and `savers` arrays for custom serialization.
- Ensure loaders/savers are compatible with file formats.

### 6. Error Handling
- Always catch and log errors.
- Do not expose internal errors to end-users.
- Validate paths and permissions before operations.

### 7. Testing
- Cover all critical functions with tests.
- Run tests regularly to ensure integrity.
- Use `npx node --test` for test execution.

### 8. Security
- Never execute untrusted code from files.
- Validate all inputs and paths.
- Prevent directory traversal outside root.

### 9. CLI Usage
- Use `find.js` for CLI directory scanning.
- Respect CLI options for sorting, limits, and groups.
- Monitor resource usage during scans.

### 10. Documentation
- Keep README and system.md updated.
- Document all features and rules clearly.
- Provide usage examples.

### 11. Development
- Follow code style and best practices.
- Write tests for new features.
- Maintain compatibility with Node.js latest LTS.

### 12. License and Acknowledgements
- Respect licensing terms.
- Credit dependencies and contributors.
