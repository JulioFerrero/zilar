import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  aiMemoryMessages,
  aiMemoryNodes,
  aiMemoryState,
  ais,
  providerConnections,
  user,
} from '../../db/schema';
import { createTestContext, TEST_XMPP_DOMAIN, type TestContext } from '../../test-support';
import {
  MEMORY_FACTS_MAX,
  MEMORY_RECALL_MAX,
  addFact,
  buildCompactionPrompt,
  clearMemory,
  compactionInput,
  deleteFact,
  listFacts,
  memoryRange,
  pendingNodes,
  putNode,
  recallMemory,
  renderMemoryBlock,
  zoomMemory,
} from './store';
import { cover, formatBlockId, MEMORY_WAKE_LINES } from './tree';

const BASE = Date.UTC(2026, 0, 1);
const DAY = 86_400_000;

function day(seq: number): Date {
  return new Date(BASE + seq * DAY);
}

function lineFor(seq: number): string {
  return `#${seq} ${day(seq).toISOString().slice(0, 10)} Bob: m${seq}`;
}

async function seedAi(context: TestContext): Promise<string> {
  const ownerId = randomUUID();
  await context.db
    .insert(user)
    .values({ id: ownerId, name: 'Owner', email: `${ownerId}@example.com` });
  const connectionId = randomUUID();
  await context.db.insert(providerConnections).values({
    id: connectionId,
    owner: ownerId,
    provider: 'openai',
    encryptedKey: 'CHANGE_ME',
    label: null,
  });
  const aiId = randomUUID();
  await context.db.insert(ais).values({
    id: aiId,
    owner: ownerId,
    name: 'Memory AI',
    template: 'dev',
    persona: 'A persona',
    providerConnectionId: connectionId,
    model: 'gpt-4o-mini',
    localpart: `ai-${aiId}`,
    jid: `ai-${aiId}@${TEST_XMPP_DOMAIN}`,
    status: 'active',
  });
  return aiId;
}

async function seedRows(
  context: TestContext,
  aiId: string,
  chatKey: string,
  count: number,
): Promise<void> {
  const values = Array.from({ length: count }, (_, seq) => ({
    aiId,
    chatKey,
    seq,
    messageId: `${chatKey}-m${seq}`,
    at: day(seq),
    sender: 'Bob',
    text: `m${seq}`,
    deleted: false,
  }));
  await context.db.insert(aiMemoryMessages).values(values);
}

async function seedTextRows(
  context: TestContext,
  aiId: string,
  chatKey: string,
  texts: string[],
): Promise<void> {
  await context.db.insert(aiMemoryMessages).values(
    texts.map((text, seq) => ({
      aiId,
      chatKey,
      seq,
      messageId: `${chatKey}-t${seq}`,
      at: day(seq),
      sender: 'Bob',
      text,
      deleted: false,
    })),
  );
}

async function setFloor(
  context: TestContext,
  aiId: string,
  chatKey: string,
  floor: number,
): Promise<void> {
  await context.db
    .insert(aiMemoryState)
    .values({ aiId, chatKey, floorSeq: floor })
    .onConflictDoUpdate({
      target: [aiMemoryState.aiId, aiMemoryState.chatKey],
      set: { floorSeq: floor },
    });
}

async function countNodes(context: TestContext, aiId: string, chatKey: string): Promise<number> {
  const rows = await context.db
    .select({ lo: aiMemoryNodes.lo })
    .from(aiMemoryNodes)
    .where(and(eq(aiMemoryNodes.aiId, aiId), eq(aiMemoryNodes.chatKey, chatKey)));
  return rows.length;
}

describe('memory store', () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    await context.close();
  });

  describe('memoryRange', () => {
    it('starts empty and moves the end past the window', async () => {
      const aiId = await seedAi(context);
      expect(await memoryRange(context.db, aiId, 'dm:a')).toEqual({ total: 0, floor: 0, end: 0 });
      await seedRows(context, aiId, 'dm:a', 60);
      expect(await memoryRange(context.db, aiId, 'dm:a')).toEqual({ total: 60, floor: 0, end: 10 });
      await setFloor(context, aiId, 'dm:a', 40);
      expect(await memoryRange(context.db, aiId, 'dm:a')).toEqual({
        total: 60,
        floor: 40,
        end: 40,
      });
    });
  });

  describe('renderMemoryBlock', () => {
    it('is empty while the total is inside the window', async () => {
      const aiId = await seedAi(context);
      expect(await renderMemoryBlock(context.db, aiId, 'dm:a')).toEqual([]);
      await seedRows(context, aiId, 'dm:a', 50);
      expect(await renderMemoryBlock(context.db, aiId, 'dm:a')).toEqual([]);
    });

    it('shows raw rows below the window when they fit', async () => {
      const aiId = await seedAi(context);
      await seedRows(context, aiId, 'dm:a', 60);
      const lines = await renderMemoryBlock(context.db, aiId, 'dm:a');
      expect(lines).toEqual(Array.from({ length: 10 }, (_, seq) => lineFor(seq)));
    });

    it('uses node summaries when they exist', async () => {
      const aiId = await seedAi(context);
      const chatKey = 'dm:a';
      await seedRows(context, aiId, chatKey, 250);
      const end = 250 - 50;
      const blocks = cover(end, MEMORY_WAKE_LINES);
      const nodes = blocks
        .filter((block) => block.hi - block.lo >= 16)
        .map((block) => ({
          aiId,
          chatKey,
          lo: block.lo,
          hi: block.hi,
          summary: `S${block.lo}-${block.hi}`,
        }));
      await context.db.insert(aiMemoryNodes).values(nodes);

      const full = blocks.map((block) =>
        block.hi - block.lo === 1
          ? lineFor(block.lo)
          : `#${block.lo}-${block.hi - 1} S${block.lo}-${block.hi}`,
      );
      const expected =
        full.length > MEMORY_WAKE_LINES ? full.slice(full.length - MEMORY_WAKE_LINES) : full;
      expect(expected.some((line) => line.includes(' S'))).toBe(true);
      expect(await renderMemoryBlock(context.db, aiId, chatKey)).toEqual(expected);
    });

    it('expands a missing node into its halves', async () => {
      const aiId = await seedAi(context);
      const chatKey = 'dm:a';
      await seedRows(context, aiId, chatKey, 82);
      await putNode(context.db, aiId, chatKey, { lo: 0, hi: 16 }, 'L');
      await putNode(context.db, aiId, chatKey, { lo: 16, hi: 32 }, 'R');
      expect(await renderMemoryBlock(context.db, aiId, chatKey, 1)).toEqual(['#16-31 R']);

      await putNode(context.db, aiId, chatKey, { lo: 0, hi: 32 }, 'P');
      expect(await renderMemoryBlock(context.db, aiId, chatKey, 1)).toEqual(['#0-31 P']);
    });

    it('expands a size-16 block with no node into its raw rows', async () => {
      const aiId = await seedAi(context);
      await seedRows(context, aiId, 'dm:a', 66);
      expect(await renderMemoryBlock(context.db, aiId, 'dm:a', 1)).toEqual([lineFor(15)]);
    });

    it('never goes over the budget and keeps the newest lines', async () => {
      const aiId = await seedAi(context);
      await seedRows(context, aiId, 'dm:a', 250);
      const lines = await renderMemoryBlock(context.db, aiId, 'dm:a', 5);
      expect(lines).toEqual([195, 196, 197, 198, 199].map(lineFor));
    });

    it('respects the floor and splits a straddling block', async () => {
      const aiId = await seedAi(context);
      const chatKey = 'dm:a';
      await seedRows(context, aiId, chatKey, 250);
      await setFloor(context, aiId, chatKey, 105);
      const lines = await renderMemoryBlock(context.db, aiId, chatKey, 95);
      expect(lines).toHaveLength(95);
      expect(lines[0]).toBe(lineFor(105));
      expect(lines[94]).toBe(lineFor(199));
    });
  });

  describe('recallMemory', () => {
    it('matches every word case-insensitively and returns oldest first', async () => {
      const aiId = await seedAi(context);
      const chatKey = 'dm:a';
      await seedTextRows(context, aiId, chatKey, [
        'Alpha beta gamma',
        'BETA only',
        'alpha BETA delta',
        'nothing here',
      ]);
      expect(await recallMemory(context.db, aiId, chatKey, 'ALPHA beta')).toEqual([
        lineFor(0).replace('m0', 'Alpha beta gamma'),
        lineFor(2).replace('m2', 'alpha BETA delta'),
      ]);
    });

    it('treats % and _ in the query as literal characters', async () => {
      const aiId = await seedAi(context);
      const chatKey = 'dm:a';
      await seedTextRows(context, aiId, chatKey, ['100% done', 'plain', 'a_b', 'axb']);
      expect(await recallMemory(context.db, aiId, chatKey, '%')).toEqual([
        lineFor(0).replace('m0', '100% done'),
      ]);
      expect(await recallMemory(context.db, aiId, chatKey, '_')).toEqual([
        lineFor(2).replace('m2', 'a_b'),
      ]);
      expect(await recallMemory(context.db, aiId, chatKey, '')).toEqual([]);
    });

    it('skips deleted rows and rows below the floor', async () => {
      const aiId = await seedAi(context);
      const chatKey = 'dm:a';
      await seedTextRows(context, aiId, chatKey, ['keep me', 'delete me', 'floor me']);
      await context.db
        .update(aiMemoryMessages)
        .set({ deleted: true })
        .where(
          and(
            eq(aiMemoryMessages.aiId, aiId),
            eq(aiMemoryMessages.chatKey, chatKey),
            eq(aiMemoryMessages.seq, 1),
          ),
        );
      await setFloor(context, aiId, chatKey, 1);
      expect(await recallMemory(context.db, aiId, chatKey, 'me')).toEqual([
        lineFor(2).replace('m2', 'floor me'),
      ]);
    });

    it('caps at 30 with a count note', async () => {
      const aiId = await seedAi(context);
      const chatKey = 'dm:a';
      await seedTextRows(
        context,
        aiId,
        chatKey,
        Array.from({ length: 35 }, (_, seq) => `match ${seq}`),
      );
      const lines = await recallMemory(context.db, aiId, chatKey, 'match');
      expect(lines).toHaveLength(MEMORY_RECALL_MAX + 1);
      expect(lines[0]).toBe(lineFor(5).replace('m5', 'match 5'));
      expect(lines[MEMORY_RECALL_MAX - 1]).toBe(lineFor(34).replace('m34', 'match 34'));
      expect(lines[MEMORY_RECALL_MAX]).toBe('Newest 30 of 35 matches.');
    });
  });

  describe('zoomMemory', () => {
    it('opens a block into its halves', async () => {
      const aiId = await seedAi(context);
      const chatKey = 'dm:a';
      await seedRows(context, aiId, chatKey, 82);
      await putNode(context.db, aiId, chatKey, { lo: 0, hi: 16 }, 'L');
      await putNode(context.db, aiId, chatKey, { lo: 16, hi: 32 }, 'R');

      expect(await zoomMemory(context.db, aiId, chatKey, '0-31')).toEqual(['#0-15 L', '#16-31 R']);

      const rawHalves = await zoomMemory(context.db, aiId, chatKey, '16-31');
      expect(rawHalves).toHaveLength(16);
      expect(rawHalves?.[0]).toBe(lineFor(16));
      expect(rawHalves?.[15]).toBe(lineFor(31));
    });

    it('returns null for a malformed or out-of-range id', async () => {
      const aiId = await seedAi(context);
      const chatKey = 'dm:a';
      await seedRows(context, aiId, chatKey, 82);
      expect(await zoomMemory(context.db, aiId, chatKey, 'junk')).toBeNull();
      expect(await zoomMemory(context.db, aiId, chatKey, '3-10')).toBeNull();
      expect(await zoomMemory(context.db, aiId, chatKey, '16-31')).not.toBeNull();

      await setFloor(context, aiId, chatKey, 40);
      expect(await zoomMemory(context.db, aiId, chatKey, '0-31')).toBeNull();

      const smallAi = await seedAi(context);
      await seedRows(context, smallAi, 'dm:b', 16);
      expect(await zoomMemory(context.db, smallAi, 'dm:b', '16-31')).toBeNull();
    });
  });

  describe('facts', () => {
    it('adds, rejects invalid and duplicate, and drops the oldest past the cap', async () => {
      const aiId = await seedAi(context);
      const chatKey = 'dm:a';
      expect(await addFact(context.db, aiId, chatKey, '')).toBe('invalid');
      expect(await addFact(context.db, aiId, chatKey, '   ')).toBe('invalid');
      expect(await addFact(context.db, aiId, chatKey, 'two\nlines')).toBe('invalid');
      expect(await addFact(context.db, aiId, chatKey, 'x'.repeat(281))).toBe('invalid');
      expect(await addFact(context.db, aiId, chatKey, 'First fact')).toBe('saved');
      expect(await addFact(context.db, aiId, chatKey, 'first FACT')).toBe('duplicate');
      expect(await listFacts(context.db, aiId, chatKey)).toHaveLength(1);

      const capChat = 'dm:cap';
      for (let i = 0; i < MEMORY_FACTS_MAX + 1; i += 1) {
        expect(await addFact(context.db, aiId, capChat, `fact ${i}`)).toBe('saved');
      }
      const facts = await listFacts(context.db, aiId, capChat);
      expect(facts).toHaveLength(MEMORY_FACTS_MAX);
      expect(facts[0]?.text).toBe('fact 1');
      expect(facts[MEMORY_FACTS_MAX - 1]?.text).toBe(`fact ${MEMORY_FACTS_MAX}`);
    });

    it('deletes a fact only inside its own AI and chat', async () => {
      const aiId = await seedAi(context);
      const otherAi = await seedAi(context);
      await addFact(context.db, aiId, 'dm:a', 'mine');
      await addFact(context.db, otherAi, 'dm:b', 'theirs');
      const mine = await listFacts(context.db, aiId, 'dm:a');
      const theirs = await listFacts(context.db, otherAi, 'dm:b');

      expect(await deleteFact(context.db, aiId, 'dm:a', theirs[0]?.id ?? '')).toBe(false);
      expect(await listFacts(context.db, otherAi, 'dm:b')).toHaveLength(1);
      expect(await deleteFact(context.db, aiId, 'dm:a', mine[0]?.id ?? '')).toBe(true);
      expect(await listFacts(context.db, aiId, 'dm:a')).toEqual([]);
    });
  });

  describe('nodes and compaction', () => {
    it('lists pending nodes smallest first and only above the floor', async () => {
      const aiId = await seedAi(context);
      const chatKey = 'dm:a';
      await seedRows(context, aiId, chatKey, 82);
      const pendingIds = async () =>
        (await pendingNodes(context.db, aiId, chatKey, 10)).map(formatBlockId);

      expect(await pendingIds()).toEqual(['0-15', '16-31']);
      await putNode(context.db, aiId, chatKey, { lo: 0, hi: 16 }, 'L');
      expect(await pendingIds()).toEqual(['16-31']);
      await putNode(context.db, aiId, chatKey, { lo: 16, hi: 32 }, 'R');
      expect(await pendingIds()).toEqual(['0-31']);
      await setFloor(context, aiId, chatKey, 16);
      expect(await pendingIds()).toEqual([]);
    });

    it('does nothing when a node already exists', async () => {
      const aiId = await seedAi(context);
      const chatKey = 'dm:a';
      await putNode(context.db, aiId, chatKey, { lo: 0, hi: 16 }, 'first');
      await putNode(context.db, aiId, chatKey, { lo: 0, hi: 16 }, 'second');
      const rows = await context.db
        .select({ summary: aiMemoryNodes.summary })
        .from(aiMemoryNodes)
        .where(and(eq(aiMemoryNodes.aiId, aiId), eq(aiMemoryNodes.chatKey, chatKey)));
      expect(rows).toEqual([{ summary: 'first' }]);
    });

    it('builds the compaction input from rows or child summaries', async () => {
      const aiId = await seedAi(context);
      const chatKey = 'dm:a';
      await seedRows(context, aiId, chatKey, 82);
      await putNode(context.db, aiId, chatKey, { lo: 0, hi: 16 }, 'L');
      await putNode(context.db, aiId, chatKey, { lo: 16, hi: 32 }, 'R');

      expect(await compactionInput(context.db, aiId, chatKey, { lo: 0, hi: 16 })).toEqual(
        Array.from({ length: 16 }, (_, seq) => lineFor(seq)),
      );
      expect(await compactionInput(context.db, aiId, chatKey, { lo: 0, hi: 32 })).toEqual([
        'L',
        'R',
      ]);
    });

    it('builds the prompt with the block id and the input lines', async () => {
      const prompt = buildCompactionPrompt('0-31', ['line one', 'line two']);
      expect(prompt).toContain(
        'Compress chat memory #0-31 into one line of at most 280 characters.',
      );
      expect(prompt).toContain('Invent nothing.');
      expect(prompt.endsWith('\nline one\nline two')).toBe(true);
      expect(buildCompactionPrompt('0-31', [])).not.toContain('\n');
    });
  });

  describe('clearMemory', () => {
    it('empties nodes and facts and moves the floor to the end', async () => {
      const aiId = await seedAi(context);
      const chatKey = 'dm:a';
      await seedRows(context, aiId, chatKey, 82);
      await putNode(context.db, aiId, chatKey, { lo: 0, hi: 16 }, 'L');
      await addFact(context.db, aiId, chatKey, 'remember this');
      await setFloor(context, aiId, chatKey, 5);

      await clearMemory(context.db, aiId, chatKey);

      expect(await countNodes(context, aiId, chatKey)).toBe(0);
      expect(await listFacts(context.db, aiId, chatKey)).toEqual([]);
      const [state] = await context.db
        .select({ floorSeq: aiMemoryState.floorSeq })
        .from(aiMemoryState)
        .where(and(eq(aiMemoryState.aiId, aiId), eq(aiMemoryState.chatKey, chatKey)));
      expect(state?.floorSeq).toBe(82);
      const messages = await context.db
        .select({ seq: aiMemoryMessages.seq })
        .from(aiMemoryMessages)
        .where(and(eq(aiMemoryMessages.aiId, aiId), eq(aiMemoryMessages.chatKey, chatKey)));
      expect(messages).toHaveLength(82);
      expect(await renderMemoryBlock(context.db, aiId, chatKey)).toEqual([]);
    });
  });

  describe('scope', () => {
    it('never crosses AIs or chats', async () => {
      const aiOne = await seedAi(context);
      const aiTwo = await seedAi(context);
      await seedTextRows(context, aiOne, 'dm:one', ['one-one']);
      await seedTextRows(context, aiOne, 'dm:two', ['one-two']);
      await seedTextRows(context, aiTwo, 'dm:two', ['two-two']);

      expect(await recallMemory(context.db, aiOne, 'dm:one', 'one')).toEqual([
        lineFor(0).replace('m0', 'one-one'),
      ]);
      expect(await recallMemory(context.db, aiTwo, 'dm:two', 'two-two')).toEqual([
        lineFor(0).replace('m0', 'two-two'),
      ]);
      expect(await listFacts(context.db, aiOne, 'dm:one')).toEqual([]);
    });

    it('scopes the rendered block to one chat', async () => {
      const aiId = await seedAi(context);
      await seedTextRows(
        context,
        aiId,
        'dm:a',
        Array.from({ length: 51 }, (_, seq) => (seq === 0 ? 'secret-one' : `m${seq}`)),
      );
      await seedTextRows(
        context,
        await seedAi(context),
        'dm:a',
        Array.from({ length: 51 }, (_, seq) => (seq === 0 ? 'other-ai' : `m${seq}`)),
      );
      const lines = await renderMemoryBlock(context.db, aiId, 'dm:a');
      expect(lines).toEqual([lineFor(0).replace('m0', 'secret-one')]);
    });
  });
});
