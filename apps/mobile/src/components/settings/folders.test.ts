import { FOLDER_NAME_MAX, type ChatFolder } from '@zilar/chat-core';
import { describe, expect, it } from 'vitest';

import { folderInput, folderSummary, isFolderNameValid } from './folders';

const FOLDER: ChatFolder = {
  id: 'f-1',
  name: 'Personal',
  icon: 'user',
  position: 0,
  includeTypes: ['dm'],
  includeChats: [],
  excludeChats: [],
  excludeMuted: false,
  excludeRead: false,
};

describe('folderSummary', () => {
  it('joins the selected type labels', () => {
    expect(folderSummary({ ...FOLDER, includeTypes: ['dm', 'group'] })).toBe(
      'Personal chats, Groups',
    );
  });

  it('says so when no type is selected', () => {
    expect(folderSummary({ ...FOLDER, includeTypes: [] })).toBe('No chat types');
  });
});

describe('isFolderNameValid', () => {
  it('accepts a trimmed non-blank name up to the cap', () => {
    expect(isFolderNameValid(' Work ')).toBe(true);
    expect(isFolderNameValid('x')).toBe(true);
    expect(isFolderNameValid('x'.repeat(FOLDER_NAME_MAX))).toBe(true);
  });

  it('rejects blank and over-long names', () => {
    expect(isFolderNameValid('')).toBe(false);
    expect(isFolderNameValid('   ')).toBe(false);
    expect(isFolderNameValid('x'.repeat(FOLDER_NAME_MAX + 1))).toBe(false);
  });
});

describe('folderInput', () => {
  it('trims the name and keeps only the editor fields', () => {
    expect(
      folderInput({
        name: '  Work ',
        icon: 'briefcase',
        includeTypes: ['group'],
        excludeMuted: true,
        excludeRead: false,
      }),
    ).toEqual({
      name: 'Work',
      icon: 'briefcase',
      includeTypes: ['group'],
      excludeMuted: true,
      excludeRead: false,
    });
  });
});
