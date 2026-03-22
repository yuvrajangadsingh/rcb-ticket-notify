/**
 * RCB Ticket Monitor — Production Edition
 * Runs as a one-shot GitHub Actions job on a schedule.
 * All state is managed via a GitHub Actions output file (state.json).
 */

import puppeteer from 'puppeteer';
import TelegramBot from 'node-telegram-bot-api';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

// ─── CONFIG ────────────────────────────────────────────────────────────────
const TOKEN     = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID   = process.env.TELEGRAM_CHAT_ID;
const TARGET_URL = 'https://shop.royalchallengers.com/ticket';

// State is persisted between runs via a local JSON file (committed or cached in CI).
// In GitHub Actions we use actions/cache to persist this across runs.
const STATE_FILE = path.resolve('./state.json');

// User-agent pool to rotate between runs so we look like different browsers
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15',
];

// ─── HELPERS ───────────────────────────────────────────────────────────────

function randomBetween(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomUA() {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

/** Load persisted state, defaults to "not alerted yet". */
function loadState() {
    try {
        if (fs.existsSync(STATE_FILE)) {
            return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
        }
    } catch (_) { /* ignore corrupt state */ }
    return { lastAlertedStatus: null, lastAlertedAt: null };
}

/** Persist state so we don't spam duplicate alerts. */
function saveState(state) {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

/** Classify a page's content into a human-readable ticket status. */
function classifyPage(text, currentUrl) {
    const t = text.toLowerCase();

    // Highest priority: URL never left the disabled redirect → tickets definitely not live
    if (currentUrl.includes('/merchandise')) {
        return { status: 'REDIRECTED_TO_MERCH', isLive: false, isSoldOut: false };
    }

    // Check for sold out indicators
    if (t.includes('sold out') || t.includes('housefull') || t.includes('no tickets available')) {
        return { status: 'SOLD_OUT', isLive: false, isSoldOut: true };
    }

    // Check for coming soon / not yet live indicators
    if (
        (t.includes('coming soon') || t.includes('stay tuned') || t.includes('tickets not available')) &&
        !t.includes('buy') && !t.includes('book now')
    ) {
        return { status: 'COMING_SOON', isLive: false, isSoldOut: false };
    }

    // Strongest live signals — explicit booking action words
    const hasBuyKeyword  = t.includes('buy tickets') || t.includes('book tickets') || t.includes('book now') || t.includes('add to cart');
    const hasMatchTerms  = t.includes(' vs ') && (t.includes('rcb') || t.includes('bangalore'));
    const hasDates       = /\d{1,2}\s+(mar|apr|may|jun|july|march|april|june|july)/i.test(text);
    const urlStayedOnTicket = currentUrl.includes('/ticket');

    if (hasBuyKeyword || hasMatchTerms || hasDates || urlStayedOnTicket) {
        // Extract any date found to include in notification
        const dateMatch = text.match(/\d{1,2}\s+(?:Mar|Apr|May|Jun|Jul|March|April|June|July)[a-z]*[\s,]*\d{0,4}/i);
        const foundDate = dateMatch ? dateMatch[0].trim() : null;
        return { status: 'LIVE', isLive: true, isSoldOut: false, foundDate };
    }

    return { status: 'UNKNOWN', isLive: false, isSoldOut: false };
}

/** Scrape a single URL and return page text + final URL. */
async function scrapePage(browser, targetUrl) {
    const page = await browser.newPage();
    try {
        // Set realistic browser headers
        await page.setUserAgent(randomUA());
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'en-IN,en;q=0.9',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'DNT': '1',
            'Upgrade-Insecure-Requests': '1',
        });

        // Random delay before hitting the server (500ms – 2s) to avoid fingerprinting
        await sleep(randomBetween(500, 2000));

        await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 45000 });

        // Extra wait for React to hydrate the DOM (up to 3s)
        await page.waitForFunction(() => document.body.innerText.length > 100, { timeout: 5000 }).catch(() => {});

        const text = await page.evaluate(() => document.body.innerText || '');
        const currentUrl = page.url();
        return { text, currentUrl, error: null };
    } catch (err) {
        return { text: '', currentUrl: targetUrl, error: err.message };
    } finally {
        await page.close().catch(() => {});
    }
}

/** Build a rich Telegram message based on the classification. */
function buildMessage(classification) {
    const ts = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    const dateStr = classification.foundDate ? `\n📅 *Match Date Detected:* ${classification.foundDate}` : '';

    return (
        `🚨 *RCB MATCH TICKETS ARE LIVE!* 🚨\n` +
        `━━━━━━━━━━━━━━━━━━━━━\n` +
        `✅ *Status:* Tickets Available\n` +
        dateStr +
        `\n🏟️ *Team:* Royal Challengers Bengaluru\n` +
        `🔗 *Book Now:* [shop.royalchallengers.com/ticket](${TARGET_URL})\n` +
        `━━━━━━━━━━━━━━━━━━━━━\n` +
        `⏰ *Detected At:* ${ts} IST\n\n` +
        `_Open the link and book immediately before they sell out!_`
    );
}

// ─── MAIN ──────────────────────────────────────────────────────────────────

async function main() {
    // Validate secrets
    if (!TOKEN || !CHAT_ID) {
        console.error('❌ FATAL: Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID.');
        process.exit(1);
    }

    const bot   = new TelegramBot(TOKEN, { polling: false });
    const state = loadState();
    console.log(`[${new Date().toISOString()}] Previous alert state: ${JSON.stringify(state)}`);

    let browser = null;
    let exitCode = 0;

    try {
        browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--single-process',
                '--disable-blink-features=AutomationControlled', // hide puppeteer fingerprint
            ]
        });

        // ── PARALLEL CHECKS ──────────────────────────────────────────────
        // We run TWO concurrent checks against the same URL in parallel.
        // If either of them detects live tickets, we notify immediately.
        // This effectively cuts our worst-case miss window in half.
        console.log(`[${new Date().toISOString()}] Running 2 parallel checks...`);

        const [result1, result2] = await Promise.all([
            scrapePage(browser, TARGET_URL),
            scrapePage(browser, TARGET_URL),
        ]);

        // Log any scrape-level errors (script will NOT crash — just report)
        if (result1.error) console.error(`⚠️  Check #1 scrape error: ${result1.error}`);
        if (result2.error) console.error(`⚠️  Check #2 scrape error: ${result2.error}`);

        const class1 = classifyPage(result1.text, result1.currentUrl);
        const class2 = classifyPage(result2.text, result2.currentUrl);

        console.log(`[${new Date().toISOString()}] Check #1 → ${result1.currentUrl} | Status: ${class1.status}`);
        console.log(`[${new Date().toISOString()}] Check #2 → ${result2.currentUrl} | Status: ${class2.status}`);

        // Use the most optimistic classification from 2 parallel runs
        const classification = class1.isLive ? class1 : class2.isLive ? class2 : class1;

        // ── SOLD OUT ALERT ────────────────────────────────────────────────
        if (classification.isSoldOut && state.lastAlertedStatus !== 'SOLD_OUT') {
            const soldOutMsg =
                `😔 *RCB Tickets Are SOLD OUT!*\n\n` +
                `Better luck next time — keep watching the link in case returns open up.\n` +
                `🔗 ${TARGET_URL}`;
            await bot.sendMessage(CHAT_ID, soldOutMsg, { parse_mode: 'Markdown' });
            saveState({ lastAlertedStatus: 'SOLD_OUT', lastAlertedAt: new Date().toISOString() });
            console.log('📩 Sold-out notification sent.');
        }

        // ── LIVE ALERT ────────────────────────────────────────────────────
        else if (classification.isLive) {
            // Anti-spam: only alert if status changed from last run
            if (state.lastAlertedStatus === 'LIVE') {
                console.log('✅ Tickets still live but already alerted. Skipping duplicate.');
            } else {
                console.log('🚨 TICKETS ARE LIVE! Sending Telegram notification...');
                const message = buildMessage(classification);
                await bot.sendMessage(CHAT_ID, message, { parse_mode: 'Markdown', disable_web_page_preview: false });
                saveState({ lastAlertedStatus: 'LIVE', lastAlertedAt: new Date().toISOString() });
                console.log('📩 Live notification sent successfully!');
            }
        }

        // ── RESET STATE if tickets went away (so we alert again next time they come back) ──
        else {
            if (state.lastAlertedStatus === 'LIVE') {
                console.log('⚠️  Tickets were live before but are gone now. Resetting state to alert again next time.');
                saveState({ lastAlertedStatus: null, lastAlertedAt: null });
            } else {
                console.log(`[${new Date().toISOString()}] No live tickets detected. Status: ${classification.status}`);
            }
        }

    } catch (err) {
        // Never let an unhandled error crash silently — always report it
        console.error(`❌ FATAL ERROR: ${err.message}`);

        // Alert on Telegram about the failure so you know the monitor is broken
        try {
            const bot2 = new TelegramBot(TOKEN, { polling: false });
            await bot2.sendMessage(
                CHAT_ID,
                `⚠️ *RCB Monitor Error*\n\nThe monitor encountered an error during the check. Please review the GitHub Actions logs.\n\n\`${err.message}\``,
                { parse_mode: 'Markdown' }
            );
        } catch (_) { /* ignore telegram failure during error reporting */ }

        exitCode = 1;
    } finally {
        if (browser) await browser.close().catch(() => {});
        process.exit(exitCode);
    }
}

main();
