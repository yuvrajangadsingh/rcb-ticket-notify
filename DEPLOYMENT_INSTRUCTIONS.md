# Deployment Instructions

Follow these steps to deploy your RCB Ticket Monitor so it runs 24/7 for free and notifies you immediately when tickets are available.

## 1. Setup Telegram Bot
1. Open Telegram and search for `@BotFather`.
2. Send `/newbot` and follow the instructions to create a bot (give it a name like `RCBTicketMonitorBot`).
3. BotFather will give you a **HTTP API Token**. Save this; you will need it later as `TELEGRAM_BOT_TOKEN`.
4. Send a message to your new bot (e.g., "Hello").
5. Go to `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates` in your browser (replace `<YOUR_TOKEN>` with the token from Step 3).
6. Look for `"chat":{"id":12345678,...}` in the response. Copy that ID. This is your `TELEGRAM_CHAT_ID`.

## 2. Deploy to GitHub Actions (Completely Free & Unlimited)
Since you reached your Render limits, the absolute best way to run this is using GitHub Actions on a **Public Repository**. GitHub gives unlimited free action minutes for public repositories!

1. Create a **New Public Repository** on your GitHub account. 
   *(Make sure it is public so you get unlimited free runs. Do NOT put your Telegram token in the files!)*
2. Push all the files in this `rcb-ticket` folder to your new repository.
3. In your GitHub repository, go to **Settings** (top right tab).
4. On the left sidebar, click **Secrets and variables** -> **Actions**.
5. Click the green **New repository secret** button:
   - Name: `TELEGRAM_BOT_TOKEN`
   - Secret: *Paste your token from Step 1*
   - Click **Add secret**
6. Click **New repository secret** again:
   - Name: `TELEGRAM_CHAT_ID`
   - Secret: *Paste your Chat ID from Step 1*
   - Click **Add secret**
7. Click on the **Actions** tab at the top of your repository page. Find the "RCB Ticket Monitor" workflow on the left and click it. You will see a banner saying "This workflow has a workflow_dispatch event trigger", allowing you to click **Run workflow** manually to test it!

🎉 You are done! GitHub Actions will now automatically spin up a secure, invisible server every 10 minutes, run the check, and shut down. It costs nothing for public repos, so you will never be suspended again!
