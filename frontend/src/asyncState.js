// Small request guards used by list views. A newer request or a mutation invalidates
// older responses, so a slow network response cannot replace newer screen state.
export function createRequestGate() {
  let current = 0;
  return {
    issue() { current += 1; return current; },
    invalidate() { current += 1; },
    isCurrent(token) { return token === current; }
  };
}

// One mutation at a time for actions that affect the same machine list/form.
export function createMutationGate(onChange = () => {}) {
  let active = null;
  return {
    isBusy() { return active !== null; },
    getActive() { return active; },
    async run(label, task) {
      if (active !== null) return { started: false };
      active = label;
      onChange(active);
      try { return { started: true, value: await task() }; }
      finally { active = null; onChange(null); }
    }
  };
}
