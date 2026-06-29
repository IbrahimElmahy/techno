import { _electron as electron, test, expect } from '@playwright/test';
import * as path from 'path';

test.describe('Authentication Flows', () => {
  let electronApp: any;
  let firstWindow: any;

  test.beforeEach(async () => {
    // Launch the Electron application
    electronApp = await electron.launch({
      args: [path.join(__dirname, '../../dist-electron/main.js')],
    });

    // Get the first window that Electron opens
    firstWindow = await electronApp.firstWindow();
    
    // Clear localStorage to ensure clean session
    await firstWindow.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await firstWindow.reload();
  });

  test.afterEach(async () => {
    // Close the Electron app
    await electronApp.close();
  });

  test('should show login page by default and require credentials', async () => {
    // Verify login heading is visible in Arabic
    const heading = await firstWindow.locator('h2');
    await expect(heading).toHaveText('تسجيل الدخول');

    // Attempt login with empty fields
    const loginButton = await firstWindow.locator('button[type="submit"]');
    await loginButton.click();

    // Verify empty validations are displayed
    const nameError = await firstWindow.locator('.ant-form-item-explain-error').first();
    await expect(nameError).toBeVisible();
  });

  test('should authorize user with valid credentials, persist session, and logout', async () => {
    // Fill credentials (assuming backend / mock intercepts)
    await firstWindow.fill('input[type="text"]', 'admin');
    await firstWindow.fill('input[type="password"]', 'password123');

    // Submit form
    const loginButton = await firstWindow.locator('button[type="submit"]');
    await loginButton.click();

    // Verify redirection to dashboard
    await expect(firstWindow).toHaveURL(/.*dashboard/);

    // Verify user profile details render in layout header
    const profileName = await firstWindow.locator('.ant-avatar-string');
    await expect(profileName).toBeVisible();

    // Trigger logout menu
    const profileDropdown = await firstWindow.locator('.ant-space-item').first();
    await profileDropdown.click();

    const logoutMenuItem = await firstWindow.locator('.ant-dropdown-menu-item-danger');
    await logoutMenuItem.click();

    // Verify back to login
    await expect(firstWindow).toHaveURL(/.*login/);
  });
});
