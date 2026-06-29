import { _electron as electron, test, expect } from '@playwright/test';
import * as path from 'path';

test.describe('Invoices and Returns flow', () => {
  let electronApp: any;
  let window: any;

  test.beforeEach(async () => {
    electronApp = await electron.launch({
      args: [path.join(__dirname, '../../dist-electron/main.js')],
    });
    window = await electronApp.firstWindow();
    await window.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await window.reload();

    // Login
    await window.fill('input[type="text"]', 'admin');
    await window.fill('input[type="password"]', 'password123');
    await window.locator('button[type="submit"]').click();
  });

  test.afterEach(async () => {
    await electronApp.close();
  });

  test('should display sales invoices and returns actions', async () => {
    await window.click('text=الفواتير والمرتجعات');
    await expect(window).toHaveURL(/.*invoices/);

    // Verify filter or table headings
    await expect(window.locator('text=الفواتير').first()).toBeVisible();
  });
});
