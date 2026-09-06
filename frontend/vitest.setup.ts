import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Every test gets a fresh DOM. Without this, a component rendered in one test
// is still mounted during the next, and queries like getByRole find two.
afterEach(cleanup);
