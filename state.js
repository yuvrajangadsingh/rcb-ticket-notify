/**
 * State Manager — Persists per-match notification state to state.json.
 *
 * State per match:
 *   ticketsLiveAlerted  — true once we send the LIVE alert
 *   soldOutAlerted      — true once we send the SOLD-OUT alert
 *   lastStatus          — last known status string
 *   lastChecked         — ISO timestamp of last successful check
 *
 * Cooldown Logic:
 *   - After a match date passes, its state key is deleted automatically.
 *   - If tickets go from LIVE → NOT_LIVE, we reset `ticketsLiveAlerted` so
 *     the next time they come back live we alert again (handles brief drops).
 *   - A global `lastErrorAlertedAt` prevents spamming error notifications.
 */

import fs from 'fs';
import path from 'path';

const STATE_FILE = path.resolve('./state.json');

export function loadState() {
    try {
        if (fs.existsSync(STATE_FILE)) {
            return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
        }
    } catch (_) { /* ignore corrupt state */ }
    return {};
}

export function saveState(state) {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

/** Returns state for a single match, defaulting to fresh. */
export function getMatchState(state, matchId) {
    return state[matchId] || {
        ticketsLiveAlerted: false,
        soldOutAlerted:     false,
        lastStatus:         null,
        lastChecked:        null,
    };
}

/** Writes back updated match state into the global state object. */
export function setMatchState(state, matchId, matchState) {
    state[matchId] = { ...matchState, lastChecked: new Date().toISOString() };
}

/**
 * Purges state for matches that are more than 2 days past their match date.
 * This is what "resets" the cooldown for each match lifecycle.
 */
export function pruneExpiredMatches(state, activeMatchIds) {
    const prunedState = {};
    for (const [id, val] of Object.entries(state)) {
        if (activeMatchIds.includes(id) || id === 'meta') {
            prunedState[id] = val;
        }
        // else: match is expired, STATE is dropped → fresh start for future matches
    }
    return prunedState;
}
