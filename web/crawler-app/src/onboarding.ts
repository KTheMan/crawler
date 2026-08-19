const KEY = "crawler-alpha-onboarding";
const STATE_VERSION = 4;

export const ONBOARDING_ACTIONS = ["start-sketch", "choose-support", "draw-rectangle", "finish-sketch", "start-extrude", "commit-extrude"] as const;
export type OnboardingAction = (typeof ONBOARDING_ACTIONS)[number];

export interface OnboardingState {
  version: 4;
  step: number;
  complete: boolean;
  achieved: OnboardingAction[];
}

const STEPS: readonly {
  action: OnboardingAction;
  instruction: string;
  context: string;
  focusTarget: string;
}[] = [
  {
    action: "start-sketch",
    instruction: "Choose New Sketch.",
    context: "A sketch starts 2D geometry. You will choose its support before drawing anything.",
    focusTarget: "#edit-sketch",
  },
  {
    action: "choose-support",
    instruction: "Choose an origin plane in the model browser.",
    context: "XY is a familiar starting plane. Choosing support sets orientation; it does not create geometry.",
    focusTarget: '[data-origin-plane-id="origin-plane:xy"]',
  },
  {
    action: "draw-rectangle",
    instruction: "Create a closed rectangle.",
    context: "Choose Rectangle, then drag between two corners on the sketch plane. A closed profile is ready for a solid feature.",
    focusTarget: '[data-sketch-tool="rectangle"]',
  },
  {
    action: "finish-sketch",
    instruction: "Finish Sketch to keep the rectangle.",
    context: "Finish Sketch commits this 2D profile and returns you to the solid-modeling workspace.",
    focusTarget: "#active-tool-finish",
  },
  {
    action: "start-extrude",
    instruction: "Start Extrude.",
    context: "Extrude turns the closed sketch profile into a 3D feature. You will see a preview before committing it.",
    focusTarget: "#start-pad",
  },
  {
    action: "commit-extrude",
    instruction: "Commit the Extrude preview.",
    context: "Review the distance, then press Enter to accept the preview and create the feature.",
    focusTarget: "#pad-length",
  },
];

export function recordOnboardingAction(value: OnboardingState, action: OnboardingAction): OnboardingState {
  if (value.complete || STEPS[value.step]?.action !== action || value.achieved.includes(action)) return value;
  return { ...value, achieved: [...value.achieved, action] };
}

export function advanceOnboarding(value: OnboardingState): OnboardingState {
  const required = STEPS[value.step]?.action;
  if (value.complete || !required || !value.achieved.includes(required)) return value;
  return value.step === STEPS.length - 1
    ? { ...value, complete: true }
    : { ...value, step: value.step + 1 };
}

export function goBackOnboarding(value: OnboardingState): OnboardingState {
  if (value.complete || value.step === 0) return value;
  return { ...value, step: value.step - 1 };
}

export function installOnboarding(
  host: HTMLElement,
  options: { autoStart?: boolean } = {},
): { restart(): void; state(): { step: number; complete: boolean } } {
  let value = read();
  let hasPersistedState = false;
  try { hasPersistedState = localStorage.getItem(KEY) !== null; } catch { /* Storage is optional. */ }
  if (options.autoStart === false && !hasPersistedState) {
    value = { ...freshState(), complete: true };
  }
  let describedTarget: HTMLElement | null = null;
  let previousDescription: string | null = null;

  const persist = () => write(value);
  const targetForStep = (step = value.step): HTMLElement | null => {
    const selector = STEPS[step]?.focusTarget;
    return selector ? document.querySelector<HTMLElement>(selector) : null;
  };
  const clearTarget = () => {
    if (!describedTarget) return;
    describedTarget.removeAttribute("data-tour-target");
    if (previousDescription === null) describedTarget.removeAttribute("aria-describedby");
    else describedTarget.setAttribute("aria-describedby", previousDescription);
    describedTarget = null;
    previousDescription = null;
  };
  const describeTarget = () => {
    clearTarget();
    if (value.complete) return;
    const target = targetForStep();
    if (!target) return;
    describedTarget = target;
    previousDescription = target.getAttribute("aria-describedby");
    const descriptions = new Set((previousDescription ?? "").split(/\s+/).filter(Boolean));
    descriptions.add("tour-instruction");
    target.setAttribute("aria-describedby", [...descriptions].join(" "));
    target.setAttribute("data-tour-target", "true");
  };
  const focusCurrentTarget = () => requestAnimationFrame(() => {
    describeTarget();
    targetForStep()?.focus();
  });

  const render = () => {
    clearTarget();
    host.hidden = value.complete;
    if (value.complete) {
      host.innerHTML = "";
      return;
    }
    const definition = STEPS[value.step];
    const achieved = value.achieved.includes(definition.action);
    host.innerHTML = `
      <strong>Quick tour ${value.step + 1}/${STEPS.length}</strong>
      <span id="tour-instruction">${definition.instruction}</span>
      <small>${definition.context}</small>
      <span id="tour-action-status" role="status">${achieved ? "Action complete." : "Complete this action to continue."}</span>
      <div class="tour-actions"><button id="tour-back" class="quiet" type="button" ${value.step === 0 ? "disabled" : ""}>Back</button><button id="tour-next" type="button" ${achieved ? "" : "disabled"} aria-describedby="tour-action-status">${value.step === STEPS.length - 1 ? "Finish tour" : "Next"}</button><button id="tour-exit" class="quiet" type="button">Exit tour</button></div>`;
    describeTarget();
    host.querySelector("#tour-next")?.addEventListener("click", () => {
      const next = advanceOnboarding(value);
      if (next === value) return;
      const completedTarget = targetForStep();
      value = next;
      persist();
      render();
      if (value.complete) completedTarget?.focus();
      else focusCurrentTarget();
    });
    host.querySelector("#tour-back")?.addEventListener("click", () => {
      const previous = goBackOnboarding(value);
      if (previous === value) return;
      value = previous;
      persist();
      render();
      focusCurrentTarget();
    });
    host.querySelector("#tour-exit")?.addEventListener("click", () => {
      const returnTarget = targetForStep();
      value = { ...value, complete: true };
      persist();
      render();
      returnTarget?.focus();
    });
  };

  const achieve = (action: OnboardingAction) => {
    const next = recordOnboardingAction(value, action);
    if (next === value) return;
    value = next;
    persist();
    render();
  };

  document.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;
    if (event.target.closest("#edit-sketch") && document.querySelector(".workspace.sketch-active")) {
      achieve("start-sketch");
      return;
    }
    if (event.target.closest("[data-origin-plane-id]") && document.querySelector(".workspace.sketch-active")) {
      achieve("choose-support");
      return;
    }
  });
  document.addEventListener("crawler:onboarding-action", (event) => {
    const action = (event as CustomEvent<unknown>).detail;
    if (typeof action === "string" && ONBOARDING_ACTIONS.includes(action as OnboardingAction)) achieve(action as OnboardingAction);
  });

  new MutationObserver(() => {
    if (value.complete) return;
    if (!describedTarget?.isConnected || describedTarget !== targetForStep()) describeTarget();
  }).observe(document.body, { subtree: true, childList: true });

  render();
  return {
    restart() {
      value = freshState();
      persist();
      render();
      focusCurrentTarget();
    },
    state() { return { step: value.step, complete: value.complete }; },
  };
}

function freshState(): OnboardingState {
  return { version: STATE_VERSION, step: 0, complete: false, achieved: [] };
}

function read(): OnboardingState {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<OnboardingState> | null;
    if (
      parsed?.version !== STATE_VERSION ||
      !Number.isSafeInteger(parsed.step) ||
      parsed.step! < 0 ||
      parsed.step! >= STEPS.length ||
      typeof parsed.complete !== "boolean" ||
      !Array.isArray(parsed.achieved)
    ) return freshState();
    const achieved = ONBOARDING_ACTIONS.filter((action) => parsed.achieved!.includes(action));
    return { version: STATE_VERSION, step: parsed.step!, complete: parsed.complete, achieved };
  } catch {
    return freshState();
  }
}

function write(value: OnboardingState): void {
  try { localStorage.setItem(KEY, JSON.stringify(value)); } catch { /* Tour persistence is non-semantic. */ }
}
