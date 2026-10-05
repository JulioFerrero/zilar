// T-0103: the runner port (T-0102 exports a compatible type; the wiring is
// T-0105's job, so this module must not import from `../sandbox`). The
// runner executes one version's source in its sandbox and reports back.
export type ToolRunner = (params: {
  source: string;
  input: unknown;
  allowedHosts: readonly string[];
}) => Promise<ToolRunResult>;

export type ToolRunResult =
  | {
      ok: true;
      output: { text: string; data?: unknown };
      logs: string;
      durationMs: number;
      fetchCount: number;
    }
  | {
      ok: false;
      error: { kind: string; message: string };
      logs: string;
      durationMs: number;
      fetchCount: number;
    };
