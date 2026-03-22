/**
 * Telegram Notifier
 * Builds and sends all notification types: LIVE, SOLD_OUT, BACK_LIVE, ERROR.
 */

import TelegramBot from 'node-telegram-bot-api';

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const TARGET_URL = 'https://shop.royalchallengers.com/ticket';

let _bot = null;
function getBot() {
    if (!_bot) _bot = new TelegramBot(TOKEN, { polling: false });
    return _bot;
}

function istTime() {
    return new Date().toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        day: '2-digit', month: 'short', year: 'numeric',
    });
}

export async function sendLiveAlert(match) {
    const msg =
        `🚨🏏 *RCB TICKETS ARE LIVE!* 🏏🚨\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `✅ *Status:* TICKETS AVAILABLE NOW!\n\n` +
        `🆚 *Match:* RCB vs ${match.opponent}\n` +
        `📅 *Date:* ${match.date} at ${match.time}\n` +
        `🏟️ *Venue:* ${match.venue}\n\n` +
        `🔗 *[👉 CLICK HERE TO BOOK NOW](${TARGET_URL})*\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `⏰ *Detected At:* ${istTime()} IST\n\n` +
        `_Act fast — tickets sell out in minutes!_ 🔥`;

    await getBot().sendMessage(CHAT_ID, msg, { parse_mode: 'Markdown', disable_web_page_preview: false });
    console.log(`📩 [LIVE ALERT] Sent for match: ${match.id}`);
}

export async function sendSoldOutAlert(match) {
    const msg =
        `😔 *RCB Tickets Sold Out*\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `🆚 *Match:* RCB vs ${match.opponent}\n` +
        `📅 *Date:* ${match.date} at ${match.time}\n\n` +
        `All tickets are sold. Keep watching the link — cancellations sometimes open up.\n` +
        `🔗 ${TARGET_URL}\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `⏰ Checked at: ${istTime()} IST`;

    await getBot().sendMessage(CHAT_ID, msg, { parse_mode: 'Markdown' });
    console.log(`📩 [SOLD OUT ALERT] Sent for match: ${match.id}`);
}

export async function sendBackLiveAlert(match) {
    const msg =
        `🔄🚨 *RCB TICKETS BACK IN STOCK!* 🚨🔄\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `♻️ *Status:* Tickets were sold out but are AVAILABLE AGAIN!\n\n` +
        `🆚 *Match:* RCB vs ${match.opponent}\n` +
        `📅 *Date:* ${match.date} at ${match.time}\n` +
        `🏟️ *Venue:* ${match.venue}\n\n` +
        `🔗 *[👉 CLICK TO BOOK NOW](${TARGET_URL})*\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `⏰ *Detected At:* ${istTime()} IST`;

    await getBot().sendMessage(CHAT_ID, msg, { parse_mode: 'Markdown', disable_web_page_preview: false });
    console.log(`📩 [BACK LIVE ALERT] Sent for match: ${match.id}`);
}

export async function sendErrorAlert(errorMessage) {
    const msg =
        `⚠️ *RCB Monitor — Script Error*\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `The monitor encountered an error and may have missed a check.\n\n` +
        `\`\`\`\n${errorMessage.slice(0, 500)}\n\`\`\`\n\n` +
        `Please check [GitHub Actions logs](https://github.com/nit2370/rcb-ticket-notify/actions).\n` +
        `⏰ ${istTime()} IST`;

    await getBot().sendMessage(CHAT_ID, msg, { parse_mode: 'Markdown' });
    console.log(`📩 [ERROR ALERT] Sent.`);
}
