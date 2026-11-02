/* Keep startup and notification refreshes from interrupting each other. */
function singleFlight(run) {
  let pending = null;
  return (...args) => pending ||= Promise.resolve().then(() => run(...args)).finally(() => { pending = null; });
}
function createScheduleLoader(load, wait = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  return singleFlight(async () => {
    for (let attempt = 0; ; attempt++) {
      try { return await load(); }
      catch (error) {
        const status = Number(error?.status);
        const transient = error?.name === 'TypeError' || error?.name === 'AbortError' || status === 408 || status === 429 || status >= 500;
        if (!transient || attempt >= 2) throw error;
        await wait(500 * (attempt + 1));
      }
    }
  });
}
function scheduleErrorMessage(error) {
  if (Number(error?.status) === 403) return 'Your account does not have access to the Productions schedule. Contact your team administrator.';
  if (Number(error?.status) === 401 || /interaction|login_required|consent_required|invalid_grant/.test(error?.errorCode || '')) return 'Your sign-in needs to be refreshed. Tap Try again to reconnect.';
  return 'The schedule connection was interrupted. Check your connection, then tap Try again.';
}
function createPushRefresh({ isReady, isEditing, load, apply, onError }) {
  return singleFlight(async () => {
    if (!isReady() || isEditing()) return false;
    try {
      const data = await load();
      // Do not replace a draft started while the request was in flight.
      if (!isReady() || isEditing()) return false;
      apply(data); return true;
    } catch (error) { onError(error); return false; }
  });
}
