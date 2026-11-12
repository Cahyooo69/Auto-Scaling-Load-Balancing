/**
 * Playwright E2E Spec Template (Skenario 1-4 + 4 POVs + Anti-Stuck Route Intercept)
 * Note: Requires `@playwright/test` and Chromium browser installed if executed via `npx playwright test`.
 * See `tests/e2e-war-tiket.mjs` for the zero-dependency runnable Edge CDP equivalent.
 */
const { test, expect } = require('@playwright/test');

const BASE_URL = process.env.TARGET_URL || 'http://localhost';

const POV_ACCOUNTS = [
  { email: 'admin@wartiket.id', expectedSnippet: 'Admin WarTiket' },
  { email: 'user@wartiket.id', expectedSnippet: 'User Penonton' },
];

test.describe('Sistem War Tiket Konser Musik - E2E Suite', () => {
  test.beforeEach(async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/tickets/reset`, { data: {} });
    expect(res.ok()).toBeTruthy();
  });

  test('[Skenario 1] Autentikasi 2 POV Demo Accounts (ADMIN & USER)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${BASE_URL}/`);

    for (const pov of POV_ACCOUNTS) {
      await page.locator('#navBtnAuth').click();
      await page.locator('#modalLoginEmail').fill(pov.email);
      await page.locator('#modalLoginPassword').fill('password123');
      await page.locator('#btnLoginSubmit').click();

      await expect(page.locator('#navAuthLabel')).not.toHaveText('Masuk');
      const storedUser = await page.evaluate(() => JSON.parse(sessionStorage.getItem('wartiket_user') || 'null'));
      expect(storedUser?.name || '').toContain(pov.expectedSnippet);

      // Logout via dropdown so next POV can sign in cleanly
      await page.locator('#navBtnAuth').click();
      await page.getByRole('button', { name: /keluar/i }).click();
    }
  });

  test('[Skenario 2] Multi-Page Navigasi, Stationary Top Navbar, Search Icon & Footer 3 Kolom', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });

    for (const route of ['/', '/konser', '/kontak', '/live-test', '/hasil-war']) {
      await page.goto(`${BASE_URL}${route}`);
      await expect(page.locator('#btnToggleSearchPanel')).toHaveCount(0);
      await expect(page.locator('#navSearchPanel')).toHaveCount(0);
      if (route === '/') {
        await expect(page.locator('#page-beranda .hero-search-form')).toBeVisible();
      }
      await expect(page.locator('a[href*="cara-war"], a[href*="guide.html"]')).toHaveCount(0);

      const navPos = await page.locator('.navbar').evaluate((el) => getComputedStyle(el).position);
      expect(navPos).toBe('fixed');

      await page.evaluate(() => window.scrollTo(0, 600));
      const navAfter = await page.locator('.navbar').boundingBox();
      const scrollY = await page.evaluate(() => window.scrollY);
      if (scrollY > 200) {
        expect(navAfter?.y ?? 99).toBeLessThanOrEqual(1);
      }

      const footerCols = await page.locator('.site-footer .footer-inner')
        .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
      expect(footerCols).toBe(3);
      await expect(page.locator('#footerClusterStatus')).toBeVisible();
      await expect(page.locator('.btn-footer-reset')).toBeVisible();
    }
  });

  test('[Skenario 3 & 4] War Kursi E-05 -> Checkout -> E-Ticket -> Print/PDF Hides Worker Debug', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${BASE_URL}/konser`);

    // Login as USER
    await page.locator('#navBtnAuth').click();
    await page.getByRole('button', { name: /^USER/i }).click();
    await page.locator('#btnLoginSubmit').click();
    await expect(page.locator('#navAuthLabel')).not.toHaveText('Masuk');

    // Open War Modal & pick E-05
    await page.locator('.concert-card .btn-pill-primary').first().click();
    const seatE05 = page.locator('#modalSeatGrid .seat-btn', { hasText: 'E-05' });
    await expect(seatE05).toBeEnabled();
    await seatE05.click();
    await page.locator('#btnProceedToData').click();

    await expect(page.locator('#buyerFullName')).toHaveValue(/User Penonton/);
    await page.locator('#btnBayarSekarang').click();

    await expect(page.locator('#phaseETicket')).toBeVisible();
    await expect(page.locator('#ticketSeat')).toHaveText('E-05');
    await expect(page.locator('#ticketBuyer')).toHaveText('User Penonton');

    // Skenario 4: Emulate @media print
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('.eticket-worker-box')).toBeHidden();
    await expect(page.locator('.eticket-actions')).toBeHidden();
    await expect(page.locator('.navbar')).toBeHidden();
    await expect(page.locator('.site-footer')).toBeHidden();
    await expect(page.locator('#eTicketPrintArea')).toBeVisible();
  });

  test('[Skenario 3b] Anti-Stuck Recovery Saat Proxy 504 / Network Abort', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${BASE_URL}/konser`);

    // Login as ADMIN
    await page.locator('#navBtnAuth').click();
    await page.getByRole('button', { name: /^ADMIN/i }).click();
    await page.locator('#btnLoginSubmit').click();
    await expect(page.locator('#navAuthLabel')).not.toHaveText('Masuk');

    await page.locator('.concert-card .btn-pill-primary').first().click();
    await page.locator('#modalSeatGrid .seat-btn', { hasText: 'E-04' }).click();
    await page.locator('#btnProceedToData').click();

    await page.route('**/api/tickets/buy', (route) =>
      route.fulfill({ status: 504, contentType: 'text/html', body: '<h1>504 Gateway Time-out</h1>' })
    );
    await page.locator('#btnBayarSekarang').click();

    await expect(page.locator('#warFeedbackBanner')).toBeVisible();
    await expect(page.locator('#btnBayarSekarang')).toBeEnabled();
    await expect(page.locator('#btnBackToSeat')).toBeEnabled();
  });
});

