import { describe, expect, it } from 'vitest';
import { fileExtension, formatFileMeta, isPdfAttachment } from './files';

describe('fileExtension', () => {
  it('upper-cases the last extension', () => {
    expect(fileExtension('tickets.pdf')).toBe('PDF');
    expect(fileExtension('archive.tar.gz')).toBe('GZ');
  });

  it('returns nothing for a name without a usable extension', () => {
    expect(fileExtension('README')).toBe('');
    expect(fileExtension('.gitignore')).toBe('');
    expect(fileExtension('trailing.')).toBe('');
  });
});

describe('formatFileMeta', () => {
  it('joins the size and the upper-case extension', () => {
    expect(formatFileMeta(3993, 'tickets.pdf')).toBe('3.9 KB PDF');
  });

  it('keeps only the size when the name has no extension', () => {
    expect(formatFileMeta(500, 'README')).toBe('500 B');
  });

  it('keeps the extension when the size is unknown', () => {
    expect(formatFileMeta(Number.NaN, 'tickets.pdf')).toBe('PDF');
  });
});

describe('isPdfAttachment', () => {
  it('accepts the PDF MIME whatever the name', () => {
    expect(isPdfAttachment({ name: 'download', mime: 'application/pdf' })).toBe(true);
    expect(isPdfAttachment({ name: 'download', mime: 'Application/PDF' })).toBe(true);
  });

  it('accepts a .pdf name when the MIME is generic', () => {
    expect(isPdfAttachment({ name: 'report.PDF', mime: 'application/octet-stream' })).toBe(true);
    expect(isPdfAttachment({ name: 'report.pdf', mime: '' })).toBe(true);
  });

  it('rejects a non-generic MIME and a non-pdf name', () => {
    expect(isPdfAttachment({ name: 'report.pdf', mime: 'image/svg+xml' })).toBe(false);
    expect(isPdfAttachment({ name: 'report.txt', mime: 'application/octet-stream' })).toBe(false);
  });
});
