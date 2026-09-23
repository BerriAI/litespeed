import { defineConfig } from '@playwright/test';
import configuration from './playwright.config';

export default defineConfig({
  ...configuration,
  use: { ...configuration.use, browserName: 'webkit', launchOptions: {} },
  projects: [{ name: 'webkit', use: { viewport: { width: 1440, height: 1000 } } }],
});
