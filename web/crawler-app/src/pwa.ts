export interface PwaStatus { supported: boolean; controlled: boolean; updateAvailable: boolean; cacheVersion: string }

export async function installPwa(onUpdate: () => void): Promise<() => PwaStatus> {
  const status: PwaStatus = { supported: "serviceWorker" in navigator, controlled: Boolean(navigator.serviceWorker?.controller), updateAvailable: false, cacheVersion: "crawler-alpha-v2" };
  if (!status.supported) return () => ({ ...status });
  const scope = new URL(import.meta.env.BASE_URL, location.origin);
  const registration = await navigator.serviceWorker.register(new URL("sw.js", scope), { scope: scope.pathname });
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
