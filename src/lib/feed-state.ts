import type { StationState } from './types';

export function feedState(st: StationState): StationState {
  if (!st || typeof st !== 'object') return st;
  const { streamIdleWindow: _ages, ...rest } = st;
  return rest;
}
