import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { AttachmentPreview } from './AttachmentPreview';

describe('AttachmentPreview', () => {
  it('shows an image thumbnail, the name and the size', () => {
    render(
      <AttachmentPreview
        attachment={{ file: new File(['abcd'], 'stage.png', { type: 'image/png' }), kind: 'image' }}
        previewUrl="blob:preview"
        onCancel={() => {}}
      />,
    );

    expect(screen.getByText('stage.png')).toBeTruthy();
    expect(screen.getByText('4 B')).toBeTruthy();
    expect((screen.getByRole('img') as HTMLImageElement).getAttribute('src')).toBe('blob:preview');
  });

  it('shows the file icon for a file and cancels with ✕', () => {
    const onCancel = vi.fn();
    render(
      <AttachmentPreview
        attachment={{
          file: new File(['abcd'], 'plan.pdf', { type: 'application/pdf' }),
          kind: 'file',
        }}
        onCancel={onCancel}
      />,
    );

    expect(screen.getByText('plan.pdf')).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
    fireEvent.click(screen.getByLabelText('Remove attachment'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
