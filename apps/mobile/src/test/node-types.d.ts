/// <reference types="node" />
// `apps/mobile/src/lib/native-pitfalls-scan.ts` walks source files with
// `node:fs`, so the mobile program needs node's types. The integration tests
// that T-0933 deleted were the only files carrying this reference; keeping it
// here preserves typecheck for that production file.
