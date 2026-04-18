import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockUsePathname = vi.fn();

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
    React.createElement('a', { href, ...props }, children),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => mockUsePathname(),
}));

import DashboardNav from '../app/dashboard/DashboardNav';

describe('DashboardNav', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUsePathname.mockReturnValue('/dashboard');
  });

  it('renders svg navigation icons instead of bracket placeholders', () => {
    const html = renderToStaticMarkup(<DashboardNav handle="alex" isAdmin />);

    expect(html).toContain('<svg');
    expect(html).not.toContain('[V]');
    expect(html).not.toContain('[R]');
    expect(html).not.toContain('[K]');
    expect(html).not.toContain('[!]');
    expect(html).toContain('Waitlist');
    expect(html).toContain('Payout Ops');
    expect(html).toContain('text-[#17332d]/76');
    expect(html).toContain('bg-[#17332d]/10 text-[#17332d] font-semibold');
  });
});
