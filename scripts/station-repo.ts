// A few tests check the app's copies against the station's own code: the web
// player's request-outcome labels and lyrics helpers, and the controller's
// lyrics schema. That code lives in the station repo (perminder-klair/subwave),
// not here. SUBWAVE_REPO points at a checkout of it; without it, the
// subwave-home layout puts it at `../main` beside this repo.
//
// With no checkout those tests skip, unless CI is set: there a missing checkout
// is a broken workflow, so it fails rather than skipping the check silently.
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const STATION_REPO = resolve(process.env.SUBWAVE_REPO ?? fileURLToPath(new URL('../../main', import.meta.url)));

const found = existsSync(join(STATION_REPO, 'web')) && existsSync(join(STATION_REPO, 'controller'));

if (!found && process.env.CI) {
  throw new Error(`No station checkout at ${STATION_REPO}: set SUBWAVE_REPO to a perminder-klair/subwave checkout`);
}

/** The reason to skip a test that reads the station's code, or false to run it. */
export const stationSkip: string | false = found
  ? false
  : `no station checkout at ${STATION_REPO} (set SUBWAVE_REPO to a perminder-klair/subwave checkout)`;

/** A file from the station repo, by its path there; '' when there is no checkout. */
export const readStation = (path: string): string => (found ? readFileSync(join(STATION_REPO, path), 'utf8') : '');
