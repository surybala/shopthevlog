import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

const CREATOR_USER_ID = 'e2e-user-payout-ops-creator'
const ADMIN_USER_ID = 'e2e-admin-payout-ops'

async function loginAs(api: APIRequestContext, userId: string) {
  const response = await api.post('/api/test-support/login', {
    data: { userId },
  })
  expect(response.ok()).toBeTruthy()
}

async function logout(api: APIRequestContext) {
  const response = await api.delete('/api/test-support/login')
  expect(response.ok()).toBeTruthy()
}

async function seedPayoutOps(page: Page) {
  const api = page.context().request
  const response = await api.post('/api/test-support/seed/payout-ops', {
    data: { creatorUserId: CREATOR_USER_ID },
  })
  expect(response.ok()).toBeTruthy()
  return response.json() as Promise<{
    creatorPayoutsUrl: string
    adminPayoutOpsUrl: string
  }>
}

test.describe('admin payout ops flow', () => {
  test.setTimeout(120000)

  test.afterEach(async ({ page }) => {
    await logout(page.context().request)
  })

  test('admin can confirm and pay creator commissions, and creators see the updated balances', async ({ page }) => {
    const seed = await seedPayoutOps(page)
    const api = page.context().request

    await loginAs(api, CREATOR_USER_ID)
    await page.goto(seed.creatorPayoutsUrl)
    await expect(summaryCard(page, 'Ready To Payout')).toContainText('$20.00')
    await expect(summaryCard(page, 'Pending Review')).toContainText('$24.00')
    await expect(summaryCard(page, 'Paid Out')).toContainText('$15.00')

    await logout(api)
    await loginAs(api, ADMIN_USER_ID)

    await page.goto(seed.adminPayoutOpsUrl)
    await expect(page.getByRole('heading', { name: /Review pending commissions/i })).toBeVisible()
    await page.getByLabel('Select commission Riverside Hotel Bangkok for payout-qa-creator').check()
    await Promise.all([
      page.waitForResponse((response) =>
        response.url().includes('/api/admin/payout-ops') &&
        response.request().method() === 'POST' &&
        response.status() === 200,
      ),
      page.getByRole('button', { name: 'Confirm selected' }).click(),
    ])

    await page.goto(seed.adminPayoutOpsUrl)
    await expect(summaryCard(page, 'Ready to pay')).toContainText('$44.00')

    await page.getByLabel('Select all commissions in Confirmed and ready for payout').click()
    await Promise.all([
      page.waitForResponse((response) =>
        response.url().includes('/api/admin/payout-ops') &&
        response.request().method() === 'POST' &&
        response.status() === 200,
      ),
      page.getByRole('button', { name: 'Mark paid' }).click(),
    ])

    await page.goto(seed.adminPayoutOpsUrl)
    await expect(page.getByText('Recently paid')).toBeVisible()
    await expect(page.getByText('Riverside Hotel Bangkok')).toBeVisible()

    await logout(api)
    await loginAs(api, CREATOR_USER_ID)

    await page.goto(seed.creatorPayoutsUrl)
    await expect(summaryCard(page, 'Ready To Payout')).toContainText('$0.00')
    await expect(summaryCard(page, 'Pending Review')).toContainText('$0.00')
    await expect(summaryCard(page, 'Paid Out')).toContainText('$59.00')
  })
})

function summaryCard(page: Page, label: string) {
  return page.locator('.dashboard-mirror-card', { hasText: label }).first()
}
