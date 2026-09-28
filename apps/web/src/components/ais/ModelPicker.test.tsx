import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
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

  it('labels the options as suggestions', () => {
    render(<Harness suggestions={['gpt-4o', 'gpt-4o-mini']} />);
    expect(screen.getByText(/suggested/i)).toBeTruthy();
  });

  it('marks the picked suggestion as checked and fills the input', () => {
    render(<Harness suggestions={['gpt-4o', 'gpt-4o-mini']} />);

    fireEvent.click(screen.getByRole('radio', { name: 'gpt-4o-mini' }));

    expect((screen.getByLabelText('Model') as HTMLInputElement).value).toBe('gpt-4o-mini');
    expect(screen.getByRole('radio', { name: 'gpt-4o-mini' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    expect(screen.getByRole('radio', { name: 'gpt-4o' }).getAttribute('aria-checked')).toBe(
      'false',
    );
  });

  it('clears the selection when a custom value is typed', () => {
    render(<Harness suggestions={['gpt-4o', 'gpt-4o-mini']} />);
    fireEvent.click(screen.getByRole('radio', { name: 'gpt-4o' }));

    const input = screen.getByLabelText('Model') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'my-custom-model' } });

    expect(input.value).toBe('my-custom-model');
    expect(screen.getByRole('radio', { name: 'gpt-4o' }).getAttribute('aria-checked')).toBe(
      'false',
    );
    expect(screen.getByRole('radio', { name: 'gpt-4o-mini' }).getAttribute('aria-checked')).toBe(
      'false',
    );
  });

  it('moves the selection and focus with the arrow keys inside the radiogroup', () => {
    render(<Harness suggestions={['gpt-4o', 'gpt-4o-mini']} />);
    const group = screen.getByRole('radiogroup', { name: 'Model suggestion' });
    const first = within(group).getByRole('radio', { name: 'gpt-4o' });

    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowDown' });

    const second = within(group).getByRole('radio', { name: 'gpt-4o-mini' });
    expect(second.getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(second);
    expect((screen.getByLabelText('Model') as HTMLInputElement).value).toBe('gpt-4o-mini');
  });
});
