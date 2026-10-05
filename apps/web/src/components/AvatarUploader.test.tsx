import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AvatarUploader } from './AvatarUploader';
import { removeAvatar, uploadAvatar } from '@/lib/api';

vi.mock('@/lib/api', () => ({
  uploadAvatar: vi.fn(),
  removeAvatar: vi.fn(),
}));

const uploadMock = vi.mocked(uploadAvatar);
const removeMock = vi.mocked(removeAvatar);

function pngFile(name = 'photo.png'): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type: 'image/png' });
}

const fakeLoader = async (): Promise<{ width: number; height: number }> => ({
  width: 800,
  height: 400,
});

const fakeExporter = async (): Promise<Blob | null> =>
  new Blob([new Uint8Array([9, 9])], { type: 'image/webp' });

function renderUploader(props?: {
  currentUrl?: string | undefined;
  onChanged?: (url: string | undefined) => void;
}) {
  return render(
    <AvatarUploader
      kind="user"
      ownerId="u-1"
      ownerName="Ada"
      currentUrl={props?.currentUrl}
      onChanged={props?.onChanged ?? (() => {})}
      imageLoader={fakeLoader}
      exporter={fakeExporter}
    />,
  );
}

describe('AvatarUploader', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    uploadMock.mockResolvedValue({ url: '/api/avatars/new-id' });
    removeMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('opens the crop dialog for an image and saves with a busy state', async () => {
    const onChanged = vi.fn();
    renderUploader({ onChanged });
    fireEvent.change(screen.getByLabelText('Choose a picture file'), {
      target: { files: [pngFile()] },
    });
    await waitFor(() =>
      expect(screen.getByRole('dialog', { name: 'Crop your picture' })).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save picture' }));
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeTruthy();
    await waitFor(() => expect(uploadMock).toHaveBeenCalled());
    expect(onChanged).toHaveBeenCalledWith('/api/avatars/new-id');
  });

  it('rejects a non-image file with a clear error', async () => {
    renderUploader();
    fireEvent.change(screen.getByLabelText('Choose a picture file'), {
      target: { files: [new File(['nope'], 'notes.txt', { type: 'text/plain' })] },
    });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('not an image'));
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('shows the server refusal message when the upload fails validation', async () => {
    uploadMock.mockRejectedValue(
      Object.assign(new Error('The picture must be square.'), { code: 'avatar_not_square' }),
    );
    renderUploader();
    fireEvent.change(screen.getByLabelText('Choose a picture file'), {
      target: { files: [pngFile()] },
    });
    await waitFor(() =>
      expect(screen.getByRole('dialog', { name: 'Crop your picture' })).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save picture' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('must be square'));
  });

  it('removes the picture and reports undefined', async () => {
    const onChanged = vi.fn();
    render(
      <AvatarUploader
        kind="group"
        ownerId="g-1"
        ownerName="Trip"
        currentUrl="/api/avatars/old"
        onChanged={onChanged}
        imageLoader={fakeLoader}
        exporter={fakeExporter}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(removeMock).toHaveBeenCalledWith('group', 'g-1'));
    expect(onChanged).toHaveBeenCalledWith(undefined);
  });

  it('shows the current picture when one exists', () => {
    const { container } = renderUploader({ currentUrl: '/api/avatars/old' });
    expect(container.querySelector('img[src="/api/avatars/old"]')).not.toBeNull();
  });

  it('shows the initials, not a text label, when there is no picture', () => {
    const { container } = renderUploader();
    expect(container.querySelector('img')).toBeNull();
    expect(screen.queryByText('No picture')).toBeNull();
    expect(container.textContent).toContain('A');
  });

  it('closes the crop dialog with Escape and revokes the preview URL', async () => {
    const revoke = vi.fn();
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:preview', revokeObjectURL: revoke });
    renderUploader();
    fireEvent.change(screen.getByLabelText('Choose a picture file'), {
      target: { files: [pngFile()] },
    });
    await waitFor(() =>
      expect(screen.getByRole('dialog', { name: 'Crop your picture' })).toBeTruthy(),
    );

    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Crop your picture' })).toBeNull(),
    );
    expect(revoke).toHaveBeenCalledWith('blob:preview');
  });
});
