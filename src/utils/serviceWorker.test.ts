import {
  SERVICE_WORKER_SCOPE,
  SERVICE_WORKER_URL,
  registerServiceWorker,
  registerServiceWorkerOnLoad,
} from "./serviceWorker";

type MockWorker = { scriptURL: string };
type MockRegistration = {
  scope: string;
  installing?: MockWorker | null;
  waiting?: MockWorker | null;
  active?: MockWorker | null;
  unregister: jest.Mock;
};

const origin = "https://app.example.test";

const makeRegistration = (
  scriptURL: string | null,
  scope = "/",
): MockRegistration => ({
  scope,
  installing: null,
  waiting: null,
  active: scriptURL ? { scriptURL: `${origin}${scriptURL}` } : null,
  unregister: jest.fn().mockResolvedValue(true),
});

/** Installs a fake navigator.serviceWorker and returns the spies. */
const mockContainer = (options: {
  register?: jest.Mock;
  registrations?: MockRegistration[];
  withGetRegistrations?: boolean;
}) => {
  const ours = makeRegistration(SERVICE_WORKER_URL);
  const register = options.register ?? jest.fn().mockResolvedValue(ours);
  const getRegistrations = jest
    .fn()
    .mockResolvedValue(options.registrations ?? [ours]);
  const container: Record<string, unknown> = { register };
  if (options.withGetRegistrations !== false)
    container.getRegistrations = getRegistrations;
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: container,
  });
  return { ours, register, getRegistrations };
};

const removeContainer = () => {
  Reflect.deleteProperty(navigator, "serviceWorker");
};

const setReadyState = (state: DocumentReadyState) => {
  Object.defineProperty(document, "readyState", {
    configurable: true,
    get: () => state,
  });
};

describe("registerServiceWorker", () => {
  afterEach(() => {
    removeContainer();
    setReadyState("complete");
    jest.clearAllMocks();
  });

  it("registers exactly one worker, at the built script URL and root scope", async () => {
    const { register } = mockContainer({});

    await registerServiceWorker();

    expect(register).toHaveBeenCalledTimes(1);
    // Both halves matter. The script URL must match the file vite-plugin-pwa
    // emits, and the scope must be "/" — a scope holds exactly one
    // registration, which is what makes "register one URL" sufficient to
    // supersede whatever a returning client already had.
    expect(register).toHaveBeenCalledWith(SERVICE_WORKER_URL, {
      scope: SERVICE_WORKER_SCOPE,
    });
    expect(SERVICE_WORKER_URL).toBe("/service-worker.js");
    expect(SERVICE_WORKER_SCOPE).toBe("/");
  });

  it("returns null and registers nothing when the browser has no service workers", async () => {
    removeContainer();
    await expect(registerServiceWorker()).resolves.toBeNull();
  });

  it("swallows a failed registration instead of breaking startup", async () => {
    const register = jest.fn().mockRejectedValue(new Error("offline"));
    mockContainer({ register });

    await expect(registerServiceWorker()).resolves.toBeNull();
  });

  it("unregisters a superseded legacy worker left over from the old dual registration", async () => {
    // A client that still has the workbox /sw.js registration under a scope our
    // register() call did not subsume.
    const legacy = makeRegistration("/sw.js", "/legacy/");
    const { ours, register, getRegistrations } = mockContainer({});
    register.mockResolvedValue(ours);
    getRegistrations.mockResolvedValue([legacy, ours]);

    await registerServiceWorker();

    expect(legacy.unregister).toHaveBeenCalledTimes(1);
    expect(ours.unregister).not.toHaveBeenCalled();
  });

  it("never unregisters a registration that already runs our script", async () => {
    // Same script, reported under a different registration object (e.g. a
    // browser that hands back a fresh wrapper). Removing it would leave the
    // client with no worker at all.
    const twin = makeRegistration(SERVICE_WORKER_URL, "/");
    const { ours, getRegistrations } = mockContainer({});
    getRegistrations.mockResolvedValue([twin, ours]);

    await registerServiceWorker();

    expect(twin.unregister).not.toHaveBeenCalled();
  });

  it("keeps the registration we just created even before a worker is attached", async () => {
    // register() can resolve with installing/waiting/active all still null.
    const fresh = makeRegistration(null, "/");
    const register = jest.fn().mockResolvedValue(fresh);
    const { getRegistrations } = mockContainer({ register });
    getRegistrations.mockResolvedValue([fresh]);

    await registerServiceWorker();

    expect(fresh.unregister).not.toHaveBeenCalled();
  });

  it("finds our script on an installing or waiting worker, not just the active one", async () => {
    const installing = {
      ...makeRegistration(null, "/pending/"),
      installing: { scriptURL: `${origin}${SERVICE_WORKER_URL}` },
    };
    const { ours, getRegistrations } = mockContainer({});
    getRegistrations.mockResolvedValue([installing, ours]);

    await registerServiceWorker();

    expect(installing.unregister).not.toHaveBeenCalled();
  });

  it("still registers when the browser exposes no getRegistrations", async () => {
    const { register } = mockContainer({ withGetRegistrations: false });

    await expect(registerServiceWorker()).resolves.not.toBeNull();
    expect(register).toHaveBeenCalledTimes(1);
  });

  it("survives a getRegistrations that rejects", async () => {
    const { getRegistrations } = mockContainer({});
    getRegistrations.mockRejectedValue(new Error("nope"));

    await expect(registerServiceWorker()).resolves.not.toBeNull();
  });

  it("swallows an unregister that rejects", async () => {
    const legacy = makeRegistration("/sw.js", "/legacy/");
    legacy.unregister.mockRejectedValue(new Error("denied"));
    const { ours, getRegistrations } = mockContainer({});
    getRegistrations.mockResolvedValue([legacy, ours]);

    await expect(registerServiceWorker()).resolves.not.toBeNull();
  });
});

describe("registerServiceWorkerOnLoad", () => {
  afterEach(() => {
    removeContainer();
    setReadyState("complete");
    jest.clearAllMocks();
  });

  it("waits for the load event, then registers once no matter how many loads fire", async () => {
    setReadyState("loading");
    const { register } = mockContainer({});

    registerServiceWorkerOnLoad();
    expect(register).not.toHaveBeenCalled();

    window.dispatchEvent(new Event("load"));
    window.dispatchEvent(new Event("load"));
    await Promise.resolve();

    // The listener is registered with { once: true }; a second load must not
    // re-register. Two registrations at one scope is the exact bug this
    // module exists to prevent.
    expect(register).toHaveBeenCalledTimes(1);
  });

  it("registers immediately when the document already finished loading", async () => {
    setReadyState("complete");
    const { register } = mockContainer({});

    registerServiceWorkerOnLoad();
    await Promise.resolve();

    expect(register).toHaveBeenCalledTimes(1);
    // ...and does not also queue a load listener that would fire a second one.
    window.dispatchEvent(new Event("load"));
    await Promise.resolve();
    expect(register).toHaveBeenCalledTimes(1);
  });
});
