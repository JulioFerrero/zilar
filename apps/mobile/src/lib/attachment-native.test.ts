import { describe, expect, it, vi } from 'vitest';

import { cacheDestinationFor } from './attachment-native';
import { cleanFilename } from './attachments';

vi.mock('expo-document-picker', () => ({
  getDocumentAsync: async () => ({ canceled: true }),
}));

vi.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: async () => ({ granted: false }),
  requestCameraPermissionsAsync: async () => ({ granted: false }),
}));

vi.mock('expo-file-system', () => ({
  File: class {},
  Paths: { cache: 'file:///cache' },
  UploadType: { BINARY_CONTENT: 0 },
}));

vi.mock('react-native', () => ({
  Share: { share: async () => {} },
}));

describe('attachment opener destination (T-0150 review)', () => {
  it('sanitizes a traversal name to its bare file name', () => {
    expect(cacheDestinationFor('../../x.pdf')).toBe('x.pdf');
    expect(cacheDestinationFor('/tmp/evil.pdf')).toBe('evil.pdf');
    expect(cacheDestinationFor('C:\\Users\\a\\notes.pdf')).toBe('notes.pdf');
  });

  it('keeps an ordinary name untouched', () => {
    expect(cacheDestinationFor('tickets.pdf')).toBe('tickets.pdf');
    expect(cacheDestinationFor('stage photo.png')).toBe('stage photo.png');
  });

  it('matches cleanFilename exactly', () => {
    for (const name of ['../../x.pdf', '', '  ', 'a/b\\c.txt']) {
      expect(cacheDestinationFor(name)).toBe(cleanFilename(name));
    }
  });
});
