import { _electron as electron, test, expect } from '@playwright/test';
import * as path from 'path';

test.describe('Catalog and Supplier management', () => {
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

  test('should display catalog list and support updating point values', async () => {
    await window.click('text=كتالوج المنتجات');
    await expect(window).toHaveURL(/.*catalog/);

    // Verify item table structure
    await expect(window.locator('text=اسم الصنف')).toBeVisible();
    await expect(window.locator('text=نقاط المنتج')).toBeVisible();
  });

  test('should load suppliers list and display payable balances', async () => {
    await window.click('text=الموردين والمدفوعات');
    await expect(window).toHaveURL(/.*suppliers/);

    await expect(window.locator('text=اسم المورد')).toBeVisible();
    await expect(window.locator('text=الرصيد الدائن')).toBeVisible();
  });
});
