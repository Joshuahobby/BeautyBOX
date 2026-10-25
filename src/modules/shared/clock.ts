// Single source of "now" for domain decisions (expiry, due jobs, quote validity).
// Tests move time explicitly instead of sleeping; production uses the system clock.

type Clock = () => Date;

let current: Clock = () => new Date();

export function now(): Date {
  return current();
}

export function addSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1000);
}

/** Test-only: freeze or shift time. Returns a restore function. */
export function setClockForTests(clock: Clock): () => void {
  const previous = current;
  current = clock;
  return () => {
    current = previous;
  };
}
