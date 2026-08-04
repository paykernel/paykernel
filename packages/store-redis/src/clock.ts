/**
 * Injectable clock compatible with testkit FakeClock (`now` / `nowMs`).
 */

export type StoreClock = {
  now(): Date;
  nowMs(): number;
};

/** Wall-clock default when no clock is injected. */
export function createSystemClock(): StoreClock {
  return {
    now: () => new Date(),
    nowMs: () => Date.now(),
  };
}

/** ISO-8601 string from a clock (portable TEXT timestamps). */
export function clockNowIso(clock: StoreClock): string {
  return new Date(clock.nowMs()).toISOString();
}

/** ISO-8601 of nowMs + deltaMs. */
export function clockAddMsIso(clock: StoreClock, deltaMs: number): string {
  return new Date(clock.nowMs() + deltaMs).toISOString();
}

/** Epoch milliseconds string for Lua ARGV (number-safe as string). */
export function clockNowMsString(clock: StoreClock): string {
  return String(clock.nowMs());
}

/** Epoch ms of now + delta, as string. */
export function clockAddMsString(clock: StoreClock, deltaMs: number): string {
  return String(clock.nowMs() + deltaMs);
}
