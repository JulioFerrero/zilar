// Pure helpers that compare the iOS native modules Expo autolinking expects
// with the pods recorded in ios/Podfile.lock. No I/O here: the boot check
// passes in text it has already read.

function expectObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Unexpected expo-modules-autolinking output: ${label} is not an object`);
  }
  return value as Record<string, unknown>;
}

function expectArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`Unexpected expo-modules-autolinking output: ${label} is not an array`);
  }
  return value;
}

/**
 * Extract the pod names autolinking expects from the JSON printed by
 * `expo-modules-autolinking resolve --platform ios --json`.
 */
export function parseAutolinkingPods(jsonText: string): string[] {
  const parsed = expectObject(JSON.parse(jsonText), 'the document');
  const modules = expectArray(parsed.modules, 'modules');
  const pods = new Set<string>();
  for (const [index, entry] of modules.entries()) {
    const module = expectObject(entry, `modules[${index}]`);
    const modulePods = expectArray(module.pods, `modules[${index}].pods`);
    for (const [podIndex, podEntry] of modulePods.entries()) {
      const pod = expectObject(podEntry, `modules[${index}].pods[${podIndex}]`);
      if (typeof pod.podName !== 'string' || pod.podName.length === 0) {
        throw new Error(
          `Unexpected expo-modules-autolinking output: modules[${index}].pods[${podIndex}].podName is not a string`,
        );
      }
      pods.add(pod.podName);
    }
  }
  return [...pods].sort();
}

/**
 * Extract the top-level pod names from a Podfile.lock. Lines indented four
 * spaces are nested dependencies (and subspecs), not pods of their own, so
 * only the two-space entries under PODS: count.
 */
export function parsePodfileLockPods(lockfileText: string): string[] {
  const pods: string[] = [];
  let inPodsSection = false;
  for (const line of lockfileText.split('\n')) {
    if (!inPodsSection) {
      if (line.trimEnd() === 'PODS:') {
        inPodsSection = true;
      }
      continue;
    }
    if (line.length > 0 && !line.startsWith(' ')) {
      break;
    }
    const match = /^ {2}- ([^\s(]+)/.exec(line);
    if (match) {
      pods.push(match[1]);
    }
  }
  return pods;
}

/**
 * The comparison at the heart of the boot check: which autolinked pods are
 * absent from the lockfile. Extra pods in the lockfile are fine — the lockfile
 * always contains far more than the autolinked modules (React, Yoga, ...).
 */
export function findMissingPods(expectedPods: string[], lockfileText: string): string[] {
  const present = new Set(parsePodfileLockPods(lockfileText));
  return expectedPods.filter((pod) => !present.has(pod));
}
