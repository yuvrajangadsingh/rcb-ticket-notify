import puppeteer from 'puppeteer';
import TelegramBot from 'node-telegram-bot-api';
import express from 'express';
import dotenv from 'dotenv';

dotenv.config();

const token = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;
const port = process.env.PORT || 3000;
const url = 'https://shop.royalchallengers.com/ticket';

if (!token || !chatId) {
    console.error("Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID in environment variables.");
    process.exit(1);
}

// Initialize Telegram bot in API format (no polling needed for sending)
const bot = new TelegramBot(token, { polling: false });
const app = express();

// A simple web server to keep the Render (or other free cloud host) app alive
app.get('/ping', (req, res) => res.send('pong'));
app.get('/', (req, res) => res.send('RCB Ticket Monitor is running!'));

app.listen(port, () => console.log(`[SERVER] Listening on port ${port} to keep alive.`));

let isTicketsAvailable = false;
let notificationSentCount = 0;
const MAX_NOTIFICATIONS = 3;

async function checkTickets() {
    if (isTicketsAvailable && notificationSentCount >= MAX_NOTIFICATIONS) {
        console.log("Maximum notifications sent. Stopping checks to prevent spam.");
        process.exit(0); // Optional: Exit process since our job is done
    }

    console.log(`[${new Date().toISOString()}] Checking for tickets at ${url}...`);
    let browser = null;
    
    try {
        browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox', 
                '--disable-dev-shm-usage', // Recommended for Docker/Render environments
                '--single-process'
            ]
        });
        
        const page = await browser.newPage();
        // Mask as a normal browser to avoid simple bot protections
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        // Wait until there are no more than 2 network connections for at least 500ms
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

        // Extract all text content from the body
        const text = await page.evaluate(() => document.body.innerText || '');
        const lowerText = text.toLowerCase();
        
        // --- DETECTION LOGIC ---
        // Right now the page might just be an empty unrendered div or say "Coming Soon".
        // The presence of action keywords like "buy", "book", or match numbers and dates 
        // usually indicate the ticket buying interface has been enabled.
        const hasKeyword = lowerText.includes('buy') || 
                           lowerText.includes('book') || 
                           lowerText.includes('add to cart');
                           
        const hasMatchTerms = lowerText.includes('vs') && lowerText.includes('match');
        
        // Look for basic dates (e.g., 28 Mar, 10 April)
        const hasDates = lowerText.match(/\d{1,2}\s+(mar|apr|may|jun|march|april|june)/);
        
        // We trigger if there's any strong indication that the page is usable
        const isLive = hasKeyword || hasMatchTerms || hasDates;

        if (isLive) {
            console.log(`[${new Date().toISOString()}] 🚨 TICKETS MIGHT BE AVAILABLE! 🚨`);
            isTicketsAvailable = true;
            notificationSentCount++;
            
            const message = `🚨 *RCB MATCH TICKETS MIGHT BE LIVE!* 🚨\n\nMonitor has detected changes or booking keywords on the RCB tickets page.\n\nGo book immediately: ${url}`;
            
            await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
            console.log(`Notification ${notificationSentCount}/${MAX_NOTIFICATIONS} sent via Telegram.`);
        } else {
            console.log(`[${new Date().toISOString()}] No tickets detected yet.`);
        }
    } catch (err) {
        console.error(`[${new Date().toISOString()}] Error checking tickets:`, err.message);
    } finally {
        if (browser) {
            await browser.close().catch(console.error);
        }
    }
}

// Run the check every 5 minutes (300,000 ms)
// This is frequent enough to be instant, but slow enough not to be IP banned or overwhelm standard limits
const CHECK_INTERVAL = 5 * 60 * 1000;
setInterval(checkTickets, CHECK_INTERVAL);

// Perform initial check explicitly when the process starts
checkTickets();
