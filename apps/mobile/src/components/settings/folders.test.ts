import { FOLDER_NAME_MAX, type ChatFolder } from '@zilar/chat-core';
import { describe, expect, it } from 'vitest';

import { editorState, folderInput, folderSummary, isFolderNameValid } from './folders';

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

  it('shows only the chat count when no type is selected', () => {
    expect(folderSummary({ ...FOLDER, includeTypes: [], includeChats: ['c-1'] })).toBe('1 chat');
    expect(folderSummary({ ...FOLDER, includeTypes: [], includeChats: ['c-1', 'c-2'] })).toBe(
      '2 chats',
    );
  });

  it('joins the type labels and the chat count', () => {
    expect(folderSummary({ ...FOLDER, includeTypes: ['dm'], includeChats: ['c-1'] })).toBe(
      'Personal chats, 1 chat',
    );
    expect(folderSummary({ ...FOLDER, includeTypes: ['dm'], includeChats: ['c-1', 'c-2'] })).toBe(
      'Personal chats, 2 chats',
    );
  });

  it('says so when neither a type nor a chat is selected', () => {
    expect(folderSummary({ ...FOLDER, includeTypes: [], includeChats: [] })).toBe('No rules yet');
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

describe('editorState', () => {
  it('is new for the create route', () => {
    expect(editorState(undefined, undefined, false)).toBe('new');
    expect(editorState('new', undefined, true)).toBe('new');
  });

  it('is ready as soon as the folder is in the store', () => {
    expect(editorState('f-1', FOLDER, true)).toBe('ready');
    expect(editorState('f-1', FOLDER, false)).toBe('ready');
  });

  it('is loading before the folders sync and missing once they have', () => {
    expect(editorState('f-1', undefined, false)).toBe('loading');
    expect(editorState('f-1', undefined, true)).toBe('missing');
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
