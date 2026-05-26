// Registers jest-dom matchers (e.g. toBeInTheDocument) on Vitest's `expect` and
// unmounts rendered React trees between tests. Loaded via `test.setupFiles`.
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});
