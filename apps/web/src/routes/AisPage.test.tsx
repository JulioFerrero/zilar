import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderApp } from '@/test/renderApp';
import { type Connection, deleteAi, listAis, listConnections, type PublicAi } from '@/lib/api';

vi.mock('@/lib/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...original,
    listAis: vi.fn(),
    listConnections: vi.fn(),
    deleteAi: vi.fn(),
  };
});

const listAisMock = vi.mocked(listAis);
const listConnectionsMock = vi.mocked(listConnections);
const deleteAiMock = vi.mocked(deleteAi);

const AI: PublicAi = {
  id: 'a-1',
  name: 'Dev-1',
  template: 'dev',
  persona: 'You are a concise senior engineer.',
  model: 'gpt-4o',
  jid: 'ai-a-1@zilar.test',
  status: 'active',
  providerConnectionId: 'c-1',
  limits: { perDayUsd: 2, perMonthUsd: 20 },
  usage: { todayUsd: 0.5, windowUsd: 5 },
  createdAt: '2026-09-28T00:00:00.000Z',
};

const CONNECTION: Connection = {
  id: 'c-1',
  provider: 'openai',
  label: 'Work',
  status: 'active',
  createdAt: '2026-09-28T00:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AisPage (routes)', () => {
  it('loads the AIs with their model, provider and limits', async () => {
    listAisMock.mockResolvedValue([AI]);
    listConnectionsMock.mockResolvedValue([CONNECTION]);
    renderApp('/settings/ais');

    expect(screen.getByText('Loading…')).toBeTruthy();
    expect(await screen.findByText('Dev-1')).toBeTruthy();
    expect(screen.getByText(/gpt-4o · OpenAI/)).toBeTruthy();
    expect(screen.getByText('$2/day · $20/month')).toBeTruthy();
    expect(listConnectionsMock).toHaveBeenCalledTimes(1);
  });

  it('shows the empty state with a Create an AI action and loads no providers', async () => {
    listAisMock.mockResolvedValue([]);
    renderApp('/settings/ais');

    expect(await screen.findByText('You have no AIs yet.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create an AI' })).toBeTruthy();
    expect(listConnectionsMock).not.toHaveBeenCalled();
  });

  it('removes an AI after the confirm', async () => {
    listAisMock.mockResolvedValue([AI]);
    listConnectionsMock.mockResolvedValue([CONNECTION]);
    deleteAiMock.mockResolvedValue(undefined);
    renderApp('/settings/ais');

    fireEvent.click(await screen.findByRole('button', { name: 'Delete Dev-1' }));
    expect(deleteAiMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    expect(await screen.findByText('You have no AIs yet.')).toBeTruthy();
    expect(deleteAiMock).toHaveBeenCalledWith('a-1');
  });
});
