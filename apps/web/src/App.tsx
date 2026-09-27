import { protocolVersion } from '@galena/protocol';

export function App() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-2 bg-white px-6 text-center text-neutral-900 dark:bg-neutral-950 dark:text-neutral-50">
      <h1 className="text-4xl font-semibold tracking-tight">Galena</h1>
      <p className="text-base text-neutral-600 dark:text-neutral-400">People and AIs, together.</p>
      <p className="text-xs text-neutral-400 dark:text-neutral-600">protocol v{protocolVersion}</p>
    </main>
  );
}
