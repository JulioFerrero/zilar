// effect-plain: the jail lifecycle is an async state machine over the Docker
// layer, the workspace and admission; there is no Effect runtime on the host.
import { DeskError } from '../protocol';
import type { DeskChunk, DeskRef, DeskSpec, DeskToolCall, SnapshotRef } from '../hands';
import type { Admission } from './admission';
import type { AgentConfig } from './config';
import { errorMessage, type DockerLayer } from './docker';
import type { EgressRegistrar } from './egress';
import { deskName, type Workspaces } from './workspace';

export type DeskReadinessDetail = 'host_not_set_up' | 'image_unresolved' | null;

export interface DeskStatus {
  readonly running: readonly DeskRef[];
  readonly queued: number;
  readonly ready: boolean;
  /** The pinned ref `<repo>@sha256:<hex>`, or null until resolved. */
  readonly imageDigest: string | null;
  readonly detail: DeskReadinessDetail;
}

export type ProvisionResult =
  | { readonly kind: 'ready'; readonly ref: DeskRef }
  | { readonly kind: 'queued'; readonly position: number };

interface DeskRecord {
  readonly ref: DeskRef;
  readonly spec: DeskSpec;
  lastUsedAt: number;
}

export interface LifecycleDeps {
  readonly docker: DockerLayer;
  readonly workspaces: Workspaces;
  readonly admission: Admission;
  readonly config: AgentConfig;
  readonly egress?: EgressRegistrar | null;
  readonly now?: () => number;
  readonly log?: (message: string) => void;
}

/**
 * Owns the jail lifecycle (plan §4.2): provision is idempotent per `DeskKey`, idle
 * jails stop after `idleMs` (the workspace survives), and `Stop all` kills every jail.
 */
export class Lifecycle {
  private readonly records = new Map<string, DeskRecord>();
  private readonly inflight = new Map<string, Promise<ProvisionResult>>();
  private readonly now: () => number;
  private readonly log: (message: string) => void;
  private readonly egress: EgressRegistrar | null;
  private ready = false;
  private imageDigest: string | null = null;
  private detail: DeskReadinessDetail = 'host_not_set_up';

  constructor(private readonly deps: LifecycleDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.log = deps.log ?? (() => {});
    this.egress = deps.egress ?? null;
  }

  /**
   * Readiness resolves once: the runtime must be registered, then the image source
   * becomes the pin or is pulled. A new release is a new agent container.
   */
  async checkReadiness(): Promise<void> {
    if (this.ready) {
      return;
    }
    if (!(await this.deps.docker.runtimeAvailable())) {
      this.detail = 'host_not_set_up';
      return;
    }
    const source = this.deps.config.docker.image;
    if (source.includes('@sha256:')) {
      this.markReady(source);
      return;
    }
    const resolved = await this.deps.docker.pullAndResolveDigest(source);
    if (resolved === null) {
      this.detail = 'image_unresolved';
      return;
    }
    this.markReady(resolved);
  }

  private markReady(imageDigest: string): void {
    this.ready = true;
    this.imageDigest = imageDigest;
    this.detail = null;
  }

  /** Only the pinned image ever runs: nothing before readiness, then only that digest. */
  private assertPinnedImage(spec: DeskSpec): void {
    if (!this.ready) {
      throw new DeskError('jail_unavailable', 'this server has not set up AI computers yet');
    }
    if (spec.imageDigest !== this.imageDigest) {
      throw new DeskError('jail_unavailable', 'image digest is not the pinned desk image');
    }
  }

  /**
   * A `DeskRef` is valid only when its `id` is the name derived from its own `key`;
   * otherwise a caller could name another owner's jail. An unknown desk and one the
   * caller may not see both answer `not_provisioned`.
   */
  private assertRef(ref: DeskRef): void {
    if (ref.id !== deskName(ref.key)) {
      throw new DeskError('not_provisioned', 'no live desk for this key');
    }
  }

  async provision(spec: DeskSpec): Promise<ProvisionResult> {
    this.assertPinnedImage(spec);
    const name = deskName(spec.key);
    const existing = this.records.get(name);
    if (existing !== undefined) {
      existing.lastUsedAt = this.now();
      // Re-register with the same secret so a proxy restart that lost its registry heals
      // instead of answering 407; a failure is logged and dropped.
      try {
        await this.registerEgress(name, existing.spec);
      } catch (error) {
        this.log(
          `desk ${name}: could not re-register with the egress proxy: ${errorMessage(error)}`,
        );
      }
      return { kind: 'ready', ref: existing.ref };
    }
    // One in-flight provision per key: a concurrent caller joins the same promise.
    const inflight = this.inflight.get(name);
    if (inflight !== undefined) {
      return inflight;
    }
    const task = this.provisionNew(name, spec).finally(() => {
      this.inflight.delete(name);
    });
    this.inflight.set(name, task);
    return task;
  }

  private async provisionNew(name: string, spec: DeskSpec): Promise<ProvisionResult> {
    const admitted = await this.deps.admission.tryAcquire(spec.ownerUserId, name);
    if (!admitted.granted) {
      return { kind: 'queued', position: admitted.position };
    }
    const ref: DeskRef = { id: name, key: spec.key };
    let registered = false;
    try {
      const proxyUrl = await this.registerEgress(name, spec);
      registered = proxyUrl !== null;
      if (await this.deps.docker.inspect(name)) {
        // A jail that survived an earlier agent process still carries that process's proxy
        // secret; remove it so the recreate below mints the current one.
        this.log(`desk ${name}: removed a jail left from an earlier agent run`);
        await this.deps.docker.remove(name);
      }
      const directory = await this.deps.workspaces.ensure(spec.key, spec.limits.diskBytes);
      await this.deps.docker.create(name, spec, directory, proxyUrl);
      await this.deps.docker.start(name);
      this.records.set(name, { ref, spec, lastUsedAt: this.now() });
      return { kind: 'ready', ref };
    } catch (error) {
      if (registered) {
        await this.unregisterEgress(name);
      }
      try {
        await this.deps.docker.remove(name);
      } catch (removeError) {
        this.log(`desk ${name}: could not remove the failed jail: ${errorMessage(removeError)}`);
      }
      try {
        await this.deps.workspaces.release(spec.key);
      } catch (releaseError) {
        this.log(`desk ${name}: could not release the workspace: ${errorMessage(releaseError)}`);
      } finally {
        // Free the slot even when the workspace release throws, or the pool loses it.
        this.deps.admission.release(name);
      }
      throw error instanceof DeskError
        ? error
        : new DeskError('jail_unavailable', 'could not provision the desk');
    }
  }

  private async registerEgress(name: string, spec: DeskSpec): Promise<string | null> {
    if (this.egress === null) {
      return null;
    }
    try {
      return await this.egress.register(name, spec.egress?.allowedHosts ?? null);
    } catch {
      throw new DeskError('jail_unavailable', 'could not reach the egress proxy');
    }
  }

  /** Unregisters the desk; a failure is logged and dropped, never thrown. */
  private async unregisterEgress(name: string): Promise<void> {
    if (this.egress === null) {
      return;
    }
    try {
      await this.egress.unregister(name);
    } catch (error) {
      this.log(`desk ${name}: could not unregister from the egress proxy: ${errorMessage(error)}`);
    }
  }

  execute(ref: DeskRef, call: DeskToolCall, signal?: AbortSignal): AsyncIterable<DeskChunk> {
    return this.runCall(ref, call, signal);
  }

  private async *runCall(
    ref: DeskRef,
    call: DeskToolCall,
    signal?: AbortSignal,
  ): AsyncIterable<DeskChunk> {
    this.assertRef(ref);
    const record = this.records.get(ref.id);
    if (record === undefined) {
      throw new DeskError('not_provisioned', 'no live desk for this key');
    }
    record.lastUsedAt = this.now();
    if (!(await this.deps.docker.inspect(ref.id))) {
      throw new DeskError('jail_unavailable', 'the jail is not running');
    }
    yield* this.deps.docker.run(ref.id, call, signal);
  }

  /** Kills the jail; the workspace image survives unless `keepWorkspace` is false. */
  async stop(ref: DeskRef, opts?: { readonly keepWorkspace?: boolean }): Promise<void> {
    this.assertRef(ref);
    this.records.delete(ref.id);
    try {
      await this.deps.docker.remove(ref.id);
      if (opts?.keepWorkspace === false) {
        await this.deps.workspaces.remove(ref.key);
      } else {
        await this.deps.workspaces.release(ref.key);
      }
    } finally {
      // Mount/umount can throw after the container is gone; the slot must still be freed.
      this.deps.admission.release(ref.id);
      await this.unregisterEgress(ref.id);
    }
  }

  async snapshot(ref: DeskRef, label: string): Promise<SnapshotRef> {
    this.assertRef(ref);
    const bytes = await this.deps.workspaces.snapshot(ref.key, label);
    return { deskId: ref.id, label, bytes };
  }

  status(): DeskStatus {
    return {
      running: [...this.records.values()].map((record) => record.ref),
      queued: this.deps.admission.queued,
      ready: this.ready,
      imageDigest: this.imageDigest,
      detail: this.detail,
    };
  }

  async sweepIdle(): Promise<readonly DeskRef[]> {
    const cutoff = this.now() - this.deps.config.idleMs;
    const stopped: DeskRef[] = [];
    for (const record of Array.from(this.records.values())) {
      if (record.lastUsedAt <= cutoff) {
        await this.stop(record.ref);
        stopped.push(record.ref);
      }
    }
    return stopped;
  }

  /**
   * `Stop all`: removes every desk container and releases every workspace even if one
   * release throws; records and admission are always cleared.
   */
  async stopAll(): Promise<number> {
    for (const name of await this.deps.docker.listDeskNames()) {
      await this.deps.docker.remove(name);
    }
    let failures = 0;
    const deskIds = [...this.records.keys()];
    for (const record of this.records.values()) {
      try {
        await this.deps.workspaces.release(record.spec.key);
      } catch (error) {
        failures += 1;
        this.log(`desk ${record.ref.id}: could not release the workspace: ${errorMessage(error)}`);
      }
    }
    this.records.clear();
    this.deps.admission.clear();
    for (const deskId of deskIds) {
      await this.unregisterEgress(deskId);
    }
    return failures;
  }
}
