/**
 * RCB Ticket Monitor — Real-Time Orchestrator
 *
 * Architecture:
 *  - This script is executed by GitHub Actions every 5 minutes.
 *  - Instead of checking just ONCE per run, it continuously polls for ~4.5 minutes
 *    with a 15–20 second interval between checks.
 *  - This gives us near-real-time detection (≤20 seconds from ticket drop to alert).
 *  - Two parallel scrapes per cycle cut the miss window further in half.
 *  - State is persisted via state.json (cached by GitHub Actions Cache).
 *  - Per-match state resets automatically after match date + 1 day.
 */

import { scrape, STATUS }    from './scraper.js';
import { loadState, saveState, getMatchState, setMatchState, pruneExpiredMatches } from './state.js';
import { sendLiveAlert, sendSoldOutAlert, sendBackLiveAlert, sendErrorAlert }       from './notifier.js';
import { getActiveMatches }  from './matches.js';
import dotenv from 'dotenv';

dotenv.config();

// ─── CONFIG ────────────────────────────────────────────────────────────────
const TOKEN   = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// How long this script runs before exiting (milliseconds).
// GitHub Actions times out after 6m by default. We run for 4m 30s to be safe.
const RUN_DURATION_MS = 4 * 60 * 1000 + 30 * 1000; // 4.5 minutes

// Poll every 15–20 seconds (randomised to avoid predictable fingerprint)
const POLL_INTERVAL_MIN_MS = 15_000;
const POLL_INTERVAL_MAX_MS = 20_000;

// Maximum gap between error alerts (to avoid spamming on a broken site)
const ERROR_ALERT_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes

// ─── HELPERS ───────────────────────────────────────────────────────────────

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

function randomBetween(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function log(msg) {
    console.log(`[${new Date().toISOString()}] ${msg}`);
}

// ─── NOTIFICATION DECISION ENGINE ──────────────────────────────────────────

async function handleMatchResult(match, status, state) {
    const ms = getMatchState(state, match.id);
    let dirty = false; // whether state has changed and needs saving

    if (status === STATUS.LIVE) {
        // Sub-case: tickets came back LIVE after being SOLD OUT
        if (ms.soldOutAlerted && !ms.ticketsLiveAlerted) {
            await sendBackLiveAlert(match);
            ms.ticketsLiveAlerted = true;
            ms.soldOutAlerted     = false;
            dirty = true;
        }
        // Sub-case: first time seeing LIVE
        else if (!ms.ticketsLiveAlerted) {
            await sendLiveAlert(match);
            ms.ticketsLiveAlerted = true;
            ms.soldOutAlerted     = false;
            dirty = true;
        } else {
            log(`  ✅ Match ${match.id}: LIVE — already alerted, skipping.`);
        }
    }

    else if (status === STATUS.SOLD_OUT) {
        if (!ms.soldOutAlerted) {
            await sendSoldOutAlert(match);
            ms.soldOutAlerted     = true;
            ms.ticketsLiveAlerted = false; // reset live so if more batches drop we notify
            dirty = true;
        } else {
            log(`  😔 Match ${match.id}: SOLD OUT — already alerted.`);
        }
    }

    // Tickets went from LIVE → NOT_LIVE (e.g. between batches)
    // Reset the live-alerted flag so we trigger again if they go back live.
    else if ((status === STATUS.NOT_LIVE || status === STATUS.COMING_SOON) && ms.ticketsLiveAlerted) {
        log(`  🔄 Match ${match.id}: was LIVE but now ${status}. Resetting live alert flag.`);
        ms.ticketsLiveAlerted = false;
        dirty = true;
    }

    else {
        log(`  ℹ️  Match ${match.id}: Status=${status} — no notification needed.`);
    }

    ms.lastStatus = status;
    setMatchState(state, match.id, ms);
    return dirty;
}

// ─── SINGLE POLL CYCLE ─────────────────────────────────────────────────────

async function runPollCycle(activeMatches, state) {
    log(`─── Poll Cycle Start (${activeMatches.length} active home match(es)) ───`);

    // Run TWO parallel scrapes per cycle — if either returns LIVE, we win.
    const [r1, r2] = await Promise.all([
        scrape({ retries: 2 }),
        scrape({ retries: 2 }),
    ]);

    log(`  Scrape #1 → ${r1.status}: ${r1.details}`);
    log(`  Scrape #2 → ${r2.status}: ${r2.details}`);

    // Pick best result: LIVE > SOLD_OUT > COMING_SOON > NOT_LIVE > ERROR
    const priority = [STATUS.LIVE, STATUS.SOLD_OUT, STATUS.COMING_SOON, STATUS.NOT_LIVE, STATUS.UNKNOWN, STATUS.ERROR];
    const best = [r1, r2].sort((a, b) => priority.indexOf(a.status) - priority.indexOf(b.status))[0];

    // Handle errors — alert Telegram if scraping is broken (with cooldown)
    if (best.status === STATUS.ERROR) {
        const meta            = state.meta || {};
        const lastErrorAlerted = meta.lastErrorAlertedAt ? new Date(meta.lastErrorAlertedAt) : null;
        const timeSinceLast   = lastErrorAlerted ? Date.now() - lastErrorAlerted.getTime() : Infinity;

        if (timeSinceLast > ERROR_ALERT_COOLDOWN_MS) {
            await sendErrorAlert(best.details || 'Scrape failed after retries');
            state.meta = { ...meta, lastErrorAlertedAt: new Date().toISOString() };
            saveState(state);
        } else {
            log(`  ⚠️  Error detected but Telegram error-alert on cooldown. Logging only.`);
        }
        return; // don't process match states on a failed scrape
    }

    // Evaluate for each active match
    let stateChanged = false;
    for (const match of activeMatches) {
        const changed = await handleMatchResult(match, best.status, state);
        if (changed) stateChanged = true;
    }

    if (stateChanged) {
        saveState(state);
        log('  💾 State saved.');
    }
}

// ─── MAIN ──────────────────────────────────────────────────────────────────

async function main() {
    if (!TOKEN || !CHAT_ID) {
        console.error('❌ FATAL: Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID.');
        process.exit(1);
    }

    const activeMatches = getActiveMatches();

    if (activeMatches.length === 0) {
        log('ℹ️  No active RCB home matches found. Nothing to monitor. Exiting.');
        process.exit(0);
    }

    log(`🏏 RCB Ticket Monitor — Production Edition`);
    log(`   Active Matches: ${activeMatches.map(m => `${m.opponent} (${m.date})`).join(', ')}`);
    log(`   Run Window: ${RUN_DURATION_MS / 60000} minutes of real-time polling`);
    log(`   Poll Interval: ${POLL_INTERVAL_MIN_MS / 1000}–${POLL_INTERVAL_MAX_MS / 1000} seconds`);

    // Load and prune state
    let state = loadState();
    state = pruneExpiredMatches(state, activeMatches.map(m => m.id));

    const startTime = Date.now();
    let cycleCount  = 0;

    while (Date.now() - startTime < RUN_DURATION_MS) {
        cycleCount++;
        log(`\n══ CYCLE #${cycleCount} (${Math.round((Date.now() - startTime) / 1000)}s elapsed) ══`);

        try {
            await runPollCycle(activeMatches, state);
        } catch (err) {
            log(`❌ Unhandled error in poll cycle: ${err.message}`);
            try { await sendErrorAlert(err.message); } catch (_) {}
        }

        // Check if we still have enough time for another cycle
        const elapsed    = Date.now() - startTime;
        const remaining  = RUN_DURATION_MS - elapsed;
        const nextWait   = randomBetween(POLL_INTERVAL_MIN_MS, POLL_INTERVAL_MAX_MS);

        if (remaining <= nextWait + 5000) {
            log(`\n⏱️  ${Math.round(remaining / 1000)}s remaining — ending run cleanly.`);
            break;
        }

        log(`   Next poll in ${Math.round(nextWait / 1000)}s...`);
        await sleep(nextWait);
    }

    // Final state save on exit
    saveState(state);
    log(`\n✅ Run complete. ${cycleCount} cycles executed. State saved. Exiting.`);
    process.exit(0);
}

main().catch(async (err) => {
    console.error('❌ Fatal crash:', err.message);
    try { await sendErrorAlert(`Fatal crash: ${err.message}`); } catch (_) {}
    process.exit(1);
});
