import { describe, expect, it } from 'vitest';
import { chatBackgroundStyle, effectiveBackground } from './chatBackground';

const unset = { backgroundPreset: null, backgroundImageId: null, backgroundDim: null };

describe('effectiveBackground', () => {
  it('prefers the per-chat preset over the global default', () => {
    expect(effectiveBackground({ backgroundPreset: 'gold' }, { backgroundPreset: 'navy' })).toEqual(
      { kind: 'preset', id: 'gold' },
    );
  });

  it('prefers the per-chat image over the global default', () => {
    expect(
      effectiveBackground(
        { backgroundImageId: 'abc', backgroundDim: 55 },
        { backgroundPreset: 'gold' },
      ),
    ).toEqual({ kind: 'image', imageId: 'abc', dim: 55 });
  });

  it('uses the global default when the pref is empty', () => {
    expect(effectiveBackground(unset, { backgroundPreset: 'navy' })).toEqual({
      kind: 'preset',
      id: 'navy',
    });
  });

  it('falls back to slate when both are empty', () => {
    expect(effectiveBackground(undefined, null)).toEqual({ kind: 'preset', id: 'slate' });
    expect(effectiveBackground(unset, unset)).toEqual({ kind: 'preset', id: 'slate' });
  });

  it('falls back to slate for an unknown preset id', () => {
    expect(effectiveBackground({ backgroundPreset: 'chartreuse' }, null)).toEqual({
      kind: 'preset',
      id: 'slate',
    });
  });

  // T-0466: the group background sits between the per-chat pref and the
  // caller's global default.
  it('prefers the group background over the global default', () => {
    expect(
      effectiveBackground(unset, { backgroundPreset: 'gold' }, { backgroundPreset: 'navy' }),
    ).toEqual({ kind: 'preset', id: 'navy' });
  });

  it('prefers the per-chat preset over the group background', () => {
    expect(
      effectiveBackground({ backgroundPreset: 'gold' }, null, { backgroundPreset: 'navy' }),
    ).toEqual({ kind: 'preset', id: 'gold' });
  });

  it('paints a group image with its dim', () => {
    expect(
      effectiveBackground(undefined, null, { backgroundImageId: 'g-1', backgroundDim: 25 }),
    ).toEqual({ kind: 'image', imageId: 'g-1', dim: 25 });
  });

  it('falls back to the default when the group background is empty', () => {
    expect(effectiveBackground(unset, { backgroundPreset: 'wine' }, unset)).toEqual({
      kind: 'preset',
      id: 'wine',
    });
  });
});

describe('chatBackgroundStyle', () => {
  it('gives no inline style for slate, keeping the CSS default', () => {
    expect(chatBackgroundStyle({ kind: 'preset', id: 'slate' })).toEqual({});
  });

  it('paints a coloured dot grid for another preset', () => {
    const style = chatBackgroundStyle({ kind: 'preset', id: 'navy' });
    expect(style.background).toContain('#1d3357');
    expect(style.background).toContain('#0b1322');
  });

  it('layers the dim over the image url', () => {
    const style = chatBackgroundStyle({ kind: 'image', imageId: 'abc', dim: 55 });
    expect(style.background).toContain('rgba(0,0,0,0.55)');
    expect(style.background).toContain('/api/backgrounds/abc');
  });

  it('defaults an image dim to 40', () => {
    const effective = effectiveBackground({ backgroundImageId: 'abc' }, null);
    expect(effective).toEqual({ kind: 'image', imageId: 'abc', dim: 40 });
    expect(chatBackgroundStyle(effective).background).toContain('rgba(0,0,0,0.4)');
  });
});
