import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ImageMessage } from './ImageMessage';

describe('ImageMessage', () => {
  it('reserves the aspect ratio from the known size and is lazy', () => {
    render(
      <ImageMessage
        url="https://files.zilar.test/stage.png"
        alt="stage.png"
        width={800}
        height={400}
      />,
    );

    const image = screen.getByRole('img') as HTMLImageElement;
    expect(image.getAttribute('loading')).toBe('lazy');
    expect(image.getAttribute('width')).toBe('800');
    expect(image.getAttribute('height')).toBe('400');
    expect(image.style.aspectRatio).toBe('800 / 400');
    expect(image.getAttribute('alt')).toBe('stage.png');
  });

  it('links only http(s) images and opens them safely', () => {
    render(<ImageMessage url="https://files.zilar.test/stage.png" alt="stage.png" />);

    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toBe('https://files.zilar.test/stage.png');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('never links a javascript: URL', () => {
    render(<ImageMessage url="javascript:alert(1)" alt="bad" />);

    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByRole('img')).toBeTruthy();
  });

  it('shows a small tile when the image is broken', () => {
    render(<ImageMessage url="https://files.zilar.test/gone.png" alt="gone.png" />);

    fireEvent.error(screen.getByRole('img'));

    expect(screen.getByText('Image unavailable')).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
  });
});
