# StarChat Deployment Guide
# integrid.us — Square Connected — 50/50 Split

## STEP 1: Install Node.js (if you don't have it)
Go to: https://nodejs.org
Download the LTS version and install it.
Verify it worked by opening Terminal and typing:
  node --version

## STEP 2: Install your app dependencies
Open Terminal, navigate to the starchat folder, then run:
  npm install

## STEP 3: Test locally first
  npm start
Then open your browser to: http://localhost:3000
Everything should work. Sign up, browse creators, buy stars (simulated).

## STEP 4: Deploy to a server (choose one)

### OPTION A — Railway.app (easiest, free tier available)
1. Go to railway.app and sign up
2. Click "New Project" → "Deploy from GitHub"
3. Upload your starchat folder to a GitHub repo first
4. Railway auto-detects Node.js and deploys
5. Add your .env variables in Railway's dashboard under "Variables"

### OPTION B — Render.com (also free tier)
1. Go to render.com and sign up
2. New → Web Service → connect your GitHub repo
3. Build command: npm install
4. Start command: node server.js
5. Add environment variables in Render dashboard

### OPTION C — VPS (DigitalOcean, Linode, etc.)
1. Create a $6/month Ubuntu droplet
2. SSH in, install Node.js
3. Upload files via SFTP (FileZilla app)
4. Run: npm install && npm start
5. Use PM2 to keep it running: npm install -g pm2 && pm2 start server.js

## STEP 5: Connect your Squarespace domain (integrid.us)
Once your app is deployed and has a public URL (e.g. starchat.up.railway.app):

1. Log into Squarespace
2. Go to Settings → Domains → integrid.us → DNS Settings
3. Add a CNAME record:
   - Host: @  (or www)
   - Points to: your-app.up.railway.app (whatever Railway/Render gives you)
4. Wait 10–30 minutes for DNS to update
5. Your app is live at integrid.us

## STEP 6: Switch Square to PRODUCTION (real money)
In your .env file, it's already set to production mode.
Your credentials are already wired in.
The Square Web Payments SDK will load automatically on your live domain.

## STEP 7: ROTATE YOUR SQUARE TOKEN (do this now)
Go to: developer.squareup.com
Find your StarChat app → Credentials → Regenerate Access Token
Paste the new token into your .env file on line 2.
This keeps your account secure.

## YOUR 50/50 SPLIT — HOW IT WORKS
When a fan spends stars on a creator:
- Creator gets 50% of the stars credited to their account
- Platform (you) keeps 50%
- Stars are logged in /api/admin/stats
- Creators request payouts via the app
- You pay out manually via Square Dashboard or Venmo/etc.

## STAR VALUE REFERENCE
50 stars = $12 → each star worth ~$0.24 to you
200 stars = $20 → each star worth ~$0.10 to you  
Creators earn 50% of stars spent on them
At 200-star rate: creator earns ~$0.05 per star received

## FILES IN YOUR PACKAGE
starchat/
  server.js        ← Backend (Express + Square API)
  public/
    index.html     ← Full frontend app
  .env             ← Your credentials (keep private, never commit to GitHub)
  package.json     ← Dependencies

## ADDING A REAL DATABASE (next step after launch)
Currently uses in-memory storage (resets on server restart).
For persistence, swap to:
- MongoDB Atlas (free tier) — easiest
- PlanetScale MySQL (free tier)
- Supabase PostgreSQL (free tier)
Let me know and I'll wire it up.
