import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { MachinePicker } from './machine-picker';
import type { Machine } from '@/lib/machines-api';

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  View: 'View',
}));

const CREATED_AT = '2026-10-03T10:00:00.000Z';

function machine(overrides: Partial<Machine> & { id: string }): Machine {
  return {
    name: 'Machine',
    status: 'approved',
    os: 'macOS',
    osVersion: '15.0',
    arch: 'arm64',
    cpu: 'Apple M3',
    cores: 8,
    ramGb: 16,
    diskFreeGb: 120,
    drivers: [],
    fingerprint: 'fp',
    createdAt: CREATED_AT,
    approvedAt: CREATED_AT,
    lastSeenAt: CREATED_AT,
    ...overrides,
  };
}

const APPROVED = machine({ id: 'm-1', name: 'Home server' });
const PENDING = machine({ id: 'm-2', name: 'Laptop', status: 'pending' });

describe('MachinePicker', () => {
  it('lists approved machines plus the platform option', () => {
    const html = renderToStaticMarkup(
      createElement(MachinePicker, {
        machines: [APPROVED, PENDING],
        loaded: true,
        value: 'm-1',
        onChange: () => {},
      }),
    );
    expect(html).toContain('The platform (no machine)');
    expect(html).toContain('Home server');
    expect(html).not.toContain('Laptop');
  });

  it('shows only the platform line until the list loads', () => {
    const html = renderToStaticMarkup(
      createElement(MachinePicker, {
        machines: [],
        loaded: false,
        value: null,
        onChange: () => {},
      }),
    );
    expect(html).not.toContain('The platform (no machine)');
  });

  it('keeps an unknown current machine visible instead of switching silently', () => {
    const html = renderToStaticMarkup(
      createElement(MachinePicker, {
        machines: [APPROVED],
        loaded: true,
        value: 'm-gone',
        onChange: () => {},
      }),
    );
    expect(html).toContain('Current machine (unavailable)');
  });

  // T-0185 round 1: the edit screen passes the AI's parsed `machineId` as
  // `value`, so the row matching the AI's home machine is the selected one
  // (the `OptionRow` carries the selected border classes for it, exactly
  // one row when one machine is the current home).
  it('marks the AI home machine row as selected', () => {
    const other = machine({ id: 'm-2', name: 'Office box' });
    const selected = renderToStaticMarkup(
      createElement(MachinePicker, {
        machines: [APPROVED, other],
        loaded: true,
        value: 'm-1',
        onChange: () => {},
      }),
    );
    const platformSelected = renderToStaticMarkup(
      createElement(MachinePicker, {
        machines: [APPROVED, other],
        loaded: true,
        value: null,
        onChange: () => {},
      }),
    );
    const selectedRows = (html: string): number =>
      (html.match(/border-accent bg-surface-raised/g) ?? []).length;
    expect(selectedRows(selected)).toBe(1);
    expect(selectedRows(platformSelected)).toBe(1);
    expect(selected.indexOf('Home server')).toBeGreaterThan(-1);
    expect(selected).not.toBe(platformSelected);
  });
});
