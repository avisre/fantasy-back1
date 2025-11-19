const express = require('express');
const path = require('path');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const Stripe = require('stripe');
require('dotenv').config();

const app = express();
const jsonParser = express.json();
app.use((req, res, next) => {
  if (req.originalUrl === '/stripe/webhook') {
    next();
  } else {
    jsonParser(req, res, next);
  }
});
app.use(cors());

// Alpha Vantage API Key from environment variable
const ALPHA_VANTAGE_API_KEY = process.env.ALPHA_VANTAGE_API_KEY || '6VWT72JNHHLBF3MH';
const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret_key';
const profileCache = new Map();
const CORE_PLAN_PRICE = parseFloat(process.env.CORE_PLAN_PRICE || '29.90');
const CORE_PLAN_CURRENCY = process.env.CORE_PLAN_CURRENCY || 'GBP';
const TRIAL_DAYS = parseInt(process.env.TRIAL_DAYS || '14', 10);
const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const STRIPE_SUCCESS_URL = process.env.STRIPE_SUCCESS_URL || 'http://localhost:5050/dashboard.html?session=success';
const STRIPE_CANCEL_URL = process.env.STRIPE_CANCEL_URL || 'http://localhost:5050/register.html?session=cancel';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const STRIPE_PUBLISHABLE_KEY = process.env.STRIPE_PUBLISHABLE_KEY || '';
const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID || 'price_1S7RY8oBSlpmWqSgtaYCCso';
const stripe = stripeSecretKey ? Stripe(stripeSecretKey, { apiVersion: '2022-11-15' }) : null;

function defaultTrialEndsAt() {
  const date = new Date();
  date.setDate(date.getDate() + TRIAL_DAYS);
  return date;
}

function createDefaultSubscription() {
  return {
    planId: 'core',
    planName: 'Core',
    price: CORE_PLAN_PRICE,
    currency: CORE_PLAN_CURRENCY,
    status: 'pending',
    trialStartedAt: new Date(),
    trialEndsAt: null,
    activatedAt: null,
    renewedAt: null,
    lastPaymentAt: null,
  };
}

function normalizeSubscription(sub = {}) {
  return {
    planId: sub.planId || 'core',
    planName: sub.planName || 'Core',
    price: typeof sub.price === 'number' ? sub.price : CORE_PLAN_PRICE,
    currency: sub.currency || CORE_PLAN_CURRENCY,
    status: sub.status || 'pending',
    trialStartedAt: sub.trialStartedAt || null,
    trialEndsAt: sub.trialEndsAt || null,
    activatedAt: sub.activatedAt || null,
    renewedAt: sub.renewedAt || null,
    lastPaymentAt: sub.lastPaymentAt || null,
    isActive: sub.status === 'active',
    isCancelAtPeriodEnd: sub.status === 'cancel_at_period_end',
  };
}

function ensureSubscriptionShape(user) {
  if (!user.subscription || !user.subscription.planId) {
    user.subscription = createDefaultSubscription();
  }
  return normalizeSubscription(user.subscription);
}

function subscriptionIsActive(sub) {
  return sub && sub.status === 'active';
}

function passwordMeetsPolicy(password) {
  if (typeof password !== 'string') return false;
  return password.length >= 8 && /[A-Z]/.test(password) && /[a-z]/.test(password) && /\d/.test(password);
}
/**
 * Alpha Vantage HTTP client wrapper (Dependency Inversion)
 * Consumers depend on this small interface rather than axios directly.
 */
function createAlphaClient(http, apiKey){
  async function searchSymbols(query){
    const resp = await http.get('https://www.alphavantage.co/query', {
      params: { function:'SYMBOL_SEARCH', keywords:query, apikey: apiKey }
    });
    const list = resp?.data?.bestMatches || [];
    return list.map(m => ({ symbol: m['1. symbol'], name: m['2. name'] }));
  }
  async function intraday(symbol, interval='5min'){
    const resp = await http.get('https://www.alphavantage.co/query', {
      params: { function:'TIME_SERIES_INTRADAY', symbol, interval, apikey: apiKey }
    });
    return resp?.data?.['Time Series (5min)'] || {};
  }
  async function globalQuote(symbol){
    const resp = await http.get('https://www.alphavantage.co/query', {
      params: { function:'GLOBAL_QUOTE', symbol, apikey: apiKey }
    });
    return resp?.data?.['Global Quote'] || {};
  }
  async function overview(symbol){
    const resp = await http.get('https://www.alphavantage.co/query', {
      params: { function:'OVERVIEW', symbol, apikey: apiKey }
    });
    return resp?.data || {};
  }
  return { searchSymbols, intraday, globalQuote, overview };
}
const alphaClient = createAlphaClient(axios, ALPHA_VANTAGE_API_KEY);

// MongoDB connection
mongoose.connect('mongodb+srv://project:project@cluster0.kos1k7l.mongodb.net/DAT', {
    useNewUrlParser: true,
    useUnifiedTopology: true,
}).then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

// Serve static frontend files
app.use(express.static(path.join(__dirname, '../frontend')));

// User Schema for MongoDB
const SubscriptionSchema = new mongoose.Schema({
    planId: { type: String, default: 'core' },
    planName: { type: String, default: 'Core' },
    price: { type: Number, default: CORE_PLAN_PRICE },
    currency: { type: String, default: CORE_PLAN_CURRENCY },
    status: { type: String, enum: ['pending','active','cancel_at_period_end','cancelled'], default: 'pending' },
    trialStartedAt: { type: Date, default: () => new Date() },
    trialEndsAt: { type: Date, default: null },
    activatedAt: { type: Date, default: null },
    renewedAt: { type: Date, default: null },
    lastPaymentAt: { type: Date, default: null }
}, { _id: false });

const UserSchema = new mongoose.Schema({
    name: String,
    email: { type: String, unique: true },
    password: String,
    subscription: { type: SubscriptionSchema, default: createDefaultSubscription },
    stripeCustomerId: { type: String, default: null },
    stripeSubscriptionId: { type: String, default: null }
});

const User = mongoose.model('User', UserSchema);

async function getUserByToken(token) {
    if (!token) {
        throw { status: 401, message: 'Authentication required' };
    }
    let decoded;
    try {
        decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
        throw { status: 401, message: 'Invalid token' };
    }
    const user = await User.findById(decoded.userId);
    if (!user) {
        throw { status: 401, message: 'User not found' };
    }
    return user;
}

async function activateSubscription(user, { subscriptionId, customerId } = {}) {
    const now = new Date();
    user.subscription = ensureSubscriptionShape(user);
    user.subscription.status = 'active';
    user.subscription.activatedAt = now;
    user.subscription.renewedAt = now;
    user.subscription.trialStartedAt = user.subscription.trialStartedAt || now;
    user.subscription.trialEndsAt = null;
    user.subscription.lastPaymentAt = now;
    if (subscriptionId) {
        user.stripeSubscriptionId = subscriptionId;
    }
    if (customerId) {
        user.stripeCustomerId = customerId;
    }
    user.markModified('subscription');
    await user.save().catch(() => {});
}

// Stock Schema to include a reference to the user
const StockSchema = new mongoose.Schema({
    symbol: { type: String, required: true },
    name: { type: String },
    sector: { type: String },
    shares: { type: Number, required: true },
    purchasePrice: { type: Number },
    purchaseDate: { type: Date },
    currentPrice: { type: Number },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
});

const Stock = mongoose.model('Stock', StockSchema);

const SupportTicketSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true },
    subject: { type: String, required: true },
    message: { type: String, required: true },
    status: { type: String, enum: ['open', 'closed'], default: 'open' }
}, { timestamps: true });
const SupportTicket = mongoose.model('SupportTicket', SupportTicketSchema);

const DEFAULT_STOCKS = [
  { symbol: 'AAPL', name: 'Apple Inc.', sector: 'Technology', shares: 10 },
  { symbol: 'MSFT', name: 'Microsoft Corporation', sector: 'Technology', shares: 8 }
];

async function seedDefaultStocksForUser(userId, client = alphaClient) {
    try {
        const existing = await Stock.countDocuments({ user: userId });
        if (existing > 0) return;

        const docs = await Promise.all(
            DEFAULT_STOCKS.map(async (base) => {
                let price;
                let profile = { name: base.name, sector: base.sector };
                try {
                    price = await getStockPrice(base.symbol, client);
                } catch (error) {
                    console.warn(`Seed price lookup failed for ${base.symbol}: ${error.message}`);
                    price = 100;
                }
                try {
                    const fetched = await getCompanyProfile(base.symbol, client);
                    profile = {
                        name: profile.name || fetched.name,
                        sector: profile.sector || fetched.sector || ''
                    };
                } catch (err) {
                    console.warn(`Seed profile lookup failed for ${base.symbol}: ${err.message}`);
                }

                return {
                    symbol: base.symbol.toUpperCase(),
                    name: profile.name || base.symbol.toUpperCase(),
                    sector: profile.sector || '',
                    shares: base.shares,
                    purchasePrice: price,
                    purchaseDate: new Date(),
                    currentPrice: price,
                    user: userId
                };
            })
        );

        await Stock.insertMany(docs);
    } catch (err) {
        console.error('Default portfolio seeding failed:', err.message);
    }
}

// Middleware to authenticate user and enforce subscription
async function authMiddleware(req, res, next) {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
        return res.status(401).json({ message: 'Authentication required' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await User.findById(decoded.userId);
        if (!user) {
            return res.status(401).json({ message: 'User not found' });
        }

        const normalized = ensureSubscriptionShape(user);
        if (!subscriptionIsActive(user.subscription)) {
            if (user.isModified('subscription')) {
                await user.save().catch(() => {});
            }
            return res.status(402).json({
                message: 'An active Core subscription is required to use the app.',
                code: 'SUBSCRIPTION_REQUIRED',
                subscription: normalized
            });
        }

        if (user.isModified('subscription')) {
            await user.save().catch(() => {});
        }

        req.userId = user._id;
        req.user = user;
        req.subscription = normalized;
        next();
    } catch (error) {
        if (error instanceof jwt.JsonWebTokenError) {
            return res.status(401).json({ message: 'Invalid token' });
        }
        console.error('authMiddleware error:', error);
        return res.status(500).json({ message: 'Authentication failed' });
    }
}

// Subscription signup route
app.post('/api/subscribe', async (req, res) => {
    if (!stripe) {
        return res.status(500).json({ message: 'Stripe is not configured' });
    }
    const { name, email, password } = req.body || {};
    if (!name || !email || !password) {
        return res.status(400).json({ message: 'Name, email, and password are required' });
    }
    if (!passwordMeetsPolicy(password)) {
        return res.status(400).json({ message: 'Password must be at least 8 characters and include uppercase, lowercase, and a number.' });
    }
  try {
      let user = await User.findOne({ email: email.toLowerCase() });
        const hashedPassword = await bcrypt.hash(password, 10);
        if (user) {
            if (user.subscription.status === 'active') {
                return res.status(400).json({ message: 'Account already active. Please log in.' });
            }
            user.name = name;
            user.password = hashedPassword;
        } else {
            user = new User({ name, email: email.toLowerCase(), password: hashedPassword });
        }

        user.subscription = ensureSubscriptionShape(user);
        user.subscription.status = 'pending';
        user.subscription.planId = 'core';
        user.subscription.planName = 'Core';
        user.subscription.price = CORE_PLAN_PRICE;
        user.subscription.currency = CORE_PLAN_CURRENCY;
        user.subscription.trialStartedAt = new Date();
        user.subscription.trialEndsAt = null;
        user.subscription.activatedAt = null;
        user.subscription.renewedAt = null;
        user.subscription.lastPaymentAt = null;
        user.markModified('subscription');
        await user.save();
        await seedDefaultStocksForUser(user._id);

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            mode: 'subscription',
            customer_email: user.email,
            line_items: [{
                price: STRIPE_PRICE_ID,
                quantity: 1
            }],
            client_reference_id: user._id.toString(),
            success_url: STRIPE_SUCCESS_URL,
            cancel_url: STRIPE_CANCEL_URL,
            metadata: { userId: user._id.toString(), planId: 'core' }
        });
        res.status(200).json({ url: session.url });
    } catch (error) {
        console.error('Subscription checkout error:', error);
        res.status(500).json({ message: 'Unable to start the subscription', error: error.message });
    }
  });

app.post('/api/support', async (req, res) => {
    try {
        const { name, email, subject, message } = req.body || {};
        if (!name || !email || !subject || !message) {
            return res.status(400).json({ message: 'All fields are required' });
        }
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ message: 'Please provide a valid email address' });
        }
        const ticket = new SupportTicket({
            name: name.trim(),
            email: email.toLowerCase(),
            subject: subject.trim(),
            message: message.trim()
        });
        await ticket.save();
        res.status(201).json({ message: 'Support ticket submitted. We will reach out shortly.' });
    } catch (error) {
        console.error('Support ticket error:', error);
        res.status(500).json({ message: 'Unable to submit ticket right now.' });
    }
});

app.get('/stripe/config', (req, res) => {
    res.json({
        publishableKey: STRIPE_PUBLISHABLE_KEY,
        successUrl: STRIPE_SUCCESS_URL,
        cancelUrl: STRIPE_CANCEL_URL
    });
});

// Login API Route
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(400).json({ message: 'Invalid email or password' });
        }

        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(400).json({ message: 'Invalid email or password' });
        }

        const normalized = ensureSubscriptionShape(user);
        await seedDefaultStocksForUser(user._id);

        if (!subscriptionIsActive(user.subscription)) {
            if (user.isModified('subscription')) {
                await user.save().catch(() => {});
            }
            return res.status(402).json({
                message: 'An active Core subscription is required to log in. Please complete payment.',
                code: 'SUBSCRIPTION_REQUIRED',
                subscription: normalized
            });
        }

        if (user.isModified('subscription')) {
            await user.save().catch(() => {});
        }

        // Create JWT
        const token = jwt.sign({ userId: user._id }, JWT_SECRET);
        res.status(200).json({ token, subscription: normalized });
    } catch (error) {
        res.status(500).json({ message: 'Error logging in', error: error.message });
    }
});

app.post('/api/subscription/cancel', authMiddleware, async (req, res) => {
    if (!stripe) {
        return res.status(500).json({ message: 'Stripe is not configured' });
    }
    const user = req.user;
    if (!user.stripeSubscriptionId) {
        return res.status(400).json({ message: 'No active subscription to cancel' });
    }
    try {
        await stripe.subscriptions.update(user.stripeSubscriptionId, { cancel_at_period_end: true });
        user.subscription.status = 'cancel_at_period_end';
        await user.save();
        res.json({ message: 'Subscription will be canceled at the end of the period' });
    } catch (error) {
        console.error('Cancel subscription error:', error);
        res.status(500).json({ message: 'Unable to cancel the subscription', error: error.message });
    }
});

// Session route for client-side gating
app.get('/api/session', authMiddleware, async (req, res) => {
    try {
        const user = req.user;
        const subscription = req.subscription || ensureSubscriptionShape(user);
        const profile = {
            id: user._id,
            name: user.name,
            email: user.email
        };
        res.json({
            ok: true,
            profile,
            subscription
        });
    } catch (error) {
        console.error('/api/session error:', error);
        res.status(500).json({ message: 'Unable to load session' });
    }
});

// API to fetch real-time stock price from Alpha Vantage
async function getStockPrice(symbol, client = alphaClient) {
    const ticker = symbol.toUpperCase();
    try {
        const timeSeries = await client.intraday(ticker, '5min');
        const latest = Object.keys(timeSeries)[0];
        if (latest) {
            const currentPrice = parseFloat(timeSeries[latest]['4. close']);
            if (!Number.isNaN(currentPrice)) return currentPrice;
        }
        throw new Error('Intraday data unavailable');
    } catch (error) {
        try {
            const quote = await client.globalQuote(ticker);
            const price = parseFloat(quote['05. price']);
            if (!Number.isNaN(price)) return price;
        } catch {}
        throw new Error(`Error fetching stock price for ${ticker}: ${error.response?.data || error.message}`);
    }
}

async function getCompanyProfile(symbol, client = alphaClient) {
    const ticker = symbol.toUpperCase();
    const cached = profileCache.get(ticker);
    const now = Date.now();
    if (cached && now - cached.timestamp < 1000 * 60 * 30) {
        return cached.data;
    }

    try {
        const data = await client.overview(ticker);
        const profile = {
            name: data.Name || ticker,
            sector: data.Sector || '',
            industry: data.Industry || ''
        };
        profileCache.set(ticker, { data: profile, timestamp: now });
        return profile;
    } catch (error) {
        const fallback = { name: ticker, sector: '', industry: '' };
        profileCache.set(ticker, { data: fallback, timestamp: now });
        return fallback;
    }
}

// API to search for company symbols using Alpha Vantage's SYMBOL_SEARCH function
app.get('/api/search/:query', authMiddleware, async (req, res) => {
    const query = req.params.query;
    try {
        const matches = await alphaClient.searchSymbols(query);
        res.json(matches);
    } catch (error) {
        // Return an empty array instead of erroring to avoid breaking UX
        res.json([]);
    }
});

// API route to get the user's portfolio with updated prices
app.get('/api/portfolio', authMiddleware, async (req, res) => {
    try {
        const portfolio = await Stock.find({ user: req.userId });

        for (const stock of portfolio) {
            const ticker = (stock.symbol || '').toUpperCase();
            stock.symbol = ticker;
            try {
                const currentPrice = await getStockPrice(ticker);
                stock.currentPrice = currentPrice;
            } catch (priceError) {
                console.warn(`Price update failed for ${ticker}: ${priceError.message}`);
            }

            if (!stock.name || !stock.sector) {
                try {
                    const profile = await getCompanyProfile(ticker);
                    if (!stock.name && profile.name) stock.name = profile.name;
                    if (!stock.sector && profile.sector) stock.sector = profile.sector;
                } catch (profileError) {
                    console.warn(`Profile update failed for ${ticker}: ${profileError.message}`);
                }
            }

            await stock.save();
        }

        res.json(portfolio);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// API route to add a stock to the user's portfolio
app.post('/api/portfolio', authMiddleware, async (req, res) => {
    const { symbol, name, shares, purchaseDate } = req.body;

    try {
        if (!symbol || !shares) {
            return res.status(400).json({ message: 'Symbol and shares are required' });
        }

        const ticker = String(symbol).toUpperCase();
        const qty = Number(shares);
        if (!Number.isFinite(qty) || qty <= 0) {
            return res.status(400).json({ message: 'Shares must be a positive number' });
        }

        let currentPrice = 0;
        try {
            currentPrice = await getStockPrice(ticker);
        } catch (priceError) {
            console.warn(`Price lookup failed for ${ticker}: ${priceError.message}`);
        }

        let profile = await getCompanyProfile(ticker);
        const resolvedName = name || profile.name || ticker;
        const sector = profile.sector || '';
        let purchase = purchaseDate ? new Date(purchaseDate) : new Date();
        if (Number.isNaN(purchase.getTime())) {
            purchase = new Date();
        }

        const newStock = new Stock({
            symbol: ticker,
            name: resolvedName,
            sector,
            shares: qty,
            purchasePrice: currentPrice,
            purchaseDate: purchase,
            currentPrice,
            user: req.userId
        });

        await newStock.save();
        res.json(newStock);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// API route to delete a stock from the user's portfolio by ID
app.delete('/api/portfolio/:id', authMiddleware, async (req, res) => {
    try {
        const stockId = req.params.id;
        const stock = await Stock.findOneAndDelete({ _id: stockId, user: req.userId });
        if (!stock) {
            return res.status(404).json({ message: 'Stock not found or unauthorized' });
        }
        res.status(200).json({ message: 'Stock deleted successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Error deleting stock', error: error.message });
    }
});

app.post('/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    if (!stripe || !STRIPE_WEBHOOK_SECRET) {
        return res.status(400).send('Stripe webhook not configured');
    }
    const sig = req.headers['stripe-signature'];
    let event;
    try {
        event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
    } catch (error) {
        console.error('Stripe webhook signature error:', error);
        return res.status(400).send(`Webhook error: ${error.message}`);
    }

    const payload = event.data.object;
    if (event.type === 'checkout.session.completed') {
        try {
            const userId = payload.metadata?.userId || payload.client_reference_id;
            if (userId) {
                const user = await User.findById(userId);
                if (user) {
                    await activateSubscription(user, { subscriptionId: payload.subscription, customerId: payload.customer });
                }
            }
        } catch (err) {
            console.error('Stripe webhook processing error:', err);
        }
    } else if (event.type === 'customer.subscription.updated') {
        try {
            const subscription = payload;
            if (subscription.cancel_at_period_end) {
                const user = await User.findOne({ stripeSubscriptionId: subscription.id });
                if (user) {
                    user.subscription.status = 'cancel_at_period_end';
                    await user.save();
                }
            }
        } catch (err) {
            console.error('Stripe webhook update error:', err);
        }
    } else if (event.type === 'customer.subscription.deleted') {
        try {
            const subscription = payload;
            const user = await User.findOne({ stripeSubscriptionId: subscription.id });
            if (user) {
                user.subscription.status = 'cancelled';
                user.stripeSubscriptionId = null;
                await user.save();
            }
        } catch (err) {
            console.error('Stripe webhook delete error:', err);
        }
    }

    res.status(200).send({ received: true });
});

// Middleware to serve frontend HTML file
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// Start the server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));




