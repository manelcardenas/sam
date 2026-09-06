import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { UserProfile } from "@/lib/api-client";

import { UserProvider, useMe } from "./UserProvider";

/**
 * The interesting thing about UserProvider isn't what it renders — it's when.
 * It exists to stop `GET /users/me` being 32% of backend traffic, and the way
 * it does that (a sessionStorage cache read before the network call) is the
 * part that can silently regress. So these tests are about ordering and cache
 * writes, not markup.
 *
 * The three modules it talks to are replaced wholesale: Amplify would reach
 * for real config and the api client would reach for the network.
 */

const getCurrentUser = vi.hoisted(() => vi.fn());
const getMe = vi.hoisted(() => vi.fn());

vi.mock("aws-amplify/auth", () => ({ getCurrentUser }));
vi.mock("@/lib/amplify", () => ({ configureAmplify: vi.fn() }));
vi.mock("@/lib/api-client", () => ({ apiClient: { getMe } }));

const CACHE_KEY = "sam.me";

const CACHED: UserProfile = { id: "u1", email: "nel@example.com", display_name: "Nel" } as UserProfile;
const FRESH: UserProfile = { id: "u1", email: "nel@example.com", display_name: "Nel Updated" } as UserProfile;

/** Surfaces the context as text so tests can assert on it without a real page. */
function Probe() {
  const { me, status } = useMe();
  return (
    <>
      <span data-testid="status">{status}</span>
      <span data-testid="name">{me?.display_name ?? "-"}</span>
    </>
  );
}

function renderProvider() {
  return render(
    <UserProvider>
      <Probe />
    </UserProvider>,
  );
}

/** A promise this test controls, so "before the network resolves" is assertable. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
});

describe("cold start, no cache", () => {
  it("goes loading → ready and stores the profile", async () => {
    getCurrentUser.mockResolvedValue({});
    getMe.mockResolvedValue(FRESH);

    renderProvider();

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("ready"));
    expect(screen.getByTestId("name")).toHaveTextContent("Nel Updated");
    expect(JSON.parse(sessionStorage.getItem(CACHE_KEY)!)).toEqual(FRESH);
  });
});

describe("warm start, cache present", () => {
  it("paints the cached name before the network resolves", async () => {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(CACHED));
    getCurrentUser.mockResolvedValue({});
    const network = deferred<UserProfile>();
    getMe.mockReturnValue(network.promise);

    renderProvider();

    // This is the whole point of the cache: ready, with a name, while the
    // request is still in flight.
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("ready"));
    expect(screen.getByTestId("name")).toHaveTextContent("Nel");

    network.resolve(FRESH);
    await waitFor(() => expect(screen.getByTestId("name")).toHaveTextContent("Nel Updated"));
  });

  it("still revalidates rather than trusting the cache forever", async () => {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(CACHED));
    getCurrentUser.mockResolvedValue({});
    getMe.mockResolvedValue(FRESH);

    renderProvider();

    await waitFor(() => expect(getMe).toHaveBeenCalled());
  });

  it("clears a stale cache when the session has expired", async () => {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(CACHED));
    getCurrentUser.mockRejectedValue(new Error("no session"));

    renderProvider();

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("signed-out"));
    expect(sessionStorage.getItem(CACHE_KEY)).toBeNull();
  });
});

describe("signed out", () => {
  it("reports signed-out when there is no session", async () => {
    getCurrentUser.mockRejectedValue(new Error("no session"));

    renderProvider();

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("signed-out"));
    expect(getMe).not.toHaveBeenCalled();
  });

  it("reports signed-out when the profile request fails", async () => {
    getCurrentUser.mockResolvedValue({});
    getMe.mockRejectedValue(new Error("500"));

    renderProvider();

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("signed-out"));
    expect(screen.getByTestId("name")).toHaveTextContent("-");
  });
});

describe("the request is made once", () => {
  it("does not double-fetch under StrictMode's double-invoked effects", async () => {
    getCurrentUser.mockResolvedValue({});
    getMe.mockResolvedValue(FRESH);

    // StrictMode is what the real app runs in development, and it is the
    // reason the `started` ref exists — without it this provider would fire
    // two /users/me calls on the very mount it was added to fix.
    const { StrictMode } = await import("react");
    render(
      <StrictMode>
        <UserProvider>
          <Probe />
        </UserProvider>
      </StrictMode>,
    );

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("ready"));
    expect(getMe).toHaveBeenCalledTimes(1);
  });
});

describe("sessionStorage is unavailable (private browsing)", () => {
  it("degrades to a network fetch instead of crashing", async () => {
    const boom = () => {
      throw new Error("SecurityError");
    };
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(boom);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(boom);
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(boom);
    getCurrentUser.mockResolvedValue({});
    getMe.mockResolvedValue(FRESH);

    renderProvider();

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("ready"));
    expect(screen.getByTestId("name")).toHaveTextContent("Nel Updated");
    vi.restoreAllMocks();
  });
});

describe("useMe outside the provider", () => {
  it("throws a message that names the fix", () => {
    // Rendering this logs the error React always logs for a throwing child;
    // silenced so a passing run stays readable.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow(/useMe must be used inside/);
    consoleError.mockRestore();
  });
});
