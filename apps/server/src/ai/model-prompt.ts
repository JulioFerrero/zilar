// Converts our wire shapes into the Effect AI `Prompt`/`Toolkit` shapes.
import type { JsonSchema } from 'effect';
import { Prompt, Tool, Toolkit } from 'effect/ai';

export interface ModelRequestMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

export interface ModelToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

// An empty or malformed arguments string becomes `{}` so the prompt still
// decodes; the executor validates the original itself.
function parseArguments(argsJson: string): unknown {
  if (argsJson.trim() === '') {
    return {};
  }
  try {
    return JSON.parse(argsJson);
  } catch {
    return {};
  }
}

// A tool result only carries the call id; the name comes from the assistant
// `tool_calls` it answers.
function toolNamesById(messages: readonly ModelRequestMessage[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const message of messages) {
    for (const call of message.tool_calls ?? []) {
      names.set(call.id, call.function.name);
    }
  }
  return names;
}

function encodeMessage(
  message: ModelRequestMessage,
  names: Map<string, string>,
): Prompt.MessageEncoded {
  switch (message.role) {
    case 'system':
      return { role: 'system', content: message.content };
    case 'user':
      return { role: 'user', content: message.content };
    case 'assistant': {
      const parts: Array<Prompt.AssistantMessagePartEncoded> = [];
      if (message.content !== '') {
        parts.push({ type: 'text', text: message.content });
      }
      for (const call of message.tool_calls ?? []) {
        parts.push({
          type: 'tool-call',
          id: call.id,
          name: call.function.name,
          params: parseArguments(call.function.arguments),
        });
      }
      return parts.length === 0
        ? { role: 'assistant', content: '' }
        : { role: 'assistant', content: parts };
    }
    case 'tool': {
      const id = message.tool_call_id ?? '';
      return {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            id,
            name: names.get(id) ?? 'unknown',
            result: message.content,
            isFailure: false,
          },
        ],
      };
    }
  }
}

export function toPrompt(messages: readonly ModelRequestMessage[]): Prompt.Prompt {
  const names = toolNamesById(messages);
  return Prompt.make(messages.map((message) => encodeMessage(message, names)));
}

// A dynamic tool needs no handler: the agent loop validates and executes every
// call itself (`disableToolCallResolution`), so the one here is never invoked.
export function toToolkit(
  definitions: readonly ModelToolDefinition[],
): Toolkit.WithHandler<Record<string, Tool.Any>> | undefined {
  if (definitions.length === 0) {
    return undefined;
  }
  const tools: Array<Tool.Any> = definitions.map((definition) =>
    Tool.dynamic(definition.function.name, {
      description: definition.function.description,
      parameters: definition.function.parameters as unknown as JsonSchema.JsonSchema,
    }),
  );
  return Toolkit.make(...tools) as unknown as Toolkit.WithHandler<Record<string, Tool.Any>>;
}
