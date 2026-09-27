import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { App } from './App';

describe('App', () => {
  it('renders the chat shell with the search field', () => {
    render(<App />);
    expect(screen.getByLabelText('Search chats')).toBeTruthy();
  });

  it('renders the mock chat list', () => {
    render(<App />);
    expect(screen.getByText('Ana')).toBeTruthy();
    expect(screen.getByText('Dev team')).toBeTruthy();
  });
});
