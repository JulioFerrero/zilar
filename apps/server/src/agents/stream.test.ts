import { describe, expect, it } from 'vitest';
import {
  ChatStreamInterruptedError,
  consumeChatCompletionStream,
  type StreamedToolCall,
} from './stream';

const encoder = new TextEncoder();

function sseBody(chunks: string[]): ReadableStream<Uint8Array> {
  const encoded = chunks.map((chunk) => encoder.encode(chunk));
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of encoded) {
        controller.enqueue(part);
      }
      controller.close();
    },
  });
}

function dataLine(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function contentChunk(content: string): string {
  return dataLine({ choices: [{ delta: { content } }] });
}

function toolChunk(
  index: number,
  id: string | undefined,
  name: string | undefined,
  args: string | undefined,
): string {
  return dataLine({
    choices: [
      {
        delta: {
          tool_calls: [
            {
              index,
              ...(id === undefined ? {} : { id }),
              function: {
                ...(name === undefined ? {} : { name }),
                ...(args === undefined ? {} : { arguments: args }),
              },
            },
          ],
        },
      },
    ],
  });
}

const DONE = 'data: [DONE]\n\n';

function sortedCalls(result: { toolCalls: StreamedToolCall[] }): StreamedToolCall[] {
  return result.toolCalls;
}

describe('consumeChatCompletionStream', () => {
  it('accumulates content across chunks and reports growing text', async () => {
    const seen: string[] = [];
    const result = await consumeChatCompletionStream(
      sseBody([contentChunk('Hello'), contentChunk(', Ju'), contentChunk('lio'), DONE]),
      (text) => {
        seen.push(text);
      },
    );
    expect(result).toEqual({ content: 'Hello, Julio', toolCalls: [] });
    expect(seen).toEqual(['Hello', 'Hello, Ju', 'Hello, Julio']);
  });

  it('survives chunks split mid-line and mid-JSON', async () => {
    const full = `${contentChunk('Hello, ') + contentChunk('world')}${DONE}`;
    const cuts = [5, 17, 18, 31, full.length - 10];
    let start = 0;
    const chunks: string[] = [];
    for (const cut of cuts) {
      chunks.push(full.slice(start, cut));
      start = cut;
    }
    chunks.push(full.slice(start));
    const seen: string[] = [];
    const result = await consumeChatCompletionStream(sseBody(chunks), (text) => {
      seen.push(text);
    });
    expect(result.content).toBe('Hello, world');
    expect(seen.at(-1)).toBe('Hello, world');
  });

  it('handles multiple events per chunk and ignores comments', async () => {
    const body = `: connected\n\n${contentChunk('a')}${contentChunk('b')}${DONE}`;
    const result = await consumeChatCompletionStream(sseBody([body]));
    expect(result.content).toBe('ab');
  });

  it('rebuilds tool calls split across chunks: id and name first, arguments in 3 pieces', async () => {
    const args = JSON.stringify({ persona: 'Answer in Spanish.', summary: 'Spanish' });
    const third = Math.ceil(args.length / 3);
    const result = await consumeChatCompletionStream(
      sseBody([
        toolChunk(0, 'call-1', 'update_persona', undefined),
        toolChunk(0, undefined, undefined, args.slice(0, third)),
        toolChunk(0, undefined, undefined, args.slice(third, third * 2)),
        toolChunk(0, undefined, undefined, args.slice(third * 2)),
        DONE,
      ]),
    );
    expect(result.content).toBeNull();
    expect(sortedCalls(result)).toEqual([{ id: 'call-1', name: 'update_persona', argsJson: args }]);
  });

  it('keeps several tool calls ordered by index', async () => {
    const result = await consumeChatCompletionStream(
      sseBody([
        toolChunk(1, 'call-b', 'revert_persona', '{}'),
        toolChunk(0, 'call-a', 'update_persona', '{"persona":"x"}'),
        DONE,
      ]),
    );
    expect(sortedCalls(result)).toEqual([
      { id: 'call-a', name: 'update_persona', argsJson: '{"persona":"x"}' },
      { id: 'call-b', name: 'revert_persona', argsJson: '{}' },
    ]);
  });

  it('never reports tool-call arguments through onDelta', async () => {
    const seen: string[] = [];
    await consumeChatCompletionStream(
      sseBody([
        contentChunk('vale'),
        toolChunk(0, 'call-1', 'update_persona', '{"persona":"secret persona text"}'),
        DONE,
      ]),
      (text) => {
        seen.push(text);
      },
    );
    expect(seen).toEqual(['vale']);
    expect(seen.join('')).not.toContain('secret persona text');
  });

  it('fails when the stream ends without [DONE]', async () => {
    const result = consumeChatCompletionStream(sseBody([contentChunk('half')]));
    await expect(result).rejects.toBeInstanceOf(ChatStreamInterruptedError);
  });

  it('fails on a broken data line and on a dropped connection', async () => {
    await expect(
      consumeChatCompletionStream(sseBody(['data: {not json\n\n', DONE])),
    ).rejects.toBeInstanceOf(ChatStreamInterruptedError);

    const errored = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(contentChunk('half')));
        controller.error(new Error('socket reset'));
      },
    });
    await expect(consumeChatCompletionStream(errored)).rejects.toBeInstanceOf(
      ChatStreamInterruptedError,
    );
  });
});
