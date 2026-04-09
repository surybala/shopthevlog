import { expect, test, type Page } from '@playwright/test'

const PREMIUM_USER_ID = 'e2e-user-subscriber-premium'

async function authenticateAndSeedPremium(page: Page) {
  const api = page.context().request

  const loginResponse = await api.post('/api/test-support/login', {
    data: { userId: PREMIUM_USER_ID },
  })
  expect(loginResponse.ok()).toBeTruthy()

  const seedResponse = await api.post('/api/test-support/seed/subscriber-flow', {
    data: { userId: PREMIUM_USER_ID, mode: 'premium' },
  })
  expect(seedResponse.ok()).toBeTruthy()

  return seedResponse.json() as Promise<{
    creatorHandle: string
    premiumKitSlug: string
  }>
}

test.describe('subscriber premium access flow', () => {
  test.afterEach(async ({ page }) => {
    await page.context().request.delete('/api/test-support/login')
  })

  test('premium subscriber can access premium kits and sees the subscription in account', async ({ page }) => {
    const seed = await authenticateAndSeedPremium(page)

    await page.goto(`/@${seed.creatorHandle}/kits/${seed.premiumKitSlug}`)
    await expect(page.getByText('Subscribe to unlock this kit')).toHaveCount(0)
    await expect(page.getByText('Private Ryokan Transfer')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Save kit' })).toBeVisible()

    await page.goto('/account?tab=subscriptions')
    await expect(page.getByText('Premium Insider')).toBeVisible()
    await expect(page.getByText('Active')).toBeVisible()

    await page.goto('/account?tab=following')
    await expect(page.getByText('Premium access active')).toBeVisible()
  })
})
