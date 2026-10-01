import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TelegramImportDialog } from './TelegramImportDialog';
import { ApiError } from '@/lib/api';

const donePack = {
  id: '123e4567-e89b-12d3-a456-426614174000',
  ownerId: 'u-you',
  title: 'Fun Cats',
  visibility: 'private' as const,
  importedFrom: 'telegram:FunCats',
  stickers: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe('TelegramImportDialog', () => {
  it('imports from a link and shows the summary with skipped counts', async () => {
    const importFn = vi.fn(async () => ({
      pack: donePack,
      imported: 5,
      skippedAnimated: 3,
      skippedInvalid: 1,
    }));
    render(<TelegramImportDialog onDone={() => {}} onClose={() => {}} importFn={importFn} />);

    fireEvent.change(screen.getByLabelText('Pack link or name'), {
      target: { value: 'https://t.me/addstickers/FunCats' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));

    expect(await screen.findByText('Imported from Telegram: Fun Cats')).toBeTruthy();
    expect(
      screen.getByText(
        '5 stickers added, 3 animated stickers were skipped, 1 file was skipped as invalid.',
      ),
    ).toBeTruthy();
    expect(importFn).toHaveBeenCalledWith('https://t.me/addstickers/FunCats');
  });

  it('shows the progress state while importing', async () => {
    let release: (() => void) | undefined;
    const importFn = vi.fn(
      () =>
        new Promise<never>((_, reject) => {
          release = () => reject(new Error('cancelled'));
        }),
    );
    render(<TelegramImportDialog onDone={() => {}} onClose={() => {}} importFn={importFn} />);
    fireEvent.change(screen.getByLabelText('Pack link or name'), { target: { value: 'FunCats' } });
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));

    expect(await screen.findByRole('button', { name: 'Importing…' })).toBeTruthy();
    release?.();
  });

  it('shows the partial notice when the budget ran out', async () => {
    const importFn = vi.fn(async () => ({
      pack: donePack,
      imported: 4,
      skippedAnimated: 0,
      skippedInvalid: 0,
      partial: true as const,
    }));
    render(<TelegramImportDialog onDone={() => {}} onClose={() => {}} importFn={importFn} />);
    fireEvent.change(screen.getByLabelText('Pack link or name'), { target: { value: 'FunCats' } });
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));

    expect(await screen.findByText(/run it again to fill in the rest/)).toBeTruthy();
  });

  it('shows the personal-use notice before and after the import', async () => {
    const importFn = vi.fn(async () => ({
      pack: donePack,
      imported: 1,
      skippedAnimated: 0,
      skippedInvalid: 0,
    }));
    render(<TelegramImportDialog onDone={() => {}} onClose={() => {}} importFn={importFn} />);
    expect(screen.getByText(/they stay private and cannot be shared server-wide/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Pack link or name'), { target: { value: 'FunCats' } });
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(await screen.findByText(/this pack stays private/)).toBeTruthy();
  });

  it('maps server errors to plain messages', async () => {
    const cases: Array<[ApiError, RegExp]> = [
      [new ApiError(404, 'pack_not_found', 'missing'), /not found/],
      [new ApiError(400, 'custom_emoji_unsupported', 'emoji'), /Custom emoji sets/],
      [new ApiError(503, 'try_later', 'busy'), /Telegram is busy/],
      [new ApiError(429, 'rate_limited', 'slow'), /Too many imports/],
    ];
    for (const [error, pattern] of cases) {
      const importFn = vi.fn(async () => {
        throw error;
      });
      const { unmount } = render(
        <TelegramImportDialog onDone={() => {}} onClose={() => {}} importFn={importFn} />,
      );
      fireEvent.change(screen.getByLabelText('Pack link or name'), {
        target: { value: 'FunCats' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Import' }));
      expect(await screen.findByRole('alert')).toBeTruthy();
      expect(screen.getByRole('alert').textContent).toMatch(pattern);
      unmount();
    }
  });

  it('closes and reports unavailable on 501 so the entry hides', async () => {
    const importFn = vi.fn(async () => {
      throw new ApiError(501, 'import_unavailable', 'off');
    });
    const onClose = vi.fn();
    const onUnavailable = vi.fn();
    render(
      <TelegramImportDialog
        onDone={() => {}}
        onClose={onClose}
        onUnavailable={onUnavailable}
        importFn={importFn}
      />,
    );
    fireEvent.change(screen.getByLabelText('Pack link or name'), { target: { value: 'FunCats' } });
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    await waitFor(() => {
      expect(onUnavailable).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('requires an input before importing', async () => {
    const importFn = vi.fn();
    render(<TelegramImportDialog onDone={() => {}} onClose={() => {}} importFn={importFn} />);
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(importFn).not.toHaveBeenCalled();
  });
});
