/**
 * Scraper — Puppeteer + Cheerio based ticket page scraper.
 *
 * Strategy:
 *  1. Launch a stealth headless browser with random User-Agent + headers.
 *  2. Navigate to the ticket page with a random jitter delay.
 *  3. After page load, parse the full HTML with Cheerio (DOM-based, not regex).
 *  4. Use structural selectors + text patterns to classify page state.
 *  5. Return a structured result object.
 */

import puppeteer from 'puppeteer';
import * as cheerio from 'cheerio';

const TARGET_URL = 'https://shop.royalchallengers.com/ticket';

const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15',
];

export const STATUS = {
    LIVE:          'LIVE',
    SOLD_OUT:      'SOLD_OUT',
    COMING_SOON:   'COMING_SOON',
    NOT_LIVE:      'NOT_LIVE',      // redirected to merch / no useful content
    UNKNOWN:       'UNKNOWN',
    ERROR:         'ERROR',
};

function randomBetween(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomUA() {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

/**
 * Classify the page using Cheerio DOM parsing.
 * Much more robust than raw text matching — looks at element structure.
 */
function classify(html, finalUrl) {
    const $ = cheerio.load(html);

    // If redirected to the merch store, it's definitely not the ticket page
    if (finalUrl.includes('/merchandise')) {
        return { status: STATUS.NOT_LIVE, details: 'Redirected to merchandise page' };
    }

    // Combine all visible text content for broad keyword matching
    const bodyText = $('body').text().toLowerCase().trim();

    // ── CHECK BUTTONS (most reliable signal) ─────────────────────────────────
    // Look for any <button> or <a> elements that say "Buy" or "Book"
    let buyButtonFound   = false;
    let soldOutFound     = false;
    let comingSoonFound  = false;

    $('button, a, [role="button"]').each((_, el) => {
        const t = $(el).text().toLowerCase().trim();
        if (/buy\s*(now|ticket|tickets)?|book\s*(now|ticket|tickets)?|add\s+to\s+cart|get\s+tickets/.test(t)) {
            buyButtonFound = true;
        }
        if (/sold\s*out|housefull|no\s+tickets/.test(t)) {
            soldOutFound = true;
        }
    });

    // ── CHECK META TEXT ───────────────────────────────────────────────────────
    if (!soldOutFound) {
        soldOutFound = /sold\s*out|housefull|no\s+tickets\s+available/.test(bodyText);
    }

    if (/coming\s+soon|stay\s+tuned|tickets\s+not\s+yet\s+available|tickets\s+will\s+be\s+available/.test(bodyText)) {
        comingSoonFound = true;
    }

    // ── CHECK PAGE FOR MATCH-SPECIFIC CONTENT ─────────────────────────────────
    // Look for opponent names (all IPL teams), match date patterns, or ticket price indicators
    const hasMatchContent = (
        /sunrisers|chennai|mumbai|kolkata|rajasthan|punjab|delhi|lucknow|gujarat/.test(bodyText) ||
        /\d{1,2}\s+(jan|feb|mar|apr|may|jun|jul|aug|sept|oct|nov|dec)/i.test(bodyText) ||
        /₹\s*\d{3,}|rs\.\s*\d{3,}|inr\s*\d{3,}/.test(bodyText)  // price indicators
    );

    // ── FINAL CLASSIFICATION ─────────────────────────────────────────────────
    if (soldOutFound) {
        return { status: STATUS.SOLD_OUT, details: 'Sold out indicators found on page' };
    }

    if (buyButtonFound || (hasMatchContent && finalUrl.includes('/ticket'))) {
        // Extract match date if visible
        const dateMatch = bodyText.match(/\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\s*(?:\d{4})?/i);
        return {
            status:  STATUS.LIVE,
            details: 'Buy buttons or match content detected',
            foundDate: dateMatch ? dateMatch[0] : null,
        };
    }

    if (comingSoonFound) {
        return { status: STATUS.COMING_SOON, details: '"Coming Soon" or equivalent found' };
    }

    // If the page is on /ticket but has no meaningful content yet (React still loading)
    if (finalUrl.includes('/ticket') && bodyText.length < 200) {
        return { status: STATUS.UNKNOWN, details: 'Page on /ticket but very little content — may still be loading' };
    }

    return { status: STATUS.NOT_LIVE, details: `No live indicators. Final URL: ${finalUrl}` };
}

/**
 * Main scrape function.
 * Spins up its own browser, scrapes, and tears everything down cleanly.
 * Includes random delay + retry logic.
 */
export async function scrape({ retries = 2 } = {}) {
    // 🧪 TEST MODE — REMOVE AFTER TESTING
    return { status: STATUS.LIVE, details: 'FORCED TEST MODE', foundDate: '28 March 2026' };
    // 🧪 END TEST MODE

    // Random jitter delay before hitting the server (800ms – 3s)
    const jitter = randomBetween(800, 3000);
    console.log(`  ↳ Jitter delay: ${jitter}ms before request`);
    await sleep(jitter);

    let browser = null;
    let lastError = null;

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            browser = await puppeteer.launch({
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-blink-features=AutomationControlled',
                    '--disable-web-security',
                ],
            });

            const page = await browser.newPage();

            // Set stealth headers
            await page.setUserAgent(randomUA());
            await page.setExtraHTTPHeaders({
                'Accept-Language':          'en-IN,en;q=0.9,hi;q=0.8',
                'Accept':                   'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                'DNT':                      '1',
                'Upgrade-Insecure-Requests': '1',
                'Cache-Control':            'no-cache',
                'Pragma':                   'no-cache',
            });

            // Override webdriver detection flag
            await page.evaluateOnNewDocument(() => {
                Object.defineProperty(navigator, 'webdriver', { get: () => false });
            });

            await page.goto(TARGET_URL, { waitUntil: 'networkidle2', timeout: 45000 });

            // Wait for React to hydrate (up to 4 sec)
            await page.waitForFunction(
                () => document.body.innerText.length > 50,
                { timeout: 4000 }
            ).catch(() => console.warn('  ⚠️  React hydration timeout — classifying with partial content'));

            const html     = await page.content();
            const finalUrl = page.url();
            await browser.close();
            browser = null;

            const result = classify(html, finalUrl);
            console.log(`  ↳ Attempt ${attempt}: finalUrl=${finalUrl} → status=${result.status}`);
            return result;

        } catch (err) {
            lastError = err;
            console.error(`  ↳ Attempt ${attempt} failed: ${err.message}`);
            if (browser) { await browser.close().catch(() => {}); browser = null; }

            if (attempt < retries) {
                const backoff = randomBetween(2000, 5000) * attempt;
                console.log(`  ↳ Retrying in ${backoff}ms...`);
                await sleep(backoff);
            }
        }
    }

    return { status: STATUS.ERROR, details: lastError?.message || 'Unknown error after retries' };
}
