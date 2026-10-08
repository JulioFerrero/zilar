import { Exit, Schema } from 'effect';

// One tool call the model asked for, rebuilt from the pieces the stream
// carries: `id` and `name` arrive first, `arguments` in later chunks, all
// keyed by `index`.
export interface StreamedToolCall {
  id: string;
  name: string;
  argsJson: string;
}

export interface ChatStreamResult {
  content: string | null;
  toolCalls: StreamedToolCall[];
}

// The stream broke before `data: [DONE]`: a truncated body, a socket error,
// or a chunk that is not valid SSE JSON. The caller maps this to the network
// failure reply, exactly like a timeout. It never carries provider text.
export class ChatStreamInterruptedError extends Error {
  constructor(reason: string) {
    super(`chat stream was interrupted: ${reason}`);
    this.name = 'ChatStreamInterruptedError';
  }
}

// One `data:` line off a `stream: true` chat-completions response. LiteLLM
// passes the OpenAI shape through: `choices[0].delta` carries `content` or
// `tool_calls` pieces. Unknown fields (role, finish_reason, ids) are ignored.
const StreamDeltaSchema = Schema.Struct({
  choices: Schema.optional(
    Schema.Array(
      Schema.Struct({
        delta: Schema.optional(
          Schema.Struct({
            content: Schema.optional(Schema.NullOr(Schema.String)),
            tool_calls: Schema.optional(
              Schema.Array(
                Schema.Struct({
                  index: Schema.Number,
                  id: Schema.optional(Schema.String),
                  function: Schema.optional(
                    Schema.Struct({
                      name: Schema.optional(Schema.NullOr(Schema.String)),
                      arguments: Schema.optional(Schema.NullOr(Schema.String)),
                    }),
                  ),
                }),
              ),
            ),
          }),
        ),
      }),
    ),
  ),
});

// Reads a `text/event-stream` chat-completions body to `[DONE]`, being robust
// to chunk boundaries splitting lines and JSON values. Accumulates the text
// and the tool calls (by `index`), and calls `onDelta` with the cumulative
// text every time it grows. Only text is ever reported: tool-call arguments
// could carry a persona and must never leave the server in a draft.
export async function consumeChatCompletionStream(
  body: ReadableStream<Uint8Array>,
  onDelta?: (textSoFar: string) => void,
): Promise<ChatStreamResult> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let finished = false;
  const toolSlots = new Map<number, { id: string; name: string; args: string }>();

  const applyData = (data: string): void => {
    if (data === '') {
      return;
    }
    if (data === '[DONE]') {
      finished = true;
      return;
    }
    let json: unknown;
    try {
      json = JSON.parse(data);
    } catch {
      throw new ChatStreamInterruptedError('a data line was not valid JSON');
    }
    const exit = Schema.decodeUnknownExit(StreamDeltaSchema)(json);
    if (!Exit.isSuccess(exit)) {
      throw new ChatStreamInterruptedError('a data line had an unexpected shape');
    }
    for (const choice of exit.value.choices ?? []) {
      const delta = choice.delta;
      if (delta === undefined) {
        continue;
      }
      if (delta.content !== undefined && delta.content !== null && delta.content !== '') {
        content += delta.content;
        onDelta?.(content);
      }
      for (const call of delta.tool_calls ?? []) {
        const slot = toolSlots.get(call.index) ?? { id: '', name: '', args: '' };
        if (call.id !== undefined) {
          slot.id = call.id;
        }
        if (call.function?.name !== undefined && call.function.name !== null) {
          slot.name += call.function.name;
        }
        if (call.function?.arguments !== undefined && call.function.arguments !== null) {
          slot.args += call.function.arguments;
        }
        toolSlots.set(call.index, slot);
      }
    }
  };

  // Lines are split on `\n` as bytes arrive; the trailing fragment stays in
  // the buffer until its line is complete.
  const processLine = (line: string): void => {
    if (line === '' || line.startsWith(':')) {
      return;
    }
    // Only `data:` lines carry deltas; anything else (`event:`, `id:`)
    // is legal SSE and is ignored.
    if (line.startsWith('data:')) {
      applyData(line.slice(5).trim());
    }
  };

  const feedText = (text: string): void => {
    buffer += text;
    let newline = buffer.indexOf('\n');
    while (newline >= 0) {
      const line = buffer.slice(0, newline).replace(/\r$/, '');
      buffer = buffer.slice(newline + 1);
      processLine(line);
      if (finished) {
        return;
      }
      newline = buffer.indexOf('\n');
    }
  };

  try {
    for (;;) {
      let read: { value: Uint8Array | undefined; done: boolean };
      try {
        read = await reader.read();
      } catch {
        throw new ChatStreamInterruptedError('the connection broke midway');
      }
      if (read.value !== undefined) {
        feedText(decoder.decode(read.value, { stream: true }));
        if (finished) {
          break;
        }
      }
      if (read.done) {
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }
  // A body may end without a trailing newline: process the residual line
  // (typically the final `data: [DONE]`) instead of dropping it.
  if (!finished && buffer.trim() !== '') {
    processLine(buffer.replace(/\r$/, ''));
  }
  if (!finished) {
    throw new ChatStreamInterruptedError('the stream ended without [DONE]');
  }
  const trimmed = content.trim();
  return {
    content: trimmed === '' ? null : trimmed,
    toolCalls: [...toolSlots.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, slot]) => ({ id: slot.id, name: slot.name, argsJson: slot.args })),
  };
}
