import { describe, expect, it } from 'vitest';

import { findMissingPods, parseAutolinkingPods, parsePodfileLockPods } from './pods';

// Trimmed to the shape `expo-modules-autolinking resolve --platform ios --json`
// really prints on this machine (see the Report for the captured output).
const realAutolinkingJson = JSON.stringify({
  extraDependencies: [],
  coreFeatures: ['swiftui', 'compose'],
  modules: [
    {
      packageName: 'expo-secure-store',
      pods: [{ podName: 'ExpoSecureStore', podspecDir: '/x/node_modules/expo-secure-store/ios' }],
      debugOnly: false,
    },
    {
      packageName: 'expo',
      pods: [{ podName: 'Expo', podspecDir: '/x/node_modules/expo' }],
      debugOnly: false,
    },
    {
      packageName: 'expo-modules-core',
      pods: [{ podName: 'ExpoModulesCore', podspecDir: '/x/node_modules/expo-modules-core' }],
      debugOnly: false,
    },
  ],
});

// The PODS: block of a real CocoaPods lockfile: top-level pods are indented
// two spaces, nested dependencies four.
const realLockfilePods = `PODS:
  - EXConstants (57.0.19):
    - ExpoModulesCore
  - Expo (57.0.25):
    - ExpoModulesCore
  - ExpoModulesCore (57.0.0)
  - React-Core (0.86.3)
  - boost (1.83.0)
  - glog (0.3.5):
    - glog/strip-prefix (= 0.3.5)

DEPENDENCIES:
  - Expo
`;

describe('findMissingPods', () => {
  it('reports ExpoSecureStore as missing when the expected list has it and the lockfile does not (the T-0026 launch crash)', () => {
    const expected = parseAutolinkingPods(realAutolinkingJson);
    const lockfileWithoutSecureStore = realLockfilePods.replace(/^ {2}- ExpoSecureStore.*\n/gm, '');

    expect(expected).toContain('ExpoSecureStore');
    expect(findMissingPods(expected, lockfileWithoutSecureStore)).toEqual(['ExpoSecureStore']);
  });

  it('returns an empty list when every expected pod is in the lockfile', () => {
    const expected = ['Expo', 'ExpoModulesCore', 'ExpoSecureStore'];
    const lockfile = `PODS:
  - Expo (57.0.25):
    - ExpoModulesCore
  - ExpoModulesCore (57.0.0)
  - ExpoSecureStore (57.0.4):
    - ExpoModulesCore
`;

    expect(findMissingPods(expected, lockfile)).toEqual([]);
  });

  it('ignores extra pods in the lockfile', () => {
    const expected = ['Expo'];
    const lockfile = `PODS:
  - Expo (57.0.25):
    - ExpoModulesCore
  - React-Core (0.86.3)
  - boost (1.83.0)
`;

    expect(findMissingPods(expected, lockfile)).toEqual([]);
  });

  it('reports everything as missing when the lockfile has no PODS section', () => {
    expect(findMissingPods(['Expo'], 'DEPENDENCIES:\n  - Expo\n')).toEqual(['Expo']);
  });
});

describe('parseAutolinkingPods', () => {
  it('collects and sorts the pod names of every module', () => {
    expect(parseAutolinkingPods(realAutolinkingJson)).toEqual([
      'Expo',
      'ExpoModulesCore',
      'ExpoSecureStore',
    ]);
  });

  it('rejects output it does not understand instead of silently passing', () => {
    expect(() => parseAutolinkingPods('{"modules": "nope"}')).toThrow(/modules/);
    expect(() => parseAutolinkingPods('{"modules": [{"pods": [{}]}]}')).toThrow(/podName/);
    expect(() => parseAutolinkingPods('not json')).toThrow();
  });
});

describe('parsePodfileLockPods', () => {
  it('reads top-level pods and skips nested dependencies and subspecs', () => {
    expect(parsePodfileLockPods(realLockfilePods)).toEqual([
      'EXConstants',
      'Expo',
      'ExpoModulesCore',
      'React-Core',
      'boost',
      'glog',
    ]);
  });

  it('returns nothing for a lockfile without a PODS section', () => {
    expect(parsePodfileLockPods('')).toEqual([]);
    expect(parsePodfileLockPods('DEPENDENCIES:\n  - Expo\n')).toEqual([]);
  });
});
