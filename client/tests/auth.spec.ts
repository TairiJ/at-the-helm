import { test, expect } from '@playwright/test';

test.describe('Authentication Flow', () => {
  test('should show login modal when clicking sign in', async ({ page }) => {
    await page.goto('/');
    
    // Find the login button in TelemetryBar (assuming it says "Sign In" or has a specific title)
    await page.getByRole('button', { name: /Sign In/i }).click();
    
    // Check if the modal is visible
    await expect(page.getByText(/Sign In to the Helm/i)).toBeVisible();
  });

  test('should allow toggling between login and register', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /Sign In/i }).click();
    
    // Toggle to Register
    await page.getByRole('button', { name: /register/i }).click();
    // Check the modal title specifically
    await expect(page.locator('.modal-title')).toContainText(/Create Account/i);
    
    // Toggle back to Sign In
    // The toggle button at the bottom changes text to "Sign In"
    await page.locator('.form-toggle').getByRole('button', { name: /Sign In/i }).click();
    await expect(page.locator('.modal-title')).toContainText(/Sign In/i);
  });
});
