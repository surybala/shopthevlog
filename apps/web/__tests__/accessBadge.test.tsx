import { describe, expect, it } from 'vitest';

import AccessBadge from '../components/AccessBadge';

describe('AccessBadge', () => {
  it('renders the provided label', () => {
    const element = AccessBadge({ label: 'Unlocked by following' });

    expect(element.props.children).toBe('Unlocked by following');
  });

  it('uses the reason tone styles when requested', () => {
    const element = AccessBadge({ label: 'Included with your subscription', tone: 'reason' });

    expect(element.props.className).toContain('bg-green-500/15');
    expect(element.props.className).toContain('border-green-400/20');
  });

  it('allows additional class names to be appended', () => {
    const element = AccessBadge({ label: 'Premium access active', tone: 'status', className: 'mt-2' });

    expect(element.props.className).toContain('text-green-200');
    expect(element.props.className).toContain('mt-2');
  });
});
