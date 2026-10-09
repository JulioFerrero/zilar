import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { RequestsPage } from './RequestsPage';
import { acceptContactRequest, declineContactRequest, listContactRequests } from '@/lib/api';

vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error {
    readonly status: number;
    readonly code: string;
    constructor(status: number, code: string, message: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  },
  acceptContactRequest: vi.fn(),
  cancelContactRequest: vi.fn(),
  declineContactRequest: vi.fn(),
  listContactRequests: vi.fn(),
}));

const listMock = vi.mocked(listContactRequests);
const acceptMock = vi.mocked(acceptContactRequest);
const declineMock = vi.mocked(declineContactRequest);

type AcceptResult = Awaited<ReturnType<typeof acceptContactRequest>>;
const ACCEPTED: AcceptResult = {
  request: {
    id: 'r-1',
    fromUserId: 'u-r-1',
    toUserId: 'u-me',
    status: 'accepted',
    createdAt: new Date().toISOString(),
  },
};

function request(id: string, name: string, handle: string | null) {
  return {
    id,
    status: 'pending' as const,
    createdAt: new Date().toISOString(),
    other: { userId: `u-${id}`, name, handle, image: null },
  };
}

describe('RequestsPage', () => {
  it('lists incoming with Accept/Decline and outgoing with Cancel', async () => {
    listMock.mockResolvedValue({
      incoming: [request('r-1', 'Bob', 'bob_b')],
      outgoing: [request('r-2', 'Carol', 'carol_c')],
    });
    acceptMock.mockResolvedValue({
      request: {
        id: 'r-1',
        fromUserId: 'u-r-1',
        toUserId: 'u-me',
        status: 'accepted',
        createdAt: new Date().toISOString(),
      },
    });
    render(
      <MemoryRouter>
        <RequestsPage onBack={() => {}} />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Bob')).toBeTruthy();
    expect(screen.getByText('Carol')).toBeTruthy();
    expect(screen.getByRole('heading', { name: /incoming/i })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(acceptMock).toHaveBeenCalledWith('r-1'));
    expect(screen.queryByText('Bob')).toBeNull();
    expect(declineMock).not.toHaveBeenCalled();
  });

  it('shows the empty state when nothing is pending', async () => {
    listMock.mockResolvedValue({ incoming: [], outgoing: [] });
    render(
      <MemoryRouter>
        <RequestsPage onBack={() => {}} />
      </MemoryRouter>,
    );
    expect(await screen.findByText('No pending requests.')).toBeTruthy();
  });

  it('two different rows can be answered at once', async () => {
    listMock.mockResolvedValue({
      incoming: [request('r-1', 'Bob', 'bob_b'), request('r-3', 'Dan', 'dan_d')],
      outgoing: [],
    });
    const finish: Array<() => void> = [];
    acceptMock.mockImplementation(
      () =>
        new Promise<AcceptResult>((resolve) => {
          finish.push(() => resolve(ACCEPTED));
        }),
    );
    render(
      <MemoryRouter>
        <RequestsPage onBack={() => {}} />
      </MemoryRouter>,
    );

    await screen.findByText('Bob');
    const [bob, dan] = screen.getAllByRole('button', { name: 'Accept' });
    fireEvent.click(bob!);
    fireEvent.click(dan!);

    await waitFor(() => expect(acceptMock).toHaveBeenCalledTimes(2));
    expect(acceptMock).toHaveBeenNthCalledWith(1, 'r-1');
    expect(acceptMock).toHaveBeenNthCalledWith(2, 'r-3');
    finish.forEach((done) => done());
    await waitFor(() => expect(screen.queryByText('Bob')).toBeNull());
    expect(screen.queryByText('Dan')).toBeNull();
  });

  it('a second click on the same row waits for its first answer', async () => {
    listMock.mockResolvedValue({
      incoming: [request('r-1', 'Bob', 'bob_b')],
      outgoing: [],
    });
    let finish: () => void = () => undefined;
    acceptMock.mockImplementation(
      () =>
        new Promise<AcceptResult>((resolve) => {
          finish = () => resolve(ACCEPTED);
        }),
    );
    render(
      <MemoryRouter>
        <RequestsPage onBack={() => {}} />
      </MemoryRouter>,
    );

    await screen.findByText('Bob');
    const accept = screen.getByRole('button', { name: 'Accept' });
    fireEvent.click(accept);
    fireEvent.click(accept);

    await waitFor(() => expect(acceptMock).toHaveBeenCalledTimes(1));
    finish();
    await waitFor(() => expect(screen.queryByText('Bob')).toBeNull());
    expect(acceptMock).toHaveBeenCalledTimes(1);
  });
});
