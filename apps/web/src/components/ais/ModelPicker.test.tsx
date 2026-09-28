import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ModelPicker } from './ModelPicker';

// The round-1 T-0032 bug was upstream of this component: the wizard handed it a
// connection id instead of a provider, so the suggestions array arrived empty.
// This test locks in the contract that a click on a suggestion sets the input.
function Harness({ suggestions }: { suggestions: readonly string[] }) {
  const [value, setValue] = useState('');
  return (
    <ModelPicker provider="openai" suggestions={suggestions} value={value} onChange={setValue} />
  );
}

describe('ModelPicker', () => {
  it('sets the input when a suggestion is clicked', () => {
    render(<Harness suggestions={['gpt-4o', 'gpt-4o-mini']} />);

    const input = screen.getByLabelText('Model') as HTMLInputElement;
    expect(input.value).toBe('');

    fireEvent.click(screen.getByRole('radio', { name: 'gpt-4o-mini' }));

    expect(input.value).toBe('gpt-4o-mini');
  });

  it('renders the provider label in the placeholder', () => {
    render(<Harness suggestions={['gpt-4o']} />);
    expect((screen.getByLabelText('Model') as HTMLInputElement).placeholder).toBe(
      'OpenAI model name',
    );
  });
});
