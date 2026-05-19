require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cors = require('cors');
const helmet = require('helmet');
const { Client, Environment } = require('square');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();

// ── Security & Middleware ─────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: `https://${process.env.DOMAIN}`, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: process.env.NODE_ENV === 'production', maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

// ── Square Client ─────────────────────────────────────────────────────────────
const squareClient = new Client({
  accessToken: process.env.SQUARE_ACCESS_TOKEN,
  environment: process.env.SQUARE_ENVIRONMENT === 'production'
    ? Environment.Production
    : Environment.Sandbox,
});

const { paymentsApi, ordersApi } = squareClient;

// ── In-Memory DB (replace with real DB in production) ─────────────────────────
const db = {
  users: {},      // id -> user object
  creators: {},   // id -> creator object
  messages: {},   // conversationId -> [messages]
  transactions: [], // all star transactions
};

// Pre-seed some creators
const seedCreators = [
  { id: 'creator_luna', name: 'Luna Starr', handle: '@lunastarr', emoji: '🎵', bio: 'Chart-topping artist & producer. DM for collabs 🎵', tags: ['Music','Pop'], online: true, msgPrice: 5, picPrice: 15, vidPrice: 50, followers: 248000, rating: 4.9, earnings: 0 },
  { id: 'creator_jax', name: 'JaxPlayz', handle: '@jaxplayz', emoji: '🎮', bio: 'Pro gamer, streamer & occasional chef 🎮🍕', tags: ['Gaming','Streaming'], online: true, msgPrice: 5, picPrice: 15, vidPrice: 50, followers: 182000, rating: 4.8, earnings: 0 },
  { id: 'creator_aria', name: 'Aria Chen', handle: '@ariachen', emoji: '🎨', bio: 'Digital artist & NFT creator. Buy my drops 🎨', tags: ['Art','NFT'], online: false, msgPrice: 10, picPrice: 20, vidPrice: 75, followers: 95000, rating: 4.7, earnings: 0 },
  { id: 'creator_kai', name: 'FitWithKai', handle: '@fitwithkai', emoji: '💪', bio: 'Personal trainer & wellness coach. 1:1 programs 💪', tags: ['Fitness','Health'], online: true, msgPrice: 15, picPrice: 30, vidPrice: 100, followers: 310000, rating: 5.0, earnings: 0 },
  { id: 'creator_comedy', name: 'ComedyKing', handle: '@comedyking', emoji: '😂', bio: "Making you laugh since 2019. Don't take life seriously 😂", tags: ['Comedy','Entertainment'], online: false, msgPrice: 5, picPrice: 15, vidPrice: 50, followers: 560000, rating: 4.9, earnings: 0 },
  { id: 'creator_nova', name: 'ChefNova', handle: '@chefnova', emoji: '🍳', bio: 'Michelin-starred recipes at home. Food is love 🍳', tags: ['Cooking','Lifestyle'], online: true, msgPrice: 8, picPrice: 20, vidPrice: 60, followers: 130000, rating: 4.8, earnings: 0 },
];
seedCreators.forEach(c => { db.creators[c.id] = c; });

// ── Star Packages ─────────────────────────────────────────────────────────────
const STAR_PACKAGES = [
  { id: 'pkg_50',   stars: 50,   price: 1200,  label: 'Starter Pack',  usdLabel: '$12' },
  { id: 'pkg_200',  stars: 200,  price: 2000,  label: 'Fan Pack',      usdLabel: '$20' },
  { id: 'pkg_500',  stars: 500,  price: 4000,  label: 'Super Fan',     usdLabel: '$40' },
  { id: 'pkg_1200', stars: 1200, price: 8000,  label: 'VIP Pack',      usdLabel: '$80' },
  { id: 'pkg_3000', stars: 3000, price: 15000, label: 'Elite Star',    usdLabel: '$150'},
];

// Price per star in cents: varies by package (fans pay different rates)
// Platform keeps 50%, creator gets 50% of each star spent on them

// ── Helpers ───────────────────────────────────────────────────────────────────
function authRequired(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
  next();
}

function getUser(id) { return db.users[id] || db.creators[id]; }

// ── AUTH ROUTES ───────────────────────────────────────────────────────────────
app.post('/api/signup', (req, res) => {
  const { name, email, password, role, handle } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Missing fields' });

  const existingUser = Object.values(db.users).find(u => u.email === email)
    || Object.values(db.creators).find(u => u.email === email);
  if (existingUser) return res.status(400).json({ error: 'Email already in use' });

  const id = uuidv4();
  const user = {
    id, name, email,
    passwordHash: Buffer.from(password).toString('base64'), // use bcrypt in production
    role: role || 'fan',
    stars: 50,
    handle: handle || `@${name.toLowerCase().replace(/\s/g,'')}`,
    bio: '',
    emoji: role === 'creator' ? '🌟' : '⭐',
    createdAt: new Date().toISOString(),
    // creator-specific
    ...(role === 'creator' ? {
      msgPrice: 5, picPrice: 15, vidPrice: 50,
      earnings: 0, totalEarned: 0,
      online: true, followers: 0, rating: 5.0, tags: []
    } : {})
  };

  if (role === 'creator') {
    db.creators[id] = user;
  } else {
    db.users[id] = user;
  }

  // 50 free welcome stars logged
  db.transactions.push({ id: uuidv4(), userId: id, type: 'purchase', stars: 50, amount: 0, packageLabel: '🎁 Welcome Gift — Free Stars', createdAt: new Date().toISOString() });
  req.session.userId = id;
  req.session.role = role || 'fan';
  res.json({ success: true, user: sanitizeUser(user) });
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  const user = Object.values(db.users).find(u => u.email === email)
    || Object.values(db.creators).find(u => u.email === email);

  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  const hash = Buffer.from(password).toString('base64');
  if (user.passwordHash !== hash) return res.status(401).json({ error: 'Invalid credentials' });

  req.session.userId = user.id;
  req.session.role = user.role;
  res.json({ success: true, user: sanitizeUser(user) });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get('/api/me', authRequired, (req, res) => {
  const user = getUser(req.session.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(sanitizeUser(user));
});

// ── CREATORS ROUTES ───────────────────────────────────────────────────────────
app.get('/api/creators', (req, res) => {
  const creators = Object.values(db.creators).map(c => ({
    id: c.id, name: c.name, handle: c.handle, emoji: c.emoji,
    bio: c.bio, tags: c.tags, online: c.online,
    msgPrice: c.msgPrice, picPrice: c.picPrice, vidPrice: c.vidPrice,
    followers: c.followers, rating: c.rating,
  }));
  res.json(creators);
});

app.get('/api/creators/:id', (req, res) => {
  const creator = db.creators[req.params.id];
  if (!creator) return res.status(404).json({ error: 'Creator not found' });
  res.json({
    id: creator.id, name: creator.name, handle: creator.handle,
    emoji: creator.emoji, bio: creator.bio, tags: creator.tags,
    online: creator.online, msgPrice: creator.msgPrice,
    picPrice: creator.picPrice, vidPrice: creator.vidPrice,
    followers: creator.followers, rating: creator.rating,
  });
});

app.patch('/api/profile', authRequired, (req, res) => {
  const user = getUser(req.session.userId);
  if (!user) return res.status(404).json({ error: 'Not found' });
  const allowed = ['name','bio','emoji','handle','msgPrice','picPrice','vidPrice','tags'];
  allowed.forEach(k => { if (req.body[k] !== undefined) user[k] = req.body[k]; });
  res.json(sanitizeUser(user));
});

// ── PAYMENT ROUTES ────────────────────────────────────────────────────────────
app.get('/api/packages', (req, res) => {
  res.json(STAR_PACKAGES);
});

// Step 1: Create a Square payment for a star package
app.post('/api/purchase/stars', authRequired, async (req, res) => {
  const { packageId, sourceId } = req.body; // sourceId = Square card nonce from frontend
  const pkg = STAR_PACKAGES.find(p => p.id === packageId);
  if (!pkg) return res.status(400).json({ error: 'Invalid package' });

  const user = getUser(req.session.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  try {
    const response = await paymentsApi.createPayment({
      sourceId,
      idempotencyKey: uuidv4(),
      amountMoney: {
        amount: BigInt(pkg.price),
        currency: 'USD',
      },
      locationId: process.env.SQUARE_LOCATION_ID,
      note: `StarChat - ${pkg.label} (${pkg.stars} Stars) for ${user.email}`,
      buyerEmailAddress: user.email,
    });

    if (response.result.payment.status === 'COMPLETED') {
      user.stars += pkg.stars;

      db.transactions.push({
        id: uuidv4(),
        userId: user.id,
        type: 'purchase',
        stars: pkg.stars,
        amount: pkg.price,
        packageLabel: pkg.label,
        squarePaymentId: response.result.payment.id,
        createdAt: new Date().toISOString(),
      });

      res.json({
        success: true,
        stars: user.stars,
        added: pkg.stars,
        paymentId: response.result.payment.id,
      });
    } else {
      res.status(400).json({ error: 'Payment not completed', status: response.result.payment.status });
    }
  } catch (err) {
    console.error('Square payment error:', err);
    res.status(500).json({ error: 'Payment failed', details: err.message });
  }
});

// Step 2: Spend stars to message a creator — 50/50 split happens here
app.post('/api/message/send', authRequired, async (req, res) => {
  const { creatorId, type, content } = req.body;
  // type: 'message' | 'picture' | 'video' | 'react'

  const user = getUser(req.session.userId);
  const creator = db.creators[creatorId];
  if (!user || !creator) return res.status(404).json({ error: 'Not found' });
  if (user.role === 'creator') return res.status(400).json({ error: 'Creators cannot message creators' });

  const COSTS = {
    message: creator.msgPrice,
    picture: creator.picPrice,
    video: creator.vidPrice,
    react: 2,
  };
  const cost = COSTS[type];
  if (!cost) return res.status(400).json({ error: 'Invalid message type' });
  if (user.stars < cost) return res.status(400).json({ error: 'Insufficient stars', have: user.stars, need: cost });

  // Deduct from fan
  user.stars -= cost;

  // 50/50 split
  const creatorShare = Math.floor(cost * 0.5);  // 50% to creator
  const platformShare = cost - creatorShare;     // 50% to StarChat

  creator.earnings = (creator.earnings || 0) + creatorShare;
  creator.totalEarned = (creator.totalEarned || 0) + creatorShare;

  // Store message
  const convId = [user.id, creatorId].sort().join('_');
  if (!db.messages[convId]) db.messages[convId] = [];
  const msg = {
    id: uuidv4(),
    senderId: user.id,
    senderName: user.name,
    creatorId,
    type,
    content,
    cost,
    creatorShare,
    platformShare,
    createdAt: new Date().toISOString(),
  };
  db.messages[convId].push(msg);

  db.transactions.push({
    id: uuidv4(),
    userId: user.id,
    type: 'spend',
    subtype: type,
    stars: -cost,
    creatorId,
    creatorShare,
    platformShare,
    messageId: msg.id,
    createdAt: new Date().toISOString(),
  });

  res.json({
    success: true,
    message: msg,
    userStarsRemaining: user.stars,
    creatorShareStars: creatorShare,
    platformShareStars: platformShare,
  });
});

// Get conversation messages
app.get('/api/messages/:creatorId', authRequired, (req, res) => {
  const convId = [req.session.userId, req.params.creatorId].sort().join('_');
  res.json(db.messages[convId] || []);
});

// Get user's transactions
app.get('/api/transactions', authRequired, (req, res) => {
  const txs = db.transactions.filter(t => t.userId === req.session.userId);
  res.json(txs.slice(-50).reverse());
});

// Creator: see their earnings
app.get('/api/creator/earnings', authRequired, (req, res) => {
  const creator = db.creators[req.session.userId];
  if (!creator) return res.status(403).json({ error: 'Not a creator' });
  const txs = db.transactions.filter(t => t.creatorId === req.session.userId);
  res.json({
    earningsStars: creator.earnings || 0,
    totalEarnedStars: creator.totalEarned || 0,
    transactions: txs.slice(-50).reverse(),
    // Stars are worth ~$0.10 each to creator at 200 stars/$20 package
    estimatedUSD: ((creator.totalEarned || 0) * 0.10).toFixed(2),
  });
});

// Creator: request payout (webhook/manual for now)
app.post('/api/creator/payout', authRequired, (req, res) => {
  const creator = db.creators[req.session.userId];
  if (!creator) return res.status(403).json({ error: 'Not a creator' });
  if (creator.earnings < 100) return res.status(400).json({ error: 'Minimum 100 stars to withdraw' });

  const amount = creator.earnings;
  creator.earnings = 0; // reset pending

  db.transactions.push({
    id: uuidv4(),
    userId: req.session.userId,
    type: 'payout',
    stars: amount,
    createdAt: new Date().toISOString(),
  });

  res.json({ success: true, payoutStars: amount, estimatedUSD: (amount * 0.10).toFixed(2) });
});

// Platform analytics (admin)
app.get('/api/admin/stats', (req, res) => {
  const totalUsers = Object.keys(db.users).length;
  const totalCreators = Object.keys(db.creators).length;
  const totalStarsSold = db.transactions
    .filter(t => t.type === 'purchase')
    .reduce((sum, t) => sum + t.stars, 0);
  const totalStarsSpent = db.transactions
    .filter(t => t.type === 'spend')
    .reduce((sum, t) => sum + Math.abs(t.stars), 0);
  const platformRevenue = db.transactions
    .filter(t => t.type === 'spend')
    .reduce((sum, t) => sum + (t.platformShare || 0), 0);

  res.json({ totalUsers, totalCreators, totalStarsSold, totalStarsSpent, platformRevenueStars: platformRevenue });
});

// ── Catch-all: serve frontend ─────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function sanitizeUser(u) {
  const { passwordHash, ...safe } = u;
  return safe;
}

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n⭐ StarChat running on http://localhost:${PORT}`);
  console.log(`   Domain: https://${process.env.DOMAIN}`);
  console.log(`   Square: ${process.env.SQUARE_ENVIRONMENT}`);
  console.log(`   Split: 50% creator / 50% platform\n`);
});
