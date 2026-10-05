import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});

// jsdom does not implement scrollIntoView, which the message list uses to bring
// the unread divider into view.
Element.prototype.scrollIntoView = () => {};
