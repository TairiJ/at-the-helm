import { beforeAll, afterAll, vi } from 'vitest';

// Mock environment variables
process.env.JWT_SECRET = 'test-secret';
process.env.DATA_DIR = './test-data';

// Add any global test hooks here
beforeAll(() => {
  // Setup logic
});

afterAll(() => {
  // Cleanup logic
});
