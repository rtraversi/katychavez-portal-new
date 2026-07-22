import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';

// Tests run INSIDE workerd (the real Workers runtime) with simulated bindings,
// so anything that passes here behaves the same after `wrangler deploy`.
// Bindings/vars come from test/wrangler.toml (committed, dummy values only).
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './test/wrangler.toml' },
    }),
  ],
  test: {
    include: ['test/**/*.test.js'],
  },
});
