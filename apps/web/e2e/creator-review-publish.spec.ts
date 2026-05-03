import { expect, test, type Page } from '@playwright/test'

const E2E_USER_ID = 'e2e-user-creator-review'

async function authenticateAndSeed(page: Page) {
  const api = page.context().request

  const loginResponse = await api.post('/api/test-support/login', {
    data: { userId: E2E_USER_ID },
  })
  expect(loginResponse.ok()).toBeTruthy()

  const seedResponse = await api.post('/api/test-support/seed/creator-review', {
    data: { userId: E2E_USER_ID },
  })
  expect(seedResponse.ok()).toBeTruthy()

  return seedResponse.json() as Promise<{
    reviewUrl: string
    storefrontUrl: string
  }>
}

test.describe('creator review publish flow', () => {
  test.afterEach(async ({ page }) => {
    await page.context().request.delete('/api/test-support/login')
  })

  test('creator can review a seeded vlog, publish its itinerary, and see it on the creator portal', async ({ page }) => {
    const seed = await authenticateAndSeed(page)

    await page.goto('/dashboard/review')
    await expect(page.getByRole('heading', { name: 'Review Queue' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Review this vlog' }).first()).toBeVisible()
    await expect(page.getByText('7 Days in Tokyo')).toBeVisible()

    await page.goto(seed.reviewUrl)
    await expect(page.getByRole('heading', { name: 'Tokyo Creator Review Flow' })).toBeVisible()
    await expect(page.getByText('Publish Preview')).toBeVisible()
    await expect(page.getByText('Republish Changes')).toHaveCount(0)
    await expect(page.getByText('Backed by Transcript + Ocr')).toBeVisible()
    await expect(page.getByText('Older Tokyo Cut')).toBeVisible()

    await Promise.all([
      page.waitForResponse((response) =>
        response.url().includes(`/api/vlogs/${seed.reviewUrl.split('/').pop()}/publish`) &&
        response.request().method() === 'POST' &&
        response.status() === 200,
      ),
      page.getByRole('button', { name: 'Publish Trip Kit' }).click(),
    ])
    await page.goto(seed.reviewUrl)

    await expect(page.getByText('Current Trip Kit')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Republish Trip Kit' })).toBeVisible()

    await page.goto('/dashboard/review')
    await expect(page.getByText('No opportunities are waiting for review yet.')).toBeVisible()
    await expect(page.getByText('Tokyo Creator Review Flow')).toHaveCount(0)

    await page.goto(seed.storefrontUrl)
    await expect(page.getByText('7 Days in Tokyo')).toBeVisible()
  })
})
