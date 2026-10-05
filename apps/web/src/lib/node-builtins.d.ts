// Local Node builtin declarations for tests that read files from disk
// (`pwa.test.ts`). The web program is DOM-only on purpose: pulling
// `@types/node` into `tsconfig.json` would retype `setTimeout` globally and
// break unrelated files, and adding the dependency is out of scope. Only the
// exact surface the tests use is declared here.
//
// This file must stay a script (no top-level imports): with a top-level
// import the `declare module` blocks below would become augmentations and
// the builtins would stay untyped.
declare module 'node:fs' {
  interface PwaTestBytes extends Uint8Array {
    readUInt32BE(offset: number): number;
  }
  export function readFileSync(path: string, encoding: 'utf8'): string;
  export function readFileSync(path: string): PwaTestBytes;
}

declare module 'node:path' {
  export function dirname(path: string): string;
  export function join(...parts: string[]): string;
}

declare module 'node:url' {
  export function fileURLToPath(url: string | URL): string;
}
