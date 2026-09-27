import { describe, expect, it } from 'vitest';
import { defaultWorkerRules } from './rules';

describe('defaultWorkerRules', () => {
  it('orders the ruleset so later rules win: asks, then narrow allows, then denies', () => {
    const rules = defaultWorkerRules();

    const askIndexes = rules.flatMap((rule, index) => (rule.effect === 'ask' ? [index] : []));
    const allowIndexes = rules.flatMap((rule, index) => (rule.effect === 'allow' ? [index] : []));
    const denyIndexes = rules.flatMap((rule, index) => (rule.effect === 'deny' ? [index] : []));

    expect(askIndexes.length).toBeGreaterThan(0);
    expect(allowIndexes.length).toBeGreaterThan(0);
    expect(denyIndexes.length).toBeGreaterThan(0);

    const lastAsk = Math.max(...askIndexes);
    const firstAllow = Math.min(...allowIndexes);
    const lastAllow = Math.max(...allowIndexes);
    const firstDeny = Math.min(...denyIndexes);

    expect(lastAsk).toBeLessThan(firstAllow);
    expect(lastAllow).toBeLessThan(firstDeny);
  });

  it('narrows the broad rm -rf ask with an allow for generated directories', () => {
    const rules = defaultWorkerRules();

    const broadAsk = rules.findIndex(
      (rule) => rule.effect === 'ask' && rule.resource === 'rm -rf*',
    );
    const allowedNodeModules = rules.findIndex(
      (rule) => rule.effect === 'allow' && rule.resource === 'rm -rf node_modules*',
    );
    const allowedDist = rules.findIndex(
      (rule) => rule.effect === 'allow' && rule.resource === 'rm -rf dist*',
    );
    const allowedTurbo = rules.findIndex(
      (rule) => rule.effect === 'allow' && rule.resource === 'rm -rf .turbo*',
    );

    expect(broadAsk).toBeGreaterThanOrEqual(0);
    expect(allowedNodeModules).toBeGreaterThan(broadAsk);
    expect(allowedDist).toBeGreaterThan(broadAsk);
    expect(allowedTurbo).toBeGreaterThan(broadAsk);
  });

  it('denies the destructive and network commands', () => {
    const rules = defaultWorkerRules();
    const denied = new Set(
      rules.filter((rule) => rule.effect === 'deny').map((rule) => rule.resource),
    );

    for (const command of [
      'git push*',
      'git merge*',
      'git rebase*',
      'git reset --hard*',
      'git checkout main*',
      'git switch*',
      'git branch -D*',
      'git worktree*',
      'git remote*',
      'git config*',
      'git clean*',
      'gh*',
      'sudo*',
      'ssh*',
      'scp*',
      'npm publish*',
      'pnpm publish*',
      'opencode*',
      'security*',
    ]) {
      expect(denied.has(command)).toBe(true);
    }
  });

  it('targets the shell action, not bash', () => {
    const rules = defaultWorkerRules();
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) {
      expect(rule.action).toBe('shell');
    }
  });
});
