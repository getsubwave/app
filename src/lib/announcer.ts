// A set of subscribers told about something that happened outside the React
// tree: an App Intent's tune-out (src/audio/player.ts), its station switch
// (src/lib/station.ts), its like (src/lib/like-events.ts). A subscriber that
// throws is skipped, so it can never stop the action that announced.

export interface Announcer<T> {
  /** Returns the unsubscribe. */
  subscribe(fn: (value: T) => void): () => void;
  announce(value: T): void;
}

export function createAnnouncer<T = void>(): Announcer<T> {
  const listeners = new Set<(value: T) => void>();
  return {
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    announce(value) {
      listeners.forEach((fn) => {
        try {
          fn(value);
        } catch {
          /* one broken subscriber must not reach the announcer */
        }
      });
    },
  };
}
