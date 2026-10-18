// effect-plain: one private internal network per jail, shared only with the egress
// proxy. Name and label are fixed in code; no caller input reaches a docker argument.
import { DeskError } from '../protocol';
import { DESK_LABEL } from './docker';
import { containerAddress, egressContainerId, execFile, type Exec } from './docker-args';

export const DESK_NETWORK_PREFIX = 'zilar-desk-';

export function deskNetworkName(jailName: string): string {
  return `${DESK_NETWORK_PREFIX}${jailName}`;
}

function lines(output: string): readonly string[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

// Creates the jail's internal network, or reuses one a crash left behind.
export async function ensureDeskNetwork(jailName: string, exec: Exec = execFile): Promise<string> {
  const network = deskNetworkName(jailName);
  try {
    await exec('docker', [
      'network',
      'create',
      '--internal',
      '--label',
      `${DESK_LABEL}=${jailName}`,
      network,
    ]);
    return network;
  } catch {
    try {
      await exec('docker', ['network', 'inspect', network]);
      return network;
    } catch {
      throw new DeskError(
        'jail_unavailable',
        `could not create the network for ${jailName}; Docker's address pool may be full`,
      );
    }
  }
}

// Joins the proxy to the jail network; on failure the jail starts without web access.
export async function connectEgress(
  network: string,
  host: string,
  exec: Exec = execFile,
): Promise<string | null> {
  try {
    const id = await egressContainerId(host, exec);
    if (id === null) {
      return null;
    }
    try {
      await exec('docker', ['network', 'connect', network, id]);
    } catch {
      // Already connected from an earlier run: the address read below decides.
    }
    return await containerAddress(network, id, exec);
  } catch {
    return null;
  }
}

async function networkContainerNames(network: string, exec: Exec): Promise<readonly string[]> {
  try {
    const output = await exec('docker', [
      'network',
      'inspect',
      '-f',
      '{{range .Containers}}{{.Name}} {{end}}',
      network,
    ]);
    return output.split(/\s+/).filter((name) => name.length > 0);
  } catch {
    return [];
  }
}

export async function disconnectContainers(network: string, exec: Exec = execFile): Promise<void> {
  for (const name of await networkContainerNames(network, exec)) {
    try {
      await exec('docker', ['network', 'disconnect', network, name]);
    } catch {
      // Already detached: removal stays idempotent.
    }
  }
}

export async function removeNetwork(network: string, exec: Exec = execFile): Promise<void> {
  await disconnectContainers(network, exec);
  try {
    await exec('docker', ['network', 'rm', network]);
  } catch {
    // Already gone.
  }
}

export async function removeDeskNetwork(jailName: string, exec: Exec = execFile): Promise<void> {
  await removeNetwork(deskNetworkName(jailName), exec);
}

// Startup sweep: removes every `zilar.desk`-labelled network whose jail is gone,
// catching networks left by a crash.
export async function cleanupDeskNetworks(
  liveJailNames: readonly string[],
  exec: Exec = execFile,
): Promise<number> {
  let output: string;
  try {
    output = await exec('docker', [
      'network',
      'ls',
      '--filter',
      `label=${DESK_LABEL}`,
      '--format',
      `{{.Name}} {{.Label "${DESK_LABEL}"}}`,
    ]);
  } catch {
    return 0;
  }
  const live = new Set(liveJailNames);
  let removed = 0;
  for (const line of lines(output)) {
    const [network, jailName] = line.split(/\s+/, 2);
    if (network === undefined || jailName === undefined || live.has(jailName)) {
      continue;
    }
    await removeNetwork(network, exec);
    removed += 1;
  }
  return removed;
}
