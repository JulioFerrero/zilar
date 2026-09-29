import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { Attachment } from '@galena/chat-core';
import { FileMessage } from './FileMessage';

const file: Attachment = {
  kind: 'file',
  url: 'https://files.galena.test/tickets.pdf',
  name: 'tickets.pdf',
  size: 2_411_724,
  mime: 'application/pdf',
};

describe('FileMessage', () => {
  it('shows the name, size and type and a download link', () => {
    render(<FileMessage attachment={file} own={false} />);

    expect(screen.getByText('tickets.pdf')).toBeTruthy();
    expect(screen.getByText('2.3 MB · application/pdf')).toBeTruthy();
    const link = screen.getByLabelText('Download tickets.pdf');
    expect(link.getAttribute('href')).toBe(file.url);
    expect(link.getAttribute('download')).toBe('tickets.pdf');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link.getAttribute('target')).toBe('_blank');
  });

  it('shows Uploading… and no link while the bytes are in flight', () => {
    render(<FileMessage attachment={file} own uploading />);

    expect(screen.getByText('Uploading…')).toBeTruthy();
    expect(screen.queryByLabelText('Download tickets.pdf')).toBeNull();
  });

  it('shows a Retry on failure instead of a link', () => {
    const onRetry = vi.fn();
    render(<FileMessage attachment={file} own failed onRetry={onRetry} />);

    expect(screen.getByText('Upload failed')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Retry upload'));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText('Download tickets.pdf')).toBeNull();
  });

  it('never links a javascript: URL', () => {
    render(<FileMessage attachment={{ ...file, url: 'javascript:alert(1)' }} own={false} />);

    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('tickets.pdf')).toBeTruthy();
  });
});
