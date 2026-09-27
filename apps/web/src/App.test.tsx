import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { protocolVersion } from '@galena/protocol';
import { App } from './App';

afterEach(cleanup);

describe('App', () => {
  it('renders the Galena heading', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Galena' })).toBeTruthy();
  });

  it('renders the subtitle', () => {
    render(<App />);
    expect(screen.getByText('People and AIs, together.')).toBeTruthy();
  });

  it('renders the protocol version from @galena/protocol', () => {
    render(<App />);
    expect(screen.getByText(`protocol v${protocolVersion}`)).toBeTruthy();
  });
});
