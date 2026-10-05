import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  loadPrompt,
  loadRulesFile,
  promptsDir,
  renderPrompt,
  unfilledPlaceholders,
  type PromptName,
} from './prompts';

const NAMES = [
  'worker',
  'switch',
  'resume',
  'nudge',
  'prereview',
  'prereview-resume',
  'scout',
  'qa',
  'autofix',
  'doctor',
  'doctor-resume',
  'fresh',
] as PromptName[];

describe('prompt templates', () => {
  it('ships every template the CLI needs', () => {
    for (const name of NAMES) {
      expect(fs.existsSync(path.join(promptsDir(), `${name}.md`)), name).toBe(true);
    }
  });

  it('renders the worker prompt with no placeholders left', () => {
    const rendered = renderPrompt(loadPrompt(promptsDir(), 'worker'), {
      TASK: 'T-0038',
      TASK_FILE: 'T-0038-lead-autopilot.md',
      WORKTREE: '/tmp/zilar-T-0038',
      BRANCH: 'task/T-0038-lead-autopilot',
    });
    expect(unfilledPlaceholders(rendered)).toEqual([]);
    // It says what launch.py's first prompt says today.
    expect(rendered).toContain('work/T-0038-lead-autopilot.md');
    expect(rendered).toContain('AGENTS.md');
    expect(rendered).toContain('pnpm install');
    expect(rendered).toContain('status: review');
    expect(rendered).toContain('T-0038:');
    expect(rendered).toContain('--reporter=dot');
    expect(rendered).toContain('pnpm gate');
  });

  it('renders resume and nudge prompts', () => {
    const vars = {
      TASK: 'T-0038',
      TASK_FILE: 'T-0038-lead-autopilot.md',
      WORKTREE: '/tmp/zilar-T-0038',
      BRANCH: 'task/x',
    };
    expect(unfilledPlaceholders(renderPrompt(loadPrompt(promptsDir(), 'resume'), vars))).toEqual(
      [],
    );
    expect(unfilledPlaceholders(renderPrompt(loadPrompt(promptsDir(), 'nudge'), vars))).toEqual([]);
    expect(renderPrompt(loadPrompt(promptsDir(), 'resume'), vars)).toMatch(/quota/i);
  });

  it('renders the switch prompt with no placeholders left', () => {
    const rendered = renderPrompt(loadPrompt(promptsDir(), 'switch'), {
      TASK: 'T-0051',
      TASK_FILE: 'T-0051-lead-switch-model-and-merge-cleanup.md',
      WORKTREE: '/tmp/zilar-T-0051',
      BRANCH: 'task/T-0051-lead-switch-model',
    });
    expect(unfilledPlaceholders(rendered)).toEqual([]);
    expect(rendered).toContain('T-0051');
    expect(rendered).toContain('work/T-0051-lead-switch-model-and-merge-cleanup.md');
    expect(rendered).toContain('AGENTS.md');
    expect(rendered).toContain('status: review');
  });

  it('keeps the pre-review short-format contract', () => {
    const rendered = renderPrompt(loadPrompt(promptsDir(), 'prereview'), {
      TASK: 'T-0038',
      TASK_FILE: 'T-0038-lead-autopilot.md',
      WORKTREE: '/tmp/zilar-T-0038',
      BRANCH: 'task/x',
      HEAD: 'abc123',
      SHORT_HEAD: 'abc123',
      BASE: 'main',
    });
    expect(unfilledPlaceholders(rendered)).toEqual([]);
    expect(rendered).toContain('PREREVIEW.md');
    expect(rendered).toContain('Verdict:');
    expect(rendered).toContain('60 lines');
    expect(rendered).toContain('file:line');
    expect(rendered).toContain('Counts: must-fix=N, should-fix=N, nit=N, follow-up=N');
    expect(rendered).toContain('Follow-ups');
    expect(rendered).toContain('--reporter=dot');
    expect(rendered).toContain('Do NOT run install');
  });

  it('renders the doctor prompt with no placeholders left', () => {
    const rendered = renderPrompt(loadPrompt(promptsDir(), 'doctor'), {
      HEAD: 'a'.repeat(40),
      SHORT_HEAD: 'aaaaaaa',
      SINCE: 'b'.repeat(40),
      SHORT_SINCE: 'bbbbbbb',
      WORKTREE: '/tmp/zilar-doctor',
    });
    expect(unfilledPlaceholders(rendered)).toEqual([]);
    expect(rendered).toContain('DOCTOR.md');
    expect(rendered).toContain('Counts: must-fix=N, should-fix=N, nit=N');
    expect(rendered).toContain('Verdict:');
  });

  it('renders the doctor-resume prompt with no placeholders left', () => {
    const rendered = renderPrompt(loadPrompt(promptsDir(), 'doctor-resume'), {});
    expect(unfilledPlaceholders(rendered)).toEqual([]);
    expect(rendered).toMatch(/rate limit/i);
    expect(rendered).toContain('DOCTOR.md');
  });

  it('renders the autofix prompt for a fresh session with no placeholders left', () => {
    const rendered = renderPrompt(loadPrompt(promptsDir(), 'autofix'), {
      TASK: 'T-0038',
      TASK_FILE: 'T-0038-lead-autopilot.md',
      WORKTREE: '/tmp/zilar-T-0038',
      BRANCH: 'task/x',
    });
    expect(unfilledPlaceholders(rendered)).toEqual([]);
    expect(rendered).toMatch(/fresh session/i);
    expect(rendered).toContain('PREREVIEW.md');
    expect(rendered).toContain('AGENTS.md');
    expect(rendered).toContain('--reporter=dot');
    expect(rendered).not.toMatch(/same session/i);
  });

  it('renders the fresh reply prompt with no placeholders left', () => {
    const rendered = renderPrompt(loadPrompt(promptsDir(), 'fresh'), {
      TASK: 'T-0038',
      TASK_FILE: 'T-0038-lead-autopilot.md',
      WORKTREE: '/tmp/zilar-T-0038',
      BRANCH: 'task/x',
    });
    expect(unfilledPlaceholders(rendered)).toEqual([]);
    expect(rendered).toContain('T-0038');
    expect(rendered).toContain('AGENTS.md');
    expect(rendered).toContain('work/T-0038-lead-autopilot.md');
    expect(rendered).toContain('/tmp/zilar-T-0038');
  });

  it('renders scout and qa with their inputs', () => {
    const scout = renderPrompt(loadPrompt(promptsDir(), 'scout'), {
      TASK: 'T-1',
      TASK_FILE: 'f.md',
      WORKTREE: '/tmp/w',
      BRANCH: 'b',
      QUESTIONS: 'Where is auth?',
    });
    expect(scout).toContain('Where is auth?');
    expect(scout).toContain('SCOUT.md');
    const qa = renderPrompt(loadPrompt(promptsDir(), 'qa'), {
      TASK: 'T-1',
      TASK_FILE: 'f.md',
      WORKTREE: '/tmp/w',
      BRANCH: 'b',
      CHECKLIST: 'Log in.',
      SHOT_DIR: '/tmp/shots',
    });
    expect(qa).toContain('Log in.');
    expect(qa).toContain('QA.md');
  });
});

describe('rules.json', () => {
  it('is a valid OpenCode ruleset with the Appendix C base', () => {
    const rules = loadRulesFile(path.join(promptsDir(), 'rules.json'));
    expect(rules.length).toBeGreaterThan(20);
    expect(rules[0]).toMatchObject({ action: 'shell', resource: 'curl *', effect: 'ask' });
    // The command tool's action is `shell`, never `bash`.
    expect(rules.every((rule) => rule.action === 'shell')).toBe(true);
    // Deny rules come last so they win.
    const lastDeny = rules.map((rule) => rule.effect).lastIndexOf('deny');
    const firstAllow = rules.map((rule) => rule.effect).indexOf('allow');
    expect(lastDeny).toBeGreaterThan(firstAllow);
  });

  it('rejects a malformed rules file', () => {
    expect(() => loadRulesFile('/nonexistent.json')).toThrow();
  });
});
