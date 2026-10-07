import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import type { ChatSummary } from '@zilar/chat-core';
import { AuthProvider } from '@/auth/AuthProvider';
import { deleteBackground, listBackgrounds, uploadBackground } from '@/lib/api';
import { prepareBackgroundImage } from '@/lib/background-image';
import { ChatStoreProvider } from '@/store/ChatStoreProvider';
import { createChatStore, type ChatStoreState } from '@/store/store';
import { ChatBackgroundDialog } from './ChatBackgroundDialog';

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    listBackgrounds: vi.fn(async () => []),
    uploadBackground: vi.fn(),
    deleteBackground: vi.fn(),
  };
});

vi.mock('@/lib/background-image', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/background-image')>();
  return { ...actual, prepareBackgroundImage: vi.fn() };
});

const listBackgroundsMock = vi.mocked(listBackgrounds);
const uploadBackgroundMock = vi.mocked(uploadBackground);
const deleteBackgroundMock = vi.mocked(deleteBackground);
const prepareBackgroundImageMock = vi.mocked(prepareBackgroundImage);

const bg1 = {
  id: 'bg-1',
  url: '/api/backgrounds/bg-1',
  width: 1600,
  height: 900,
  createdAt: '2026-10-07T00:00:00.000Z',
};

const bg2 = {
  id: 'bg-2',
  url: '/api/backgrounds/bg-2',
  width: 1600,
  height: 900,
  createdAt: '2026-10-07T00:00:01.000Z',
};

const auth = {
  status: 'authenticated' as const,
  user: { id: 'u-you', name: 'You', email: 'you@zilar.test' },
  refetch: async () => {},
};

const chat: ChatSummary = {
  id: 'c-ana',
  title: 'Ana',
  kind: 'dm',
  isAI: false,
  space: 'personal',
  unread: 0,
  muted: false,
};

function renderDialog(overrides: Partial<ChatStoreState> = {}) {
  const store = createChatStore({ chats: [chat] });
  store.setState(overrides);
  const onClose = vi.fn();
  render(
    <AuthProvider value={auth}>
      <ChatStoreProvider store={store}>
        <ChatBackgroundDialog chat={chat} open onClose={onClose} />
      </ChatStoreProvider>
    </AuthProvider>,
  );
  return { store, onClose };
}

function renderReopenable(overrides: Partial<ChatStoreState> = {}) {
  const store = createChatStore({ chats: [chat] });
  store.setState(overrides);
  function Harness() {
    const [open, setOpen] = useState(true);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Open background
        </button>
        <ChatBackgroundDialog chat={chat} open={open} onClose={() => setOpen(false)} />
      </>
    );
  }
  render(
    <AuthProvider value={auth}>
      <ChatStoreProvider store={store}>
        <Harness />
      </ChatStoreProvider>
    </AuthProvider>,
  );
  return { store };
}

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  vi.clearAllMocks();
  listBackgroundsMock.mockResolvedValue([]);
  deleteBackgroundMock.mockResolvedValue(undefined);
  uploadBackgroundMock.mockResolvedValue({
    id: 'bg-new',
    url: '/api/backgrounds/bg-new',
    width: 1600,
    height: 900,
  });
});

describe('ChatBackgroundDialog (T-0462)', () => {
  it('picks a preset for this chat', async () => {
    const setChatBackground = vi.fn(async () => {});
    renderDialog({ setChatBackground });

    fireEvent.click(screen.getByRole('button', { name: 'Navy' }));

    await waitFor(() => expect(setChatBackground).toHaveBeenCalledWith('c-ana', 'navy'));
  });

  it('picks a preset for all chats', async () => {
    const setDefaultBackground = vi.fn(async () => {});
    renderDialog({ setDefaultBackground });

    fireEvent.click(screen.getByRole('radio', { name: 'All chats' }));
    fireEvent.click(screen.getByRole('button', { name: 'Gold' }));

    await waitFor(() => expect(setDefaultBackground).toHaveBeenCalledWith('gold'));
  });

  it('clears the choice with "Use default"', async () => {
    const setChatBackground = vi.fn(async () => {});
    renderDialog({ setChatBackground });

    fireEvent.click(screen.getByRole('button', { name: 'Use default' }));

    await waitFor(() => expect(setChatBackground).toHaveBeenCalledWith('c-ana', null));
  });

  it('marks the chat preset as selected', () => {
    renderDialog({
      chatPrefs: {
        'c-ana': {
          chatJid: 'c-ana',
          mutedUntil: null,
          archived: false,
          pinnedAt: null,
          updatedAt: '2026-10-07T00:00:00.000Z',
          backgroundPreset: 'navy',
          backgroundImageId: null,
          backgroundDim: null,
        },
      },
    });

    expect(screen.getByRole('button', { name: 'Navy' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Gold' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('shows an inline alert when the save is rejected', async () => {
    const setChatBackground = vi.fn(async () => {
      throw new Error('offline');
    });
    renderDialog({ setChatBackground });

    fireEvent.click(screen.getByRole('button', { name: 'Blue' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('save the background');
  });

  it('clears the global default from "All chats"', async () => {
    const setDefaultBackground = vi.fn(async () => {});
    renderDialog({ setDefaultBackground });

    fireEvent.click(screen.getByRole('radio', { name: 'All chats' }));
    fireEvent.click(screen.getByRole('button', { name: 'Use default' }));

    await waitFor(() => expect(setDefaultBackground).toHaveBeenCalledWith(null));
  });

  it('clears the alert and resets the scope when reopened', async () => {
    const setChatBackground = vi.fn(async () => {
      throw new Error('offline');
    });
    renderReopenable({ setChatBackground });

    fireEvent.click(screen.getByRole('radio', { name: 'All chats' }));
    fireEvent.click(screen.getByRole('button', { name: 'Blue' }));
    expect(await screen.findByRole('alert')).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Open background' }));

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('radio', { name: 'This chat' }).getAttribute('aria-checked')).toBe(
      'true',
    );
  });
});

describe('ChatBackgroundDialog images (T-0464)', () => {
  const chatPrefs = (imageId: string, dim: number): ChatStoreState['chatPrefs'] => ({
    'c-ana': {
      chatJid: 'c-ana',
      mutedUntil: null,
      archived: false,
      pinnedAt: null,
      updatedAt: '2026-10-07T00:00:00.000Z',
      backgroundPreset: null,
      backgroundImageId: imageId,
      backgroundDim: dim,
    },
  });

  it('renders the uploaded images as thumbnails', async () => {
    listBackgroundsMock.mockResolvedValue([bg1]);

    renderDialog();

    expect(await screen.findByRole('button', { name: 'Background image 1' })).toBeTruthy();
  });

  it('uploads an image and selects it with dim 40 for this chat', async () => {
    const setChatBackgroundImage = vi.fn(async () => {});
    prepareBackgroundImageMock.mockResolvedValue(
      new Blob([new Uint8Array([1])], { type: 'image/webp' }),
    );
    renderDialog({ setChatBackgroundImage });

    fireEvent.change(screen.getByLabelText('Choose a background image'), {
      target: { files: [new File([new Uint8Array([1])], 'wall.png', { type: 'image/png' })] },
    });

    await waitFor(() => expect(setChatBackgroundImage).toHaveBeenCalledWith('c-ana', 'bg-new', 40));
  });

  it('shows the 20-images message when the server answers 409', async () => {
    prepareBackgroundImageMock.mockResolvedValue(
      new Blob([new Uint8Array([1])], { type: 'image/webp' }),
    );
    uploadBackgroundMock.mockRejectedValue(Object.assign(new Error('too many'), { status: 409 }));
    renderDialog();

    fireEvent.change(screen.getByLabelText('Choose a background image'), {
      target: { files: [new File([new Uint8Array([1])], 'wall.png', { type: 'image/png' })] },
    });

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('20 images');
  });

  it('saves the dim 400 ms after the last change', async () => {
    vi.useFakeTimers();
    try {
      const setChatBackgroundImage = vi.fn(async () => {});
      renderDialog({ setChatBackgroundImage, chatPrefs: chatPrefs('bg-1', 40) });

      const slider = screen.getByLabelText('Dim');
      fireEvent.change(slider, { target: { value: '60' } });
      expect(setChatBackgroundImage).not.toHaveBeenCalled();

      await act(async () => {
        vi.advanceTimersByTime(400);
      });

      expect(setChatBackgroundImage).toHaveBeenCalledWith('c-ana', 'bg-1', 60);
    } finally {
      vi.useRealTimers();
    }
  });

  it('deletes an image after an inline confirm and removes the thumbnail', async () => {
    listBackgroundsMock.mockResolvedValue([bg1]);
    renderDialog();

    fireEvent.click(await screen.findByRole('button', { name: 'Delete background image 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(deleteBackgroundMock).toHaveBeenCalledWith('bg-1'));
    expect(screen.queryByRole('button', { name: 'Background image 1' })).toBeNull();
  });

  it('picks an image for all chats', async () => {
    const setDefaultBackgroundImage = vi.fn(async () => {});
    listBackgroundsMock.mockResolvedValue([bg1]);
    renderDialog({ setDefaultBackgroundImage });

    fireEvent.click(screen.getByRole('radio', { name: 'All chats' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Background image 1' }));

    await waitFor(() => expect(setDefaultBackgroundImage).toHaveBeenCalledWith('bg-1', 40));
  });

  it('does not save the chat dim as the global default when the scope changes', async () => {
    vi.useFakeTimers();
    try {
      const setChatBackgroundImage = vi.fn(async () => {});
      const setDefaultBackgroundImage = vi.fn(async () => {});
      renderDialog({
        setChatBackgroundImage,
        setDefaultBackgroundImage,
        chatPrefs: chatPrefs('bg-1', 40),
      });

      fireEvent.change(screen.getByLabelText('Dim'), { target: { value: '60' } });
      fireEvent.click(screen.getByRole('radio', { name: 'All chats' }));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(400);
      });

      expect(setChatBackgroundImage).not.toHaveBeenCalled();
      expect(setDefaultBackgroundImage).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not overwrite a newly picked image with a stale dim save', async () => {
    vi.useFakeTimers();
    try {
      const setChatBackgroundImage = vi.fn(async () => {});
      listBackgroundsMock.mockResolvedValue([bg1, bg2]);
      renderDialog({ setChatBackgroundImage, chatPrefs: chatPrefs('bg-1', 40) });
      await act(async () => {});

      fireEvent.change(screen.getByLabelText('Dim'), { target: { value: '60' } });
      fireEvent.click(screen.getByRole('button', { name: 'Background image 2' }));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(400);
      });

      expect(setChatBackgroundImage).toHaveBeenCalledWith('c-ana', 'bg-2', 40);
      expect(setChatBackgroundImage).not.toHaveBeenCalledWith('c-ana', 'bg-1', 60);
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears the selection when the selected image is deleted', async () => {
    listBackgroundsMock.mockResolvedValue([bg1]);
    const setChatBackground = vi.fn(async () => {});
    renderDialog({ setChatBackground, chatPrefs: chatPrefs('bg-1', 40) });

    fireEvent.click(await screen.findByRole('button', { name: 'Delete background image 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(deleteBackgroundMock).toHaveBeenCalledWith('bg-1'));
    await waitFor(() => expect(setChatBackground).toHaveBeenCalledWith('c-ana', null));
    expect(screen.queryByRole('button', { name: 'Background image 1' })).toBeNull();
  });

  it('cancels a pending dim save when the dialog closes', async () => {
    vi.useFakeTimers();
    try {
      const setChatBackgroundImage = vi.fn(async () => {});
      renderReopenable({ setChatBackgroundImage, chatPrefs: chatPrefs('bg-1', 40) });

      fireEvent.change(screen.getByLabelText('Dim'), { target: { value: '60' } });
      fireEvent.keyDown(document, { key: 'Escape' });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(400);
      });

      expect(setChatBackgroundImage).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
