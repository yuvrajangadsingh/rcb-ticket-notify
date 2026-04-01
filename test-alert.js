/**
 * Test script — sends a fake "tickets live" alert to verify Telegram works.
 * Run via: TELEGRAM_BOT_TOKEN=xxx TELEGRAM_CHAT_ID=xxx node test-alert.js
 */
import { sendAvailableAlert } from './notifier.js';
import dotenv from 'dotenv';
dotenv.config();

const fakeMatch = {
    id: 'test-rcb-vs-csk',
    name: 'RCB vs CSK (TEST ALERT — IGNORE)',
    date: 'Sat, 05 Apr 2026, 7:30 PM',
    venue: 'M. Chinnaswamy Stadium, Bengaluru',
    price: '₹2,300 - ₹65,800',
    status: 'AVAILABLE',
    link: 'https://shop.royalchallengers.com/ticket',
};

console.log('Sending test alert...');
const ok = await sendAvailableAlert(fakeMatch);
console.log(ok ? '✅ Test alert delivered!' : '❌ Test alert FAILED');
process.exit(ok ? 0 : 1);
