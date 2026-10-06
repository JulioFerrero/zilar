import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { PackEditor, takeSingleEmoji } from './PackEditor';
import { PrepError } from '@/lib/sticker-images';
import type { Sticker } from '@/lib/api';

function preparedBlob(): Blob {
  return new File([new Uint8Array([1, 2, 3])], 'photo.webp', { type: 'image/webp' });
}

function prepareOk() {
  return vi.fn(async () => ({
    blob: preparedBlob(),
    mime: 'image/webp' as const,
    width: 512,
    height: 384,
    bytes: 80 * 1024,
  }));
}

function stickerRow(id: string): Sticker {
  return {
    id,
    packId: 'pack-1',
    emoji: null,
    mime: 'image/webp',
    width: 512,
    height: 384,
    bytes: 80 * 1024,
    url: `/api/stickers/${id}/file`,
  };
}

function pickFiles(input: HTMLInputElement, files: File[]): void {
  fireEvent.change(input, { target: { files } });
}

describe('takeSingleEmoji', () => {
  it('keeps one emoji', () => {
    expect(takeSingleEmoji('🐱🐱')).toBe('🐱');
    expect(takeSingleEmoji('')).toBe('');
  });

  it('keeps ZWJ and flag sequences whole', () => {
    expect(takeSingleEmoji('👨‍👩‍👧🐱')).toBe('👨‍👩‍👧');
    expect(takeSingleEmoji('🇪🇸🐱')).toBe('🇪🇸');
  });
});

describe('sticker previews', () => {
  it('shows the prepared blob while listed and revokes only on remove', async () => {
    const created: string[] = [];
    const revoked: string[] = [];
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn((blob: Blob) => {
        const url = `blob:preview-${created.length}`;
        created.push(url);
        void blob;
        return url;
      }),
      revokeObjectURL: vi.fn((url: string) => {
        revoked.push(url);
      }),
    });
    try {
      render(<PackEditor onDone={() => {}} onCancel={() => {}} prepare={prepareOk()} />);
      pickFiles(screen.getByLabelText('Pick sticker images') as HTMLInputElement, [
        new File(['a'], 'a.png', { type: 'image/png' }),
        new File(['b'], 'b.png', { type: 'image/png' }),
      ]);
      const list = await screen.findByRole('list', { name: 'Stickers in this pack' });
      await waitFor(() => expect(within(list).getByText('b.png')).toBeTruthy());

      // Both previews are live: adding the second image must not revoke
      // the first one's URL while it is still displayed.
      const images = within(list)
        .getAllByRole('img')
        .map((node) => (node as HTMLImageElement).getAttribute('src'));
      expect(images).toEqual(['blob:preview-0', 'blob:preview-1']);
      expect(revoked).toEqual([]);

      // Removing a row revokes exactly its own URL; the survivor keeps its.
      fireEvent.click(within(list).getByLabelText('Remove a.png'));
      expect(revoked).toEqual(['blob:preview-0']);
      expect((within(list).getByRole('img') as HTMLImageElement).getAttribute('src')).toBe(
        'blob:preview-1',
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('PackEditor', () => {
  it('prepares picked files and shows a per-file failure without losing the rest', async () => {
    const prepare = vi.fn(async (file: File) => {
      if (file.name === 'broken.png') {
        throw new PrepError('decode_failed', file.name, 'broken.png: the image could not be read.');
      }
      return {
        blob: preparedBlob(),
        mime: 'image/webp' as const,
        width: 100,
        height: 100,
        bytes: 1024,
      };
    });
    render(<PackEditor onDone={() => {}} onCancel={() => {}} prepare={prepare} />);

    pickFiles(screen.getByLabelText('Pick sticker images') as HTMLInputElement, [
      new File(['a'], 'good.png', { type: 'image/png' }),
      new File(['b'], 'broken.png', { type: 'image/png' }),
    ]);

    const list = await screen.findByRole('list', { name: 'Stickers in this pack' });
    await waitFor(() => {
      expect(within(list).getByText('good.png')).toBeTruthy();
      expect(within(list).getByText('broken.png: the image could not be read.')).toBeTruthy();
    });
    expect(prepare).toHaveBeenCalledTimes(2);
    // The good file previews with its result size; the broken one has no emoji field.
    expect(within(list).getByText('100×100 · 1 KiB')).toBeTruthy();
    expect(within(list).queryByLabelText('Emoji for broken.png')).toBeNull();
  });

  it('reorders with Up/Down buttons and removes', async () => {
    render(<PackEditor onDone={() => {}} onCancel={() => {}} prepare={prepareOk()} />);
    pickFiles(screen.getByLabelText('Pick sticker images') as HTMLInputElement, [
      new File(['a'], 'a.png', { type: 'image/png' }),
      new File(['b'], 'b.png', { type: 'image/png' }),
    ]);
    const list = await screen.findByRole('list', { name: 'Stickers in this pack' });
    await waitFor(() => expect(within(list).getByText('b.png')).toBeTruthy());

    fireEvent.click(within(list).getByLabelText('Move b.png up'));
    const names = within(list)
      .getAllByText(/\.png/, { selector: 'span' })
      .map((node) => node.textContent)
      .filter((text) => text?.endsWith('.png'));
    expect(names[0]).toBe('b.png');

    fireEvent.click(within(list).getByLabelText('Remove a.png'));
    expect(within(list).queryByText('a.png')).toBeNull();
  });

  it('creates the pack first, then uploads stickers in order with progress', async () => {
    const seenPacks: string[] = [];
    const createPack = vi.fn(async (input: { title: string; visibility?: string }) => ({
      id: 'pack-new',
      ownerId: 'u-you',
      title: input.title,
      visibility: 'private' as const,
      stickers: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
    const uploadFile = vi.fn(async (packId: string) => {
      seenPacks.push(packId);
      return stickerRow(`st-${seenPacks.length}`);
    });
    const onDone = vi.fn();
    render(
      <PackEditor
        onDone={onDone}
        onCancel={() => {}}
        prepare={prepareOk()}
        createPack={createPack}
        uploadFile={uploadFile}
      />,
    );

    const titleInput = screen.getByPlaceholderText('My stickers');
    expect(titleInput.className).toContain('well-surface');
    fireEvent.change(titleInput, { target: { value: 'Cats' } });
    pickFiles(screen.getByLabelText('Pick sticker images') as HTMLInputElement, [
      new File(['a'], 'a.png', { type: 'image/png' }),
      new File(['b'], 'b.png', { type: 'image/png' }),
    ]);
    await screen.findByRole('list', { name: 'Stickers in this pack' });
    await waitFor(() => {
      expect(
        (screen.getByRole('button', { name: 'Create pack' }) as HTMLButtonElement).disabled,
      ).toBe(false);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Create pack' }));
    await waitFor(() => expect(createPack).toHaveBeenCalledTimes(1));
    expect(createPack).toHaveBeenCalledWith({ title: 'Cats', visibility: 'private' });
    await waitFor(() => expect(uploadFile).toHaveBeenCalledTimes(2));
    expect(seenPacks).toEqual(['pack-new', 'pack-new']);
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('pack-new'));
  });

  it('resumes a partial create-mode upload into the same pack (no second pack)', async () => {
    let nextPack = 0;
    const createPack = vi.fn(async (input: { title: string; visibility?: string }) => {
      nextPack += 1;
      return {
        id: `pack-${nextPack}`,
        ownerId: 'u-you',
        title: input.title,
        visibility: 'private' as const,
        stickers: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    });
    const seenPacks: string[] = [];
    const uploadFile = vi.fn(async (packId: string) => {
      seenPacks.push(packId);
      if (seenPacks.length === 1) {
        throw new Error('boom');
      }
      return stickerRow(`st-${seenPacks.length}`);
    });
    const patchPack = vi.fn(
      async (_packId: string, _input: { title?: string; visibility?: 'private' | 'server' }) => ({
        id: 'pack-1',
        ownerId: 'u-you',
        title: 'Big cats',
        visibility: 'private' as const,
        stickers: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
    );
    const onDone = vi.fn();
    render(
      <PackEditor
        onDone={onDone}
        onCancel={() => {}}
        prepare={prepareOk()}
        createPack={createPack}
        uploadFile={uploadFile}
        patchPack={patchPack}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText('My stickers'), { target: { value: 'Cats' } });
    pickFiles(screen.getByLabelText('Pick sticker images') as HTMLInputElement, [
      new File(['a'], 'a.png', { type: 'image/png' }),
      new File(['b'], 'b.png', { type: 'image/png' }),
    ]);
    const list = await screen.findByRole('list', { name: 'Stickers in this pack' });
    await waitFor(() => {
      expect(
        (screen.getByRole('button', { name: 'Create pack' }) as HTMLButtonElement).disabled,
      ).toBe(false);
    });

    // First save: pack minted, the first upload fails, the second lands.
    fireEvent.click(screen.getByRole('button', { name: 'Create pack' }));
    await waitFor(() => expect(createPack).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(uploadFile).toHaveBeenCalledTimes(2));
    expect(within(list).getByText('boom')).toBeTruthy();
    expect(onDone).not.toHaveBeenCalled();

    // Retry the failed file, rename the pack, save again: no second pack,
    // the upload resumes into the first one, the rename is patched onto
    // it, then the editor finishes with it.
    fireEvent.click(within(list).getByRole('button', { name: 'Retry' }));
    fireEvent.change(screen.getByPlaceholderText('My stickers'), { target: { value: 'Big cats' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create pack' }));
    await waitFor(() => expect(uploadFile).toHaveBeenCalledTimes(3));
    expect(createPack).toHaveBeenCalledTimes(1);
    expect(patchPack).toHaveBeenCalledWith('pack-1', { title: 'Big cats', visibility: 'private' });
    expect(seenPacks).toEqual(['pack-1', 'pack-1', 'pack-1']);
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('pack-1'));
  });

  it('retries a failed upload per file', async () => {
    const uploadFile = vi
      .fn(async () => stickerRow('st-1'))
      .mockRejectedValueOnce(new Error('boom'));
    const patchPack = vi.fn(async (_packId: string, _input: { order?: string[] }) => ({
      id: 'pack-1',
      ownerId: 'u-you',
      title: 'Cats',
      visibility: 'private' as const,
      stickers: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
    const onDone = vi.fn();
    render(
      <PackEditor
        packId="pack-1"
        initialTitle="Cats"
        onDone={onDone}
        onCancel={() => {}}
        prepare={prepareOk()}
        uploadFile={uploadFile}
        patchPack={patchPack}
      />,
    );
    pickFiles(screen.getByLabelText('Pick sticker images') as HTMLInputElement, [
      new File(['a'], 'a.png', { type: 'image/png' }),
    ]);
    await screen.findByRole('list', { name: 'Stickers in this pack' });

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(uploadFile).toHaveBeenCalledTimes(1));
    const list = screen.getByRole('list', { name: 'Stickers in this pack' });
    expect(within(list).getByText('boom')).toBeTruthy();
    expect(onDone).not.toHaveBeenCalled();

    fireEvent.click(within(list).getByRole('button', { name: 'Retry' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(uploadFile).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('pack-1'));
  });

  it('edits title and visibility, removes an existing sticker and reorders on save', async () => {
    const existingA: Sticker = { ...stickerRow('st-a'), emoji: '🐱' };
    const existingB: Sticker = { ...stickerRow('st-b'), emoji: '😹' };
    const editedPack = {
      id: 'pack-1',
      ownerId: 'u-you',
      title: 'Big cats',
      visibility: 'private' as const,
      stickers: [existingA],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const patchPack = vi.fn(async (_packId: string, _input: unknown) => editedPack);
    const deleteSticker = vi.fn(async (_packId: string, _stickerId: string) => ({ ok: true }));
    const onDone = vi.fn();
    render(
      <PackEditor
        packId="pack-1"
        initialTitle="Cats"
        initialStickers={[existingA, existingB]}
        onDone={onDone}
        onCancel={() => {}}
        prepare={prepareOk()}
        uploadFile={vi.fn(async () => stickerRow('st-new'))}
        patchPack={patchPack}
        deleteSticker={deleteSticker}
      />,
    );
    const list = await screen.findByRole('list', { name: 'Stickers in this pack' });
    expect(within(list).getByText('Emoji 🐱')).toBeTruthy();
    // No emoji field for existing stickers (the server has no emoji edit).
    expect(within(list).queryByLabelText(/Emoji for/)).toBeNull();

    fireEvent.change(screen.getByPlaceholderText('My stickers'), { target: { value: 'Big cats' } });
    fireEvent.click(within(list).getByLabelText('Remove 😹'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(patchPack).toHaveBeenCalledWith('pack-1', expect.anything()));
    expect(patchPack.mock.calls[0]).toEqual([
      'pack-1',
      { title: 'Big cats', visibility: 'private' },
    ]);
    expect(deleteSticker).toHaveBeenCalledWith('pack-1', 'st-b');
    // The order patch lists the surviving stickers in UI order.
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('pack-1'));
    const orderCall = patchPack.mock.calls.find((call) => {
      const input = call[1] as { order?: string[] };
      return input.order !== undefined;
    });
    expect(orderCall?.[1]).toEqual({ order: ['st-a'] });
  });

  it('disables editing controls while a save is in flight', async () => {
    let release: ((sticker: Sticker) => void) | undefined;
    const uploadFile = vi.fn(
      async () =>
        new Promise<Sticker>((resolve) => {
          release = resolve;
        }),
    );
    render(
      <PackEditor
        packId="pack-1"
        initialTitle="Cats"
        onDone={() => {}}
        onCancel={() => {}}
        prepare={prepareOk()}
        uploadFile={uploadFile}
      />,
    );
    pickFiles(screen.getByLabelText('Pick sticker images') as HTMLInputElement, [
      new File(['a'], 'a.png', { type: 'image/png' }),
      new File(['b'], 'b.png', { type: 'image/png' }),
    ]);
    const list = await screen.findByRole('list', { name: 'Stickers in this pack' });
    await waitFor(() => expect(within(list).getByText('b.png')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(uploadFile).toHaveBeenCalledTimes(1));

    // Everything that could mutate the queued list or the order is frozen
    // mid-save, so the finished order patch matches the UI.
    expect((within(list).getByLabelText('Remove a.png') as HTMLButtonElement).disabled).toBe(true);
    expect((within(list).getByLabelText('Move a.png down') as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((within(list).getByLabelText('Emoji for a.png') as HTMLInputElement).disabled).toBe(
      true,
    );
    expect(screen.getByLabelText('Add sticker images').getAttribute('aria-disabled')).toBe('true');
    expect((screen.getByLabelText('Pick sticker images') as HTMLInputElement).disabled).toBe(true);

    release!(stickerRow('st-1'));
    await waitFor(() => expect(uploadFile).toHaveBeenCalledTimes(2));
  });

  it('keeps Create disabled with no stickers, and asks for a name with stickers', async () => {
    render(<PackEditor onDone={() => {}} onCancel={() => {}} prepare={prepareOk()} />);
    const createButton = screen.getByRole('button', { name: 'Create pack' });
    expect(createButton.getAttribute('data-slot')).toBe('button');
    expect((createButton as HTMLButtonElement).disabled).toBe(true);

    pickFiles(screen.getByLabelText('Pick sticker images') as HTMLInputElement, [
      new File(['a'], 'a.png', { type: 'image/png' }),
    ]);
    await screen.findByRole('list', { name: 'Stickers in this pack' });
    await waitFor(() => {
      expect(
        (screen.getByRole('button', { name: 'Create pack' }) as HTMLButtonElement).disabled,
      ).toBe(false);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create pack' }));
    expect(screen.getByRole('alert').textContent).toContain('Name the pack');
  });

  it('refuses Save while an error row exists instead of skipping it', async () => {
    const uploadFile = vi
      .fn(async () => stickerRow('st-1'))
      .mockRejectedValueOnce(new Error('boom'));
    const editedPack = {
      id: 'pack-1',
      ownerId: 'u-you',
      title: 'Cats',
      visibility: 'private' as const,
      stickers: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const patchPack = vi.fn(async (_packId: string, _input: unknown) => editedPack);
    const onDone = vi.fn();
    render(
      <PackEditor
        packId="pack-1"
        initialTitle="Cats"
        onDone={onDone}
        onCancel={() => {}}
        prepare={prepareOk()}
        uploadFile={uploadFile}
        patchPack={patchPack}
      />,
    );
    pickFiles(screen.getByLabelText('Pick sticker images') as HTMLInputElement, [
      new File(['a'], 'a.png', { type: 'image/png' }),
    ]);
    const list = await screen.findByRole('list', { name: 'Stickers in this pack' });

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(uploadFile).toHaveBeenCalledTimes(1));
    expect(within(list).getByText('boom')).toBeTruthy();

    // Save stays disabled while the error row exists — a re-save can
    // never skip the failed file and close as success. (The guard in
    // `save()` is defense-in-depth for the same invariant.)
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    expect(onDone).not.toHaveBeenCalled();

    // Retrying clears the way: the file uploads and the editor finishes.
    fireEvent.click(within(list).getByRole('button', { name: 'Retry' }));
    await waitFor(() => {
      expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(
        false,
      );
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(uploadFile).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('pack-1'));
  });

  it('deletes a just-uploaded sticker removed in-session and patches the rest', async () => {
    let calls = 0;
    const uploadFile = vi.fn(async () => {
      calls += 1;
      if (calls === 2) {
        throw new Error('boom');
      }
      return stickerRow(`st-new-${calls}`);
    });
    const editedPack = {
      id: 'pack-1',
      ownerId: 'u-you',
      title: 'Cats',
      visibility: 'private' as const,
      stickers: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const patchPack = vi.fn(async (_packId: string, _input: unknown) => editedPack);
    const deleteSticker = vi.fn(async (_packId: string, _stickerId: string) => ({ ok: true }));
    const onDone = vi.fn();
    render(
      <PackEditor
        packId="pack-1"
        initialTitle="Cats"
        onDone={onDone}
        onCancel={() => {}}
        prepare={prepareOk()}
        uploadFile={uploadFile}
        patchPack={patchPack}
        deleteSticker={deleteSticker}
      />,
    );
    pickFiles(screen.getByLabelText('Pick sticker images') as HTMLInputElement, [
      new File(['a'], 'a.png', { type: 'image/png' }),
      new File(['b'], 'b.png', { type: 'image/png' }),
    ]);
    const list = await screen.findByRole('list', { name: 'Stickers in this pack' });
    await waitFor(() => expect(within(list).getByText('b.png')).toBeTruthy());

    // First save: A lands, B fails.
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(uploadFile).toHaveBeenCalledTimes(2));
    expect(within(list).getByText('boom')).toBeTruthy();
    expect(onDone).not.toHaveBeenCalled();

    // Remove the landed A, retry B, save: A is deleted server-side and
    // left out of the order PATCH, so no exact-once 400.
    fireEvent.click(within(list).getByLabelText('Remove a.png'));
    fireEvent.click(within(list).getByRole('button', { name: 'Retry' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(deleteSticker).toHaveBeenCalledWith('pack-1', 'st-new-1'));
    await waitFor(() => expect(uploadFile).toHaveBeenCalledTimes(3));
    const orderCall = patchPack.mock.calls.find((call) => {
      const input = call[1] as { order?: string[] };
      return input.order !== undefined;
    });
    expect(orderCall?.[1]).toEqual({ order: ['st-new-3'] });
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('pack-1'));
  });

  it('switches the visibility hint when the pack visibility changes', () => {
    render(<PackEditor onDone={() => {}} onCancel={() => {}} prepare={prepareOk()} />);

    expect(
      screen.getByText('Only you can find a private pack. Stickers you already sent still show.'),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('radio', { name: 'Shared on this server' }));

    expect(
      screen.getByText('Shared packs can be found and added by anyone on this server.'),
    ).toBeTruthy();
    expect(
      screen.getByRole('radio', { name: 'Shared on this server' }).getAttribute('aria-checked'),
    ).toBe('true');
  });
});
