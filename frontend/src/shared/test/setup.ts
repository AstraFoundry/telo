import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Ensures rendered components from @testing-library/react are unmounted
// between tests. Pure store tests are unaffected.
afterEach(() => {
  cleanup();
});
