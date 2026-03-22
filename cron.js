import puppeteer from 'puppeteer';
import TelegramBot from 'node-telegram-bot-api';
import dotenv from 'dotenv';

dotenv.config();

const token = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;
const url = 'https://shop.royalchallengers.com/ticket';

if (!token || !chatId) {
    console.error("Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID in environment variables.");
    process.exit(1);
}

const bot = new TelegramBot(token, { polling: false });

async function checkTickets() {
    console.log(`[${new Date().toISOString()}] Checking for tickets at ${url}...`);
    let browser = null;

    try {
        browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--single-process'
            ]
        });

        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

        const text = await page.evaluate(() => document.body.innerText || '');
        const lowerText = text.toLowerCase();

        const currentUrl = page.url();

        // SUPER ROBUST LOGIC:
        // Currently, the '/ticket' URL redirects to '/merchandise' because tickets are disabled.
        // If the URL STAYS on '/ticket', or redirects to a strict ticketing queue (like TicketGenie), tickets are LIVE!
        const urlChangedFromDisabledState = !currentUrl.includes('/merchandise') && !currentUrl.endsWith('royalchallengers.com/');

        const hasKeyword = lowerText.includes('buy tickets') || lowerText.includes('book tickets');
        const hasMatchTerms = lowerText.includes('vs') && lowerText.includes('match');
        const hasDates = lowerText.match(/\d{1,2}\s+(mar|apr|may|jun|march|april|june)/);

        // It is live if the page stops redirecting to the merch store, OR finds explicit match date/ticket keywords.
        const isLive = urlChangedFromDisabledState || hasKeyword || hasMatchTerms || hasDates;

        if (isLive) {
            console.log(`[${new Date().toISOString()}] 🚨 TICKETS MIGHT BE AVAILABLE! 🚨`);
            const message = `🚨 *RCB MATCH TICKETS MIGHT BE LIVE!* 🚨\n\nMonitor has detected changes or booking keywords on the RCB tickets page.\n\nGo book immediately: ${url}`;

            await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
            console.log(`Notification sent via Telegram.`);
        } else {
            console.log(`[${new Date().toISOString()}] No tickets detected yet.`);
        }
    } catch (err) {
        console.error(`[${new Date().toISOString()}] Error checking tickets:`, err.message);
    } finally {
        if (browser) {
            await browser.close().catch(console.error);
        }
        // Since this is a cron script, we exit immediately so GitHub Actions doesn't hang
        process.exit(0);
    }
}

checkTickets();
