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

vi.mock('@/components/FollowButton', () => ({
  default: ({ creatorHandle }: { creatorHandle: string }) =>
    React.createElement('button', { type: 'button' }, `Follow ${creatorHandle}`),
}));

import StorefrontNavActions from '../components/StorefrontNavActions';

describe('StorefrontNavActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('hides the header follow button on the subscribe page to avoid duplicate controls', () => {
    mockUsePathname.mockReturnValue('/@alexwanders/subscribe');

    const html = renderToStaticMarkup(
      <StorefrontNavActions
        creatorHandle="alexwanders"
        initialFollowing={false}
        isLoggedIn
        displayName="QA Subscriber"
        accountHref="/account"
      />,
    );

    expect(html).not.toContain('Follow alexwanders');
    expect(html).toContain('QA Subscriber');
    expect(html).toContain('storefront-account-pill');
  });

  it('shows the header follow button on non-subscribe storefront pages', () => {
    mockUsePathname.mockReturnValue('/@alexwanders');

    const html = renderToStaticMarkup(
      <StorefrontNavActions
        creatorHandle="alexwanders"
        initialFollowing={false}
        isLoggedIn
        displayName="QA Subscriber"
        accountHref="/account"
      />,
    );

    expect(html).toContain('Follow alexwanders');
    expect(html).toContain('QA Subscriber');
    expect(html).toContain('storefront-account-pill');
  });
});
