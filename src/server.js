require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);

const pool = require('./db/pool');
const migrate = require('./db/migrate');
const { requireAuth } = require('./auth/middleware');

const authRoutes = require('./auth/routes');
const cardRoutes = require('./routes/cards');
const userRoutes = require('./routes/users');
const adminRoutes = require('./routes/admin');
const publicRoutes = require('./routes/public');

const app = express();
app.set('trust proxy', 1); // behind Caddy

app.use(express.json({ limit: '15mb' })); // compressed card photos ride in the JSON body as base64

app.use(session({
  store: new pgSession({ pool, tableName: 'session' }),
  name: 'cardbox.sid',
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  },
}));

// Openly-served static assets: css/js/icons/manifest/service worker/login page/public card template.
app.use(express.static(path.join(__dirname, '..', 'public')));

// API
app.use(authRoutes);
app.use(cardRoutes);
app.use(userRoutes);
app.use(adminRoutes);
app.use(publicRoutes);

// Public digital-card page (client JS on the page fetches /api/public/cards/:slug)
app.get('/c/:slug', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'card-public.html'));
});

// Auth-gated app pages (kept outside the static dir so they can't be fetched without a session)
const VIEWS_DIR = path.join(__dirname, '..', 'views');
app.get('/', requireAuth, (req, res) => res.sendFile(path.join(VIEWS_DIR, 'scan.html')));
app.get('/cards.html', requireAuth, (req, res) => res.sendFile(path.join(VIEWS_DIR, 'cards.html')));
app.get('/admin.html', requireAuth, (req, res) => {
  if (req.session.role !== 'admin') return res.redirect('/');
  res.sendFile(path.join(VIEWS_DIR, 'admin.html'));
});

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error(err);
  res.status(500).json({ error: 'Internal server error.' });
});

const PORT = process.env.PORT || 3000;

migrate()
  .then(() => {
    app.listen(PORT, () => console.log(`Cardbox listening on :${PORT}`));
  })
  .catch((err) => {
    console.error('Failed to migrate database, exiting:', err);
    process.exit(1);
  });
