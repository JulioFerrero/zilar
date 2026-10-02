import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
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

  it('shows the not-set-up state on 501 and never closes silently', async () => {
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
    // The dialog stays open and says why, instead of closing itself.
    expect(await screen.findByText('Telegram import is not set up')).toBeTruthy();
    expect(screen.getByText(/not set up on this server/)).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    expect(onUnavailable).toHaveBeenCalled();
  });

  it('links the settings page for the owner, and names the server runner for others', async () => {
    const failing = vi.fn(async () => {
      throw new ApiError(501, 'import_unavailable', 'off');
    });
    const { unmount } = render(
      <TelegramImportDialog onDone={() => {}} onClose={() => {}} isOwner importFn={failing} />,
    );
    fireEvent.change(screen.getByLabelText('Pack link or name'), { target: { value: 'FunCats' } });
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(await screen.findByText(/integrations settings/)).toBeTruthy();
    unmount();

    render(<TelegramImportDialog onDone={() => {}} onClose={() => {}} importFn={failing} />);
    fireEvent.change(screen.getByLabelText('Pack link or name'), { target: { value: 'FunCats' } });
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(await screen.findByText(/Ask the person who runs this server/)).toBeTruthy();
  });

  it('renders as an overlay like the other dialogs', async () => {
    const importFn = vi.fn(async () => ({
      pack: donePack,
      imported: 1,
      skippedAnimated: 0,
      skippedInvalid: 0,
    }));
    const { container } = render(
      <TelegramImportDialog onDone={() => {}} onClose={() => {}} importFn={importFn} />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Import from Telegram' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.className).toContain('fixed');
    expect(dialog.className).toContain('inset-0');
    // Focus moves into the dialog on open.
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Pack link or name');
    void container;
    void importFn;
  });

  it('requires an input before importing', async () => {
    const importFn = vi.fn();
    render(<TelegramImportDialog onDone={() => {}} onClose={() => {}} importFn={importFn} />);
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(importFn).not.toHaveBeenCalled();
  });
});
