import { describe, expect, it } from 'vitest';
import { FOLDER_ICONS } from '@zilar/chat-core';
import { folderIconComponent } from './folderIcon';
import { Folder } from 'lucide-react';

describe('folderIconComponent', () => {
  it('maps every FOLDER_ICONS name to a component', () => {
    for (const name of FOLDER_ICONS) {
      expect(folderIconComponent(name)).toBeTruthy();
    }
  });

  it('falls back to Folder for an unknown name', () => {
    expect(folderIconComponent('no-such-icon' as never)).toBe(Folder);
  });
});
