import { expect, test, type Locator, type Page } from '@playwright/test'

const CREATOR_USER_ID = 'e2e-user-creator-review'
const SUBSCRIBER_USER_ID = 'e2e-user-subscriber-flow'

function parseRgb(color: string) {
  const match = color.match(/\d+/g)
  if (!match || match.length < 3) {
    return { r: 255, g: 255, b: 255 }
  }
  return {
    r: Number(match[0]),
    g: Number(match[1]),
    b: Number(match[2]),
  }
}

function relativeLuminance({ r, g, b }: { r: number; g: number; b: number }) {
  const normalize = (channel: number) => {
    const value = channel / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }

  return (0.2126 * normalize(r)) + (0.7152 * normalize(g)) + (0.0722 * normalize(b))
}

async function expectReadableDarkText(locator: Locator) {
  await expect(locator).toBeVisible()
  const color = await locator.evaluate((element) => getComputedStyle(element).color)
  expect(relativeLuminance(parseRgb(color))).toBeLessThan(0.45)
}

async function expectNoWrap(locator: Locator) {
  await expect(locator).toBeVisible()
  const whiteSpace = await locator.evaluate((element) => getComputedStyle(element).whiteSpace)
  expect(whiteSpace).toBe('nowrap')
}

async function authenticateCreatorAndSeed(page: Page) {
  const api = page.context().request

  const loginResponse = await api.post('/api/test-support/login', {
    data: { userId: CREATOR_USER_ID },
  })
  expect(loginResponse.ok()).toBeTruthy()

  const seedResponse = await api.post('/api/test-support/seed/creator-review', {
    data: { userId: CREATOR_USER_ID },
  })
  expect(seedResponse.ok()).toBeTruthy()

  return seedResponse.json() as Promise<{
    reviewUrl: string
    storefrontUrl: string
  }>
}

async function authenticateSubscriberAndSeed(page: Page) {
  const api = page.context().request

  const loginResponse = await api.post('/api/test-support/login', {
    data: { userId: SUBSCRIBER_USER_ID },
  })
  expect(loginResponse.ok()).toBeTruthy()

  const seedResponse = await api.post('/api/test-support/seed/subscriber-flow', {
    data: { userId: SUBSCRIBER_USER_ID, mode: 'base' },
  })
  expect(seedResponse.ok()).toBeTruthy()

  return seedResponse.json() as Promise<{
    creatorHandle: string
    followerKitSlug: string
  }>
}

test.describe('beta visual smoke coverage', () => {
  test.afterEach(async ({ page }) => {
    await page.context().request.delete('/api/test-support/login')
  })

  test('public and subscriber pages keep readable dark text and stable CTAs', async ({ page }) => {
    const subscriberSeed = await authenticateSubscriberAndSeed(page)

    await page.goto('/')
    await expectReadableDarkText(page.getByText('TripKits').first())
    await expectReadableDarkText(page.getByRole('link', { name: 'Discover' }))
    await expectNoWrap(
      page.locator('a', {
        hasText: /Request access|Sign in|Account|Follower Subscriber|E2E Creator/i,
      }).first(),
    )

    await page.goto('/discover')
    await expectReadableDarkText(page.getByRole('heading', { name: /Discover/i }))

    await page.goto(`/@${subscriberSeed.creatorHandle}`)
    await expectReadableDarkText(page.getByText(/Alex Wanders|Subscriber QA Creator/i).first())
    await expectNoWrap(page.getByRole('button', { name: 'Follow' }).first())

    await page.goto(`/@${subscriberSeed.creatorHandle}/kits/${subscriberSeed.followerKitSlug}`)
    await expectReadableDarkText(page.getByRole('heading', { level: 1 }).first())
    await expectNoWrap(page.getByRole('link', { name: 'Follow for free' }))
  })

  test('creator dashboard pages keep readable dark text and non-wrapping primary actions', async ({ page }) => {
    const creatorSeed = await authenticateCreatorAndSeed(page)

    await page.goto('/dashboard')
    await expectReadableDarkText(page.getByText(/Good morning|Storefront performance/i).first())
    await expectNoWrap(page.getByRole('link', { name: /\+ New Kit|New Kit/i }))

    await page.goto('/dashboard/vlogs')
    await expectReadableDarkText(page.getByRole('heading', { name: 'Source videos powering your storefront.' }))

    await page.goto('/dashboard/settings')
    await expectReadableDarkText(page.getByRole('heading', { name: 'Settings' }))
    await expectReadableDarkText(page.getByRole('button', { name: 'storefront' }))
    await expectReadableDarkText(page.getByRole('button', { name: 'channels' }))

    await page.goto('/dashboard/review')
    await expectReadableDarkText(page.getByRole('heading', { name: 'Review Queue' }))

    await page.goto(creatorSeed.reviewUrl)
    await expectNoWrap(page.getByRole('button', { name: 'Publish Trip Kit' }))
  })
})
