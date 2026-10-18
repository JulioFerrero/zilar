import { describe, expect, it } from 'vitest';
import {
  classifyMime,
  fileExtension,
  formatFileMeta,
  isPdfAttachment,
  mimeOrOctetStream,
  safeHttpUrl,
} from './files';

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

describe('classifyMime', () => {
  it('treats the four raster types as images', () => {
    expect(classifyMime('image/png')).toBe('image');
    expect(classifyMime('image/jpeg')).toBe('image');
    expect(classifyMime('image/gif')).toBe('image');
    expect(classifyMime('image/webp')).toBe('image');
  });

  it('lowercases the MIME before comparing', () => {
    expect(classifyMime('IMAGE/PNG')).toBe('image');
    expect(classifyMime('Image/WebP')).toBe('image');
  });

  it('never treats SVG as an image: it can carry script', () => {
    expect(classifyMime('image/svg+xml')).toBe('file');
    expect(classifyMime('IMAGE/SVG+XML')).toBe('file');
  });

  it('treats an empty or unknown MIME as a file', () => {
    expect(classifyMime('')).toBe('file');
    expect(classifyMime(undefined)).toBe('file');
    expect(classifyMime('application/pdf')).toBe('file');
  });
});

describe('safeHttpUrl', () => {
  it('passes http and https URLs unchanged', () => {
    expect(safeHttpUrl('https://chat.zilar.app/upload/a.png')).toBe(
      'https://chat.zilar.app/upload/a.png',
    );
    expect(safeHttpUrl('http://localhost:5280/upload/a.png')).toBe(
      'http://localhost:5280/upload/a.png',
    );
  });

  it('rejects a javascript: or data: URL', () => {
    expect(safeHttpUrl('javascript:alert(1)')).toBeUndefined();
    expect(safeHttpUrl('data:text/html,<script>alert(1)</script>')).toBeUndefined();
  });

  it('rejects a relative, malformed or non-http URL', () => {
    expect(safeHttpUrl('/upload/a.png')).toBeUndefined();
    expect(safeHttpUrl('not a url')).toBeUndefined();
    expect(safeHttpUrl('file:///tmp/a.png')).toBeUndefined();
  });
});

describe('mimeOrOctetStream', () => {
  it('falls back to octet-stream for an empty or missing MIME', () => {
    expect(mimeOrOctetStream('')).toBe('application/octet-stream');
    expect(mimeOrOctetStream(undefined)).toBe('application/octet-stream');
  });

  it('keeps a reported MIME untouched', () => {
    expect(mimeOrOctetStream('image/png')).toBe('image/png');
    expect(mimeOrOctetStream('IMAGE/PNG')).toBe('IMAGE/PNG');
  });
});
