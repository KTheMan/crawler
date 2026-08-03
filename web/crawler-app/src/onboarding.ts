const KEY = "crawler-alpha-onboarding";
const STATE_VERSION = 2;

export const ONBOARDING_ACTIONS = ["model", "timeline", "save"] as const;
export type OnboardingAction = (typeof ONBOARDING_ACTIONS)[number];

export interface OnboardingState {
  version: 2;
  step: number;
  complete: boolean;
  achieved: OnboardingAction[];
}

const STEPS: readonly {
  action: OnboardingAction;
  instruction: string;
  context: string;
}[] = [
  {
    action: "model",
    instruction: "Change Pad length and press Enter.",
    context: "The inspector edits exact parameters. Undo reverses accepted edits.",
  },
  {
    action: "timeline",
    instruction: "Select a feature in the timeline.",
    context: "The browser shows objects. The timeline shows how they were built.",
  },
  {
    action: "save",
    instruction: "Save the part.",
    context: "Save keeps an explicit copy. Autosave remains available for recovery.",
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

export function installOnboarding(
  host: HTMLElement,
  focusTargets: readonly string[],
): { restart(): void; state(): { step: number; complete: boolean } } {
  let value = read();
  let initialPadValue = document.querySelector<HTMLInputElement>("#pad-length")?.value ?? "";
  let padChanged = false;

  const persist = () => write(value);
  const render = () => {
    host.hidden = value.complete;
    if (value.complete) {
      host.innerHTML = "";
      return;
    }
    const definition = STEPS[value.step];
    const achieved = value.achieved.includes(definition.action);
    host.innerHTML = `
      <strong>Quick tour ${value.step + 1}/${STEPS.length}</strong>
      <span>${definition.instruction}</span>
      <small>${definition.context}</small>
      <span id="tour-action-status" role="status">${achieved ? "Action complete." : "Complete this action to continue."}</span>
      <button id="tour-next" type="button" ${achieved ? "" : "disabled"} aria-describedby="tour-action-status">${value.step === STEPS.length - 1 ? "Finish" : "Next"}</button>
      <button id="tour-skip" class="quiet" type="button">Skip</button>`;
    host.querySelector("#tour-next")?.addEventListener("click", () => {
      const next = advanceOnboarding(value);
      if (next === value) return;
      value = next;
      persist();
      render();
      if (!value.complete) document.querySelector<HTMLElement>(focusTargets[value.step])?.focus();
    });
    host.querySelector("#tour-skip")?.addEventListener("click", () => {
      value = { ...value, complete: true };
      persist();
      render();
    });
  };

  const achieve = (action: OnboardingAction) => {
    const next = recordOnboardingAction(value, action);
    if (next === value) return;
    value = next;
    persist();
    render();
  };

  const checkCommittedModel = () => {
    const operation = document.querySelector<HTMLElement>("#operation-state");
    if (
      padChanged &&
      operation?.dataset.status === "committed" &&
      operation.textContent?.includes("Extrude")
    ) achieve("model");
  };
  const checkSaved = () => {
    if (document.querySelector("#storage-status")?.textContent?.trim() === "saved") achieve("save");
  };

  document.addEventListener("input", (event) => {
    if (!(event.target instanceof HTMLInputElement) || event.target.id !== "pad-length") return;
    padChanged = event.target.value !== initialPadValue;
  });
  document.addEventListener("click", (event) => {
    if (event.target instanceof Element && event.target.closest("[data-timeline-id]")) achieve("timeline");
  }, true);
  new MutationObserver(() => {
    checkCommittedModel();
    checkSaved();
  }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });

  render();
  checkSaved();
  return {
    restart() {
      value = freshState();
      initialPadValue = document.querySelector<HTMLInputElement>("#pad-length")?.value ?? "";
      padChanged = false;
      persist();
      render();
      document.querySelector<HTMLInputElement>(focusTargets[0])?.focus();
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
