import { describe, expect, it } from 'vitest';
import type { DockerSettings } from './config';
import { createDockerLayer } from './docker';
import { createArgs, type Exec } from './docker-args';
import { PACKAGE, spec } from './test-support';

const SETTINGS: DockerSettings = {
  runtime: 'runc',
  image: PACKAGE,
  network: 'desk-net',
  cgroupParent: null,
};

interface DockerCall {
  readonly command: string;
  readonly args: readonly string[];
}

type Reply = (args: readonly string[]) => string;

/** Records every docker call and answers the ones a test registered. */
class FakeCli {
  readonly calls: DockerCall[] = [];
  private readonly replies: Array<{
    readonly match: (args: readonly string[]) => boolean;
    readonly reply: Reply;
  }> = [];

  reply(match: (args: readonly string[]) => boolean, output: string | Reply): this {
    this.replies.push({ match, reply: typeof output === 'string' ? () => output : output });
    return this;
  }

  readonly exec: Exec = (command, args) => {
    this.calls.push({ command, args });
    for (const { match, reply } of this.replies) {
      if (match(args)) {
        try {
          return Promise.resolve(reply(args));
        } catch (error) {
          return Promise.reject(error);
        }
      }
    }
    return Promise.reject(new Error(`unexpected docker call: ${args.join(' ')}`));
  };
}

function call(cli: FakeCli, predicate: (entry: DockerCall) => boolean): DockerCall {
  const found = cli.calls.find(predicate);
  if (found === undefined) {
    throw new Error('expected a docker call that never happened');
  }
  return found;
}

function flagValue(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

const isNetworkArgs =
  (action: string) =>
  (args: readonly string[]): boolean =>
    args[0] === 'network' && args[1] === action;

const isNetworkCall =
  (action: string) =>
  (entry: DockerCall): boolean =>
    isNetworkArgs(action)(entry.args);

describe('desk network in the jail args', () => {
  it('uses the jail own network and pins the proxy address', () => {
    const args = createArgs(
      'desk-ai1-p1',
      spec(),
      '/tmp/ws',
      SETTINGS,
      'http://desk-egress:3128',
      '172.18.0.5',
      'zilar-desk-desk-ai1-p1',
    );

    expect(flagValue(args, '--network')).toBe('zilar-desk-desk-ai1-p1');
    expect(flagValue(args, '--add-host')).toBe('desk-egress:172.18.0.5');
  });

  it('falls back to the configured network when none is passed', () => {
    const args = createArgs('desk-ai1-p1', spec(), '/tmp/ws', SETTINGS, null);
    expect(flagValue(args, '--network')).toBe('desk-net');
  });
});

describe('per-jail docker network', () => {
  it('creates the private network, joins egress, then creates the jail on it', async () => {
    const cli = new FakeCli()
      .reply(isNetworkArgs('create'), '')
      .reply((args) => args[0] === 'ps' && args.includes('-q'), 'egress-id\n')
      .reply(isNetworkArgs('connect'), '')
      .reply((args) => args[0] === 'inspect', '172.18.0.7\n')
      .reply((args) => args[0] === 'create', '');
    const docker = createDockerLayer(SETTINGS, cli.exec, () => {});

    await docker.create('desk-ai1-p1', spec(), '/tmp/ws', 'http://desk-egress:3128');

    const networkCreate = call(cli, isNetworkCall('create'));
    expect(networkCreate.args).toEqual([
      'network',
      'create',
      '--internal',
      '--label',
      'zilar.desk=desk-ai1-p1',
      'zilar-desk-desk-ai1-p1',
    ]);
    expect(call(cli, isNetworkCall('connect')).args).toEqual([
      'network',
      'connect',
      'zilar-desk-desk-ai1-p1',
      'egress-id',
    ]);
    const created = call(cli, (entry) => entry.args[0] === 'create');
    expect(flagValue(created.args, '--network')).toBe('zilar-desk-desk-ai1-p1');
    expect(flagValue(created.args, '--add-host')).toBe('desk-egress:172.18.0.7');
    expect(cli.calls.indexOf(call(cli, isNetworkCall('connect')))).toBeLessThan(
      cli.calls.indexOf(created),
    );
  });

  it('reuses a network left from an earlier run', async () => {
    const cli = new FakeCli()
      .reply(isNetworkArgs('create'), () => {
        throw new Error('network already exists');
      })
      .reply(isNetworkArgs('inspect'), '[]')
      .reply((args) => args[0] === 'create', '');
    const docker = createDockerLayer(SETTINGS, cli.exec, () => {});

    await docker.create('desk-ai1-p1', spec(), '/tmp/ws', null);

    expect(call(cli, isNetworkCall('inspect')).args).toEqual([
      'network',
      'inspect',
      'zilar-desk-desk-ai1-p1',
    ]);
    expect(flagValue(call(cli, (entry) => entry.args[0] === 'create').args, '--network')).toBe(
      'zilar-desk-desk-ai1-p1',
    );
  });

  it('still isolates a jail with no proxy and connects nothing', async () => {
    const cli = new FakeCli()
      .reply(isNetworkArgs('create'), '')
      .reply((args) => args[0] === 'create', '');
    const docker = createDockerLayer(SETTINGS, cli.exec, () => {});

    await docker.create('desk-ai1-p1', spec(), '/tmp/ws', null);

    expect(
      cli.calls.some((entry) => entry.args[0] === 'network' && entry.args[1] === 'connect'),
    ).toBe(false);
    expect(flagValue(call(cli, (entry) => entry.args[0] === 'create').args, '--network')).toBe(
      'zilar-desk-desk-ai1-p1',
    );
  });

  it('leaves a runner desk on network none without creating a network', async () => {
    const cli = new FakeCli().reply((args) => args[0] === 'create', '');
    const docker = createDockerLayer({ ...SETTINGS, network: 'none' }, cli.exec, () => {});

    await docker.create('desk-ai1-p1', spec(), '/tmp/ws', null);

    expect(cli.calls.some((entry) => entry.args[0] === 'network')).toBe(false);
    expect(flagValue(call(cli, (entry) => entry.args[0] === 'create').args, '--network')).toBe(
      'none',
    );
  });

  it('disconnects egress and removes the network on remove', async () => {
    const cli = new FakeCli()
      .reply((args) => args[0] === 'rm', '')
      .reply(isNetworkArgs('inspect'), 'desk-egress ')
      .reply(isNetworkArgs('disconnect'), '')
      .reply(isNetworkArgs('rm'), '');
    const docker = createDockerLayer(SETTINGS, cli.exec, () => {});

    await docker.remove('desk-ai1-p1');

    expect(cli.calls.map((entry) => entry.args.slice(0, 2).join(' '))).toEqual([
      'rm -f',
      'network inspect',
      'network disconnect',
      'network rm',
    ]);
    expect(cli.calls[2]?.args).toEqual([
      'network',
      'disconnect',
      'zilar-desk-desk-ai1-p1',
      'desk-egress',
    ]);
    expect(cli.calls[3]?.args).toEqual(['network', 'rm', 'zilar-desk-desk-ai1-p1']);
  });

  it('startup cleanup removes only labelled networks with no live jail', async () => {
    const cli = new FakeCli()
      .reply((args) => args[0] === 'ps' && args.includes('--all'), 'desk-ai1-p1\n')
      .reply(
        (args) => args[0] === 'network' && args[1] === 'ls',
        'zilar-desk-desk-ai1-p1 desk-ai1-p1\nzilar-desk-desk-ai2-p2 desk-ai2-p2\n',
      )
      .reply(isNetworkArgs('inspect'), '')
      .reply(isNetworkArgs('rm'), '');
    const docker = createDockerLayer(SETTINGS, cli.exec, () => {});

    const removed = await docker.cleanupNetworks?.();

    expect(removed).toBe(1);
    const removals = cli.calls
      .filter((entry) => entry.args[0] === 'network' && entry.args[1] === 'rm')
      .map((entry) => entry.args[2]);
    expect(removals).toEqual(['zilar-desk-desk-ai2-p2']);
  });

  it('names the address pool when the network cannot be created', async () => {
    const logs: string[] = [];
    const cli = new FakeCli();
    const docker = createDockerLayer(SETTINGS, cli.exec, (message) => logs.push(message));

    await expect(docker.create('desk-ai1-p1', spec(), '/tmp/ws', null)).rejects.toMatchObject({
      code: 'jail_unavailable',
    });
    expect(logs.join(' ')).toContain('address pool');
  });
});
