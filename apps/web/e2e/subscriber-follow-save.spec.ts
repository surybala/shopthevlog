import { expect, test, type Page } from '@playwright/test'

const E2E_USER_ID = 'e2e-user-subscriber-flow'

async function authenticateAndSeed(page: Page) {
  const api = page.context().request

  const loginResponse = await api.post('/api/test-support/login', {
    data: { userId: E2E_USER_ID },
  })
  expect(loginResponse.ok()).toBeTruthy()

  const seedResponse = await api.post('/api/test-support/seed/subscriber-flow', {
    data: { userId: E2E_USER_ID, mode: 'base' },
  })
  expect(seedResponse.ok()).toBeTruthy()

  return seedResponse.json() as Promise<{
    creatorHandle: string
    followerKitSlug: string
  }>
}

test.describe('subscriber follow and save flow', () => {
  test.afterEach(async ({ page }) => {
    await page.context().request.delete('/api/test-support/login')
  })

  test('subscriber can follow to unlock a kit, save it, and see it in account', async ({ page }) => {
    const seed = await authenticateAndSeed(page)

    await page.goto(`/@${seed.creatorHandle}/kits/${seed.followerKitSlug}`)
    await expect(page.getByText('Follow to unlock this kit')).toBeVisible()
    await expect(page.getByText(/more days inside/i)).toBeVisible()

    await page.getByRole('link', { name: 'Follow for free' }).click()
    await page.getByRole('button', { name: 'Follow' }).click()
    await expect(page.getByRole('button', { name: 'Following' })).toBeVisible()

    await page.goto(`/@${seed.creatorHandle}/kits/${seed.followerKitSlug}`)
    await expect(page.getByText('Follow to unlock this kit')).toHaveCount(0)
    await expect(page.getByText(/more days inside/i)).toHaveCount(0)
    await expect(page.getByText('Golden Gai')).toBeVisible()

    await page.getByRole('button', { name: 'Save kit' }).click()
    await expect(page.getByRole('button', { name: 'Unsave kit' })).toBeVisible()

    await page.goto('/account?tab=following')
    await expect(page.getByRole('heading', { name: 'Follower Subscriber' })).toBeVisible()
    await expect(page.getByText('Subscriber QA Creator')).toBeVisible()

    await page.goto('/account?tab=saved')
    await expect(page.getByText('Tokyo Follow Unlock')).toBeVisible()
    await expect(page.getByText('Unlocked by following')).toBeVisible()
  })
})
