// The runner port; this module must not import from `../sandbox`.
export type ToolRunner = (params: {
  source: string;
  input: unknown;
  allowedHosts: readonly string[];
}) => Promise<ToolRunResult>;

export type ToolRunResult =
  | {
      ok: true;
      output: { text: string; data?: unknown; blocks?: unknown; card?: unknown };
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
