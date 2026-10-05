import { describe, expect, it, vi } from 'vitest';

import { FOLDER_ICONS } from '@zilar/chat-core';

import { folderIcon } from './folder-icon';

vi.mock('lucide-react-native', () => ({
  Bell: 'Bell',
  Bookmark: 'Bookmark',
  Bot: 'Bot',
  Briefcase: 'Briefcase',
  Camera: 'Camera',
  Code: 'Code',
  Coffee: 'Coffee',
  Dumbbell: 'Dumbbell',
  Flag: 'Flag',
  Folder: 'Folder',
  Gamepad2: 'Gamepad2',
  Globe: 'Globe',
  GraduationCap: 'GraduationCap',
  Heart: 'Heart',
  House: 'House',
  Megaphone: 'Megaphone',
  MessageCircle: 'MessageCircle',
  Music: 'Music',
  Plane: 'Plane',
  ShoppingBag: 'ShoppingBag',
  Star: 'Star',
  User: 'User',
  Users: 'Users',
  Wallet: 'Wallet',
}));

describe('folderIcon', () => {
  it('maps every FOLDER_ICONS name to its own component', () => {
    for (const name of FOLDER_ICONS) {
      expect(folderIcon(name)).toBeTruthy();
      if (name !== 'folder') {
        expect(folderIcon(name)).not.toBe(folderIcon('folder'));
      }
    }
  });

  it('falls back to Folder for an unknown name', () => {
    expect(folderIcon('no-such-icon' as never)).toBe(folderIcon('folder'));
  });
});
