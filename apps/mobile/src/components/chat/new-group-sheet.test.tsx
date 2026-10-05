import { describe, expect, it, vi } from 'vitest';

import {
  buildGroupCreateInput,
  canGoNext,
  NewGroupSheetBody,
  nextGroupCreateInput,
  toggleSelected,
  validateGroupName,
} from './new-group-sheet';
import {
  buildGroupCreateInput as buildGuardedGroupCreateInput,
  groupCreateGuard,
  publicCreateError,
} from './visibility-fields';
import type { Contact } from '@/lib/chat-api';

// The body is hook-free, so it is called as a plain function with
// `react-native` stubbed (same pattern as `new-message-sheet.test.tsx`):
// Node only, no simulator, no new dependency.
vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  TextInput: 'TextInput',
  View: 'View',
}));

vi.mock('@/components/ui/text', () => ({
  Text: 'Text',
}));

vi.mock('@/components/chat/avatar', () => ({
  Avatar: 'Avatar',
}));

vi.mock('lucide-react-native', () => ({
  Check: 'Check',
}));

// The wrapper's guard path is covered against the real builders below;
// the body renders whatever localError the wrapper hands it (the same
// render output, guard sentence included).

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('@/components/directory/use-directory-api', () => ({
  useDirectoryApi: () => ({ api: { checkGroupHandle: async () => ({ available: true }) } }),
}));

vi.mock('@/lib/depth', () => ({
  ICON_COLOR: '#d4d4d4',
}));

interface TestElement {
  type: unknown;
  props: { children?: unknown; onPress?: () => void; [key: string]: unknown };
}

function collect(node: unknown, out: TestElement[] = []): TestElement[] {
  if (Array.isArray(node)) {
    for (const child of node) {
      collect(child, out);
    }
    return out;
  }
  if (node === null || node === undefined || typeof node !== 'object') {
    return out;
  }
  const element = node as { type?: unknown; props?: { children?: unknown } };
  if (element.props === undefined) {
    return out;
  }
  if (typeof element.type === 'function') {
    const Component = element.type as (props: unknown) => unknown;
    return collect(Component(element.props), out);
  }
  out.push(element as TestElement);
  collect(element.props.children, out);
  return out;
}

function textOf(node: unknown): string {
  if (node === null || node === undefined) {
    return '';
  }
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(textOf).join('');
  }
  if (typeof node === 'object' && 'props' in (node as TestElement)) {
    const element = node as TestElement;
    if (typeof element.type === 'function') {
      const Component = element.type as (props: unknown) => unknown;
      return textOf(Component(element.props));
    }
    return textOf(element.props.children);
  }
  return '';
}

const ANA: Contact = { userId: 'u-ana', name: 'Ana', jid: 'ana@zilar.test' };
const LUIS: Contact = { userId: 'u-luis', name: 'Luis', jid: 'luis@zilar.test' };

function body(
  overrides: Partial<Parameters<typeof NewGroupSheetBody>[0]> = {},
  handlers: Partial<Pick<Parameters<typeof NewGroupSheetBody>[0], 'onCreate'>> = {},
) {
  return NewGroupSheetBody({
    contacts: [ANA, LUIS],
    busy: false,
    error: '',
    step: 'members',
    selected: [],
    title: '',
    localError: '',
    visibility: 'private' as const,
    handle: '',
    check: null,
    checking: false,
    onToggle: () => {},
    onNext: () => {},
    onBack: () => {},
    onTitle: () => {},
    onVisibility: () => {},
    onHandle: () => {},
    onCreate: handlers.onCreate ?? (() => {}),
    onClose: () => {},
    ...overrides,
  });
}

function button(elements: TestElement[], label: string): TestElement {
  const found = elements.find((element) => element.props.accessibilityLabel === label);
  expect(found).toBeDefined();
  return found as TestElement;
}

function press(element: TestElement): void {
  const onPress = element.props.onPress;
  expect(typeof onPress).toBe('function');
  (onPress as () => void)();
}

describe('new-group step logic (T-0214)', () => {
  it('toggles a contact in and out of the selection', () => {
    expect(toggleSelected([], 'u-ana')).toEqual(['u-ana']);
    expect(toggleSelected(['u-ana', 'u-luis'], 'u-ana')).toEqual(['u-luis']);
    expect(toggleSelected(['u-luis'], 'u-ana')).toEqual(['u-luis', 'u-ana']);
  });

  it('needs at least one contact before Next', () => {
    expect(canGoNext([])).toBe(false);
    expect(canGoNext(['u-ana'])).toBe(true);
  });

  it('rejects a blank group name with the web sentence', () => {
    expect(validateGroupName('   ')).toBe('Enter a group name');
    expect(validateGroupName('Weekend club')).toBeUndefined();
  });

  it('builds the Create payload with a trimmed title and the selected ids', () => {
    expect(buildGroupCreateInput('  Weekend club  ', ['u-ana', 'u-luis'])).toEqual({
      title: 'Weekend club',
      memberIds: ['u-ana', 'u-luis'],
    });
  });

  it('blocks Create on a blank name (the wrapper sets the empty-name sentence)', () => {
    expect(nextGroupCreateInput('   ', ['u-ana'])).toBeUndefined();
    expect(nextGroupCreateInput('  Weekend club  ', ['u-ana'])).toEqual({
      title: 'Weekend club',
      memberIds: ['u-ana'],
    });
  });

  it('Public without a handle blocks Create with the guard sentence', () => {
    expect(groupCreateGuard('Weekend club', 'public', '   ', null)).toEqual({
      error: 'Choose a handle for the public group.',
    });
  });

  it('Public with an available handle carries visibility and handle', () => {
    // The guarded builder is the wrapper's exact Create path (the body
    // takes `localError` only): a regression dropping `visibility` or
    // `handle` from the wrapper's `onCreate(...)` call fails here.
    expect(
      buildGuardedGroupCreateInput('  Weekend club  ', ['u-ana'], 'public', '  hiking_club  ', {
        available: true,
      }),
    ).toEqual({
      input: {
        title: 'Weekend club',
        memberIds: ['u-ana'],
        visibility: 'public',
        handle: 'hiking_club',
      },
    });
    expect(buildGuardedGroupCreateInput('Weekend club', ['u-ana'], 'private', '', null)).toEqual({
      input: { title: 'Weekend club', memberIds: ['u-ana'] },
    });
  });

  it('shows the selected check in a light color on the dark sheet surface', () => {
    const elements = collect(body({ selected: ['u-ana'] }));
    const checks = elements.filter((element) => element.type === 'Check');
    expect(checks).toHaveLength(1);
    expect(checks[0]?.props.color).toBe('#d4d4d4');
  });
});

describe('NewGroupSheetBody members step', () => {
  it('asks to invite a friend when there are no contacts', () => {
    const all = textOf(collect(body({ contacts: [] })));
    expect(all).toContain('Add members');
    expect(all).toContain('Invite a friend first to start a group.');
  });

  it('lists contacts as checkboxes and marks the selected ones', () => {
    const elements = collect(body({ selected: ['u-ana'] }));
    const ana = button(elements, 'Ana');
    expect(ana.props.accessibilityRole).toBe('checkbox');
    expect(ana.props.accessibilityState).toEqual({ checked: true });
    const luis = button(elements, 'Luis');
    expect(luis.props.accessibilityState).toEqual({ checked: false });
    // Only the selected row shows the check icon.
    expect(elements.filter((element) => element.type === 'Check')).toHaveLength(1);
  });

  it('toggling a row calls onToggle with that contact', () => {
    const toggled: string[] = [];
    press(button(collect(body({ onToggle: (userId) => toggled.push(userId) })), 'Luis'));
    expect(toggled).toEqual(['u-luis']);
  });

  it('Next is disabled until a contact is selected', () => {
    expect(button(collect(body({ selected: [] })), 'Next').props.disabled).toBe(true);
    expect(button(collect(body({ selected: ['u-ana'] })), 'Next').props.disabled).toBe(false);
  });

  it('Next calls onNext (the wrapper advances, keeping the selection)', () => {
    const calls: string[] = [];
    press(button(collect(body({ selected: ['u-ana'], onNext: () => calls.push('next') })), 'Next'));
    expect(calls).toEqual(['next']);
  });

  it('Cancel calls onClose', () => {
    const calls: string[] = [];
    press(button(collect(body({ onClose: () => calls.push('close') })), 'Cancel'));
    expect(calls).toEqual(['close']);
  });
});

describe('NewGroupSheetBody name step', () => {
  it('shows the Group name field with the web placeholder', () => {
    const elements = collect(body({ step: 'name' }));
    const all = textOf(elements);
    expect(all).toContain('Group name');
    const field = elements.find((element) => element.type === 'TextInput');
    expect(field).toBeDefined();
    expect((field as TestElement).props.placeholder).toBe('Group name');
    expect((field as TestElement).props.maxLength).toBe(100);
  });

  it('shows the empty-name sentence instead of creating', () => {
    const all = textOf(collect(body({ step: 'name', localError: 'Enter a group name' })));
    expect(all).toContain('Enter a group name');
  });

  it('shows the server failure inline, never raw server text', () => {
    const all = textOf(
      collect(body({ step: 'name', error: 'Could not create the group. Try again.' })),
    );
    expect(all).toContain('Could not create the group. Try again.');
  });

  it('Public without a handle blocks Create with the guard sentence', () => {
    expect(publicCreateError('public', '  ', null, 'group')).toBe(
      'Choose a handle for the public group.',
    );
    // The body renders the wrapper-owned localError the guard produced.
    const all = textOf(
      collect(body({ step: 'name', localError: 'Choose a handle for the public group.' })),
    );
    expect(all).toContain('Choose a handle for the public group.');
  });

  it('Public renders the visibility row and the handle field on the name step', () => {
    const elements = collect(body({ step: 'name', visibility: 'public', handle: 'hiking_club' }));
    expect(elements.filter((element) => element.type === 'TextInput')).toHaveLength(2);
    expect(
      elements.filter(
        (element) =>
          element.type === 'TextInput' &&
          (element as TestElement).props.placeholder === 'hiking_club',
      ),
    ).toHaveLength(1);
  });

  it('Create calls onCreate (the wrapper validates and passes title + ids)', () => {
    const calls: string[] = [];
    press(
      button(
        collect(body({ step: 'name' }, { onCreate: () => calls.push('create') })),
        'Create group',
      ),
    );
    expect(calls).toEqual(['create']);
  });
  it('Back calls onBack', () => {
    const calls: string[] = [];
    press(button(collect(body({ step: 'name', onBack: () => calls.push('back') })), 'Back'));
    expect(calls).toEqual(['back']);
  });

  it('busy reads Creating… and disables Create', () => {
    const elements = collect(body({ step: 'name', busy: true }));
    expect(textOf(elements)).toContain('Creating…');
    expect(button(elements, 'Create group').props.disabled).toBe(true);
  });
});
