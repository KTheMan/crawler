export interface PwaStatus { supported: boolean; controlled: boolean; updateAvailable: boolean; cacheVersion: string }

export async function installPwa(onUpdate: () => void): Promise<() => PwaStatus> {
  const buildId = import.meta.env.VITE_CRAWLER_BUILD_ID || "unversioned";
  const developmentOptIn = new URLSearchParams(location.search).get("pwa") === "1";
  const developmentDisabled = import.meta.env.DEV && !developmentOptIn;
  const status: PwaStatus = {
    supported: "serviceWorker" in navigator,
    controlled: Boolean(navigator.serviceWorker?.controller),
    updateAvailable: false,
    cacheVersion: developmentDisabled ? "development-disabled" : `crawler-alpha-${buildId}`,
  };
  if (!status.supported) return () => ({ ...status });
  const scope = new URL(import.meta.env.BASE_URL, location.origin);
  if (developmentDisabled) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.filter((registration) => registration.scope === scope.href).map((registration) => registration.unregister()));
    const cacheKeys = await caches.keys();
    await Promise.all(cacheKeys.filter((key) => key.startsWith("crawler-alpha-")).map((key) => caches.delete(key)));
    status.controlled = false;
    return () => ({ ...status });
  }
  const workerUrl = new URL("sw.js", scope);
  workerUrl.searchParams.set("build", buildId);
  const registration = await navigator.serviceWorker.register(workerUrl, { scope: scope.pathname });
  const markWaiting = () => { status.updateAvailable = true; onUpdate(); };
  if (registration.waiting) markWaiting();
  registration.addEventListener("updatefound", () => {
    const candidate = registration.installing;
    candidate?.addEventListener("statechange", () => {
      if (candidate.state === "installed" && navigator.serviceWorker.controller) markWaiting();
    });
  });
  navigator.serviceWorker.addEventListener("controllerchange", () => { status.controlled = true; });
  await navigator.serviceWorker.ready;
  status.controlled = Boolean(navigator.serviceWorker.controller);
  return () => ({ ...status });
}
