import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

// Lazy route pages load their chunk on first render; a cold import can take longer than 1 s.
configure({ asyncUtilTimeout: 5000 });

afterEach(() => {
  cleanup();
});

// jsdom does not implement scrollIntoView, which the message list uses to bring
// the unread divider into view.
Element.prototype.scrollIntoView = () => {};
