// -----------------------------------------------------------------------------
// Button presses -> click, double click, long press, long press release.
//
// LEAP sends Press and Release (plus MultiTap and LongHold on some RA3 / QSX
// programmings). Per button:
//   - Press arms the long-press timer; when it fires: long press, and the
//     next Release is the end of the long press;
//   - a Release before it opens the double-click window: a second Press in
//     the window is a double click (reported at once), otherwise a click
//     when the window ends;
//   - native MultiTap is a double click, native LongHold a long press;
//   - "instant" mode: a click on Press, nothing else (no delay at all).
// Raise / lower buttons get a longer long-press delay (they repeat while
// held, a short press must stay a click). Timings after Homebridge's Lutron
// plugin. Pure: the timers are injectable for the tests.
// -----------------------------------------------------------------------------

export const PRESSES = Object.freeze({
  CLICK: 'click',
  DOUBLE: 'double',
  LONG_PRESS: 'long-press',
  LONG_RELEASE: 'long-release',
});

export const DETECTION_TIMINGS = Object.freeze({
  normal: { doubleMs: 300, longMs: 350, raiseLowerExtraMs: 250 },
  relaxed: { doubleMs: 450, longMs: 750, raiseLowerExtraMs: 250 },
});

/**
 * @param {object} options
 * @param {'instant' | 'normal' | 'relaxed'} options.mode
 * @param {(buttonId: string, press: string) => void} options.onPress
 * @param {typeof setTimeout} [options.setTimer]
 * @param {typeof clearTimeout} [options.clearTimer]
 */
export function createButtonTracker({
  mode,
  onPress,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  let current = mode;
  /** @type {Map<string, { phase: string, timer: any }>} */
  const buttons = new Map();

  const stateOf = (buttonId) => {
    if (!buttons.has(buttonId)) buttons.set(buttonId, { phase: 'idle', timer: null });
    return buttons.get(buttonId);
  };
  const stop = (state) => {
    if (state.timer) clearTimer(state.timer);
    state.timer = null;
  };
  const emit = (buttonId, press) => onPress(buttonId, press);
  const timings = () => DETECTION_TIMINGS[current] ?? DETECTION_TIMINGS.normal;

  const pressed = (buttonId, state, raiseLower) => {
    const { longMs, raiseLowerExtraMs } = timings();
    state.phase = 'down';
    state.timer = setTimer(
      () => {
        state.timer = null;
        state.phase = 'long';
        emit(buttonId, PRESSES.LONG_PRESS);
      },
      longMs + (raiseLower ? raiseLowerExtraMs : 0),
    );
  };

  return {
    get mode() {
      return current;
    },

    /** @param {'instant' | 'normal' | 'relaxed'} next */
    setMode(next) {
      if (next === current) return;
      current = next;
      this.reset();
    },

    /**
     * @param {string} buttonId
     * @param {string} event Press, Release, MultiTap, LongHold
     * @param {{ raiseLower?: boolean }} [button]
     */
    handle(buttonId, event, { raiseLower = false } = {}) {
      if (current === 'instant') {
        if (event === 'Press') emit(buttonId, PRESSES.CLICK);
        return;
      }
      const state = stateOf(buttonId);
      switch (event) {
        case 'Press':
          if (state.phase === 'waiting') {
            stop(state);
            state.phase = 'second';
            emit(buttonId, PRESSES.DOUBLE);
            return;
          }
          stop(state);
          // A Release was lost (connection blip): close the long press.
          if (state.phase === 'long') emit(buttonId, PRESSES.LONG_RELEASE);
          pressed(buttonId, state, raiseLower);
          return;
        case 'Release':
          if (state.phase === 'down') {
            stop(state);
            state.phase = 'waiting';
            state.timer = setTimer(() => {
              state.timer = null;
              state.phase = 'idle';
              emit(buttonId, PRESSES.CLICK);
            }, timings().doubleMs);
          } else if (state.phase === 'long') {
            state.phase = 'idle';
            emit(buttonId, PRESSES.LONG_RELEASE);
          } else if (state.phase === 'second') {
            state.phase = 'idle';
          }
          return;
        case 'MultiTap':
          stop(state);
          if (state.phase !== 'second') emit(buttonId, PRESSES.DOUBLE);
          state.phase = state.phase === 'down' || state.phase === 'second' ? 'second' : 'idle';
          return;
        case 'LongHold':
          if (state.phase === 'down') {
            stop(state);
            state.phase = 'long';
            emit(buttonId, PRESSES.LONG_PRESS);
          }
          return;
        default:
      }
    },

    /** Forget every press in progress (reconnection, new model, new mode). */
    reset() {
      for (const state of buttons.values()) stop(state);
      buttons.clear();
    },
  };
}
