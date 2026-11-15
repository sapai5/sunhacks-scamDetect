import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // cdk.out holds copies of the repo (the Fargate image's build context): don't run their tests.
    exclude: [...configDefaults.exclude, 'cdk.out/**'],
  },
});
