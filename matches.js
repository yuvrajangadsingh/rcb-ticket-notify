/**
 * RCB Home Matches at M. Chinnaswamy Stadium — IPL 2026
 *
 * Source: Official IPL Schedule (Phase 1 confirmed, rest TBD)
 * Update this file as the full schedule is released by BCCI.
 *
 * Fields:
 *  id        — unique slug used as state key
 *  opponent  — opposition team
 *  date      — ISO date string of match day (IST)
 *  time      — match time IST
 *  venue     — stadium name
 */

export const HOME_MATCHES = [
    {
        id:       'rcb-vs-srh-2026-03-28',
        opponent: 'Sunrisers Hyderabad',
        date:     '2026-03-28',
        time:     '7:30 PM IST',
        venue:    'M. Chinnaswamy Stadium, Bengaluru',
    },
    {
        id:       'rcb-vs-csk-2026-04-05',
        opponent: 'Chennai Super Kings',
        date:     '2026-04-05',
        time:     '7:30 PM IST',
        venue:    'M. Chinnaswamy Stadium, Bengaluru',
    },
    // ── Phase 2 schedule (add when BCCI releases full schedule) ─────────────
    // {
    //     id:       'rcb-vs-xxx-2026-04-XX',
    //     opponent: 'Team Name',
    //     date:     '2026-04-XX',
    //     time:     '7:30 PM IST',
    //     venue:    'M. Chinnaswamy Stadium, Bengaluru',
    // },
];

/**
 * Returns only matches whose date is today or in the future (not expired).
 * A match is considered "over" after its date has passed.
 */
export function getActiveMatches() {
    const today = new Date();
    // Give a 1-day buffer after match day before removing from active list
    today.setDate(today.getDate() - 1);
    return HOME_MATCHES.filter(m => new Date(m.date) >= today);
}
