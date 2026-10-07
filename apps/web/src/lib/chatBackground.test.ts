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
