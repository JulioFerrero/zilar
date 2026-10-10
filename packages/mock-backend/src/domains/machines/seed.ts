import type { Machine } from '@zilar/api-contract';
import type { MockSeed } from '../../data';

/** One pending, one approved online, one revoked (the plan's §11.5 sketch). */
export const mockMachines: readonly Machine[] = [
  {
    id: 'mach-pending',
    name: 'office-linux',
    status: 'pending',
    os: 'linux',
    osVersion: '6.6.0',
    arch: 'x86_64',
    cpu: 'AMD Ryzen 9 7950X',
    cores: 16,
    ramGb: 64,
    diskFreeGb: 920,
    drivers: ['docker', 'linux-vm'],
    fingerprint: 'a1b2c3d4e5f60718',
    createdAt: '2026-09-29T08:00:00.000Z',
    approvedAt: null,
    lastSeenAt: null,
  },
  {
    id: 'mach-approved',
    name: 'dev-mac',
    status: 'approved',
    os: 'macos',
    osVersion: '27.0',
    arch: 'arm64',
    cpu: 'Apple M3 Pro',
    cores: 11,
    ramGb: 18,
    diskFreeGb: 200,
    drivers: ['docker', 'apple-container', 'macos-vm'],
    fingerprint: 'b2c3d4e5f607182a',
    createdAt: '2026-09-25T10:00:00.000Z',
    approvedAt: '2026-09-25T10:01:00.000Z',
    lastSeenAt: '2026-09-29T07:55:00.000Z',
    online: true,
  },
  {
    id: 'mach-revoked',
    name: 'old-macbook',
    status: 'revoked',
    os: 'macos',
    osVersion: '26.4',
    arch: 'arm64',
    cpu: 'Apple M2',
    cores: 8,
    ramGb: 16,
    diskFreeGb: 320,
    drivers: ['docker', 'macos-vm'],
    fingerprint: 'c3d4e5f607182a3b',
    createdAt: '2026-08-10T10:00:00.000Z',
    approvedAt: '2026-08-10T10:01:00.000Z',
    lastSeenAt: '2026-09-20T11:00:00.000Z',
  },
];

export function seedMachines(): Partial<MockSeed> {
  return { machines: mockMachines };
}
