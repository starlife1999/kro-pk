require('dotenv').config();
const path = require('path');
const fs = require('fs/promises');
const express = require('express');
const cookieParser = require('cookie-parser');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const https = require('https');
const { Resend } = require('resend');
const multer = require('multer');
const { Readable } = require('stream');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
const { v2: cloudinary } = require('cloudinary');

const Product = require('./models/Product');
const Order = require('./models/Order');
const Counter = require('./models/Counter');
const PromoCode = require('./models/PromoCode');
const Subscriber = require('./models/Subscriber');
const Broadcast = require('./models/Broadcast');
const AnalyticsEvent = require('./models/AnalyticsEvent');
const ShopperProfile = require('./models/ShopperProfile');
const Visit = require('./models/Visit');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@kropk.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'password';
const OWNER_EMAIL = process.env.OWNER_EMAIL || 'orders@kropk.com';
/** Flat nationwide delivery in NGN (must match cart checkout). */
const FLAT_DELIVERY_FEE_NGN = 4500;
const SITE_URL = 'https://www.kro-pk.shop';
const SITE_ICON_URL = `${SITE_URL}/android-chrome-512x512.png`;

if (!process.env.MONGODB_URI) {
  console.warn('Warning: MONGODB_URI not set. Using default local mongodb://localhost:27017/kro_pk_store');
}

const resend = new Resend(process.env.RESEND_API_KEY);
const COMING_SOON_RAW = process.env.COMING_SOON;
const COMING_SOON_ENABLED = String(COMING_SOON_RAW || 'false').trim().replace(/^['"]|['"]$/g, '').toLowerCase() === 'true';
const COMING_SOON_PASSWORD = process.env.COMING_SOON_PASSWORD || '';
const COMING_SOON_ACCESS_COOKIE = 'kro_pk_public_access';
const ABANDONED_CART_HOURS = 24;

app.use(cookieParser());

app.use((req, res, next) => {
  if (!COMING_SOON_ENABLED) return next();

  const p = req.path;
  const isComingSoonPage = p === '/coming-soon';
  const isApiRoute = p.startsWith('/api');
  const isAdminRoute = p.startsWith('/admin');
  const isAsset = /\.(css|js|mjs|map|jpg|jpeg|png|gif|webp|ico|svg|woff2?|ttf|txt|xml|webmanifest)$/i.test(p);

  if (isApiRoute) return next();

  try {
    const access = req.cookies?.[COMING_SOON_ACCESS_COOKIE];
    if (access && !isAdminRoute) {
      const payload = jwt.verify(access, JWT_SECRET);
      if (payload?.scope === 'coming-soon-access') return next();
    }
  } catch {}

  if (isComingSoonPage || isAdminRoute || isAsset) {
    return next();
  }
  return res.redirect(302, '/coming-soon');
});

app.use(express.json());
app.use((req, res, next) => {
  if (req.path === '/admin' || req.path === '/admin.js') {
    res.set('Cache-Control', 'no-store');
  }
  next();
});
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/coming-soon', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'coming-soon.html'));
});

app.post('/api/coming-soon/login', (req, res) => {
  const password = String(req.body?.password || '');

  if (!COMING_SOON_PASSWORD) {
    return res.status(503).json({ message: 'Access password is not configured' });
  }

  if (password !== COMING_SOON_PASSWORD) {
    return res.status(401).json({ message: 'Invalid password' });
  }

  const token = jwt.sign({ scope: 'coming-soon-access' }, JWT_SECRET, { expiresIn: '7d' });
  res.cookie(COMING_SOON_ACCESS_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000
  });
  return res.json({ redirectTo: '/shop' });
});

function escapeXml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function absoluteSiteUrl(value = '') {
  try {
    return new URL(value || '/slideshow-1.jpg', `${SITE_URL}/`).href;
  } catch {
    return `${SITE_URL}/slideshow-1.jpg`;
  }
}

function buildProductDescription(product) {
  return `${product.description || 'Limited streetwear piece.'} Shop KRO PK streetwear and limited fashion drops made for the Keep Rocking mindset.`;
}

const productSort = { sortOrder: 1, createdAt: 1 };

function buildProductJsonLd(product) {
  const url = `${SITE_URL}/products/${encodeURIComponent(product.slug)}`;
  const image = absoluteSiteUrl(product.image);
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: buildProductDescription(product),
    image: [image],
    brand: {
      '@type': 'Brand',
      '@id': `${SITE_URL}/#brand`,
      name: 'KRO PK',
      logo: SITE_ICON_URL,
      category: 'Streetwear fashion brand'
    },
    category: 'Streetwear',
    keywords: 'KRO PK streetwear brand, Nigerian streetwear brand, youth streetwear brand, limited fashion drops, Keep Rocking',
    url,
    offers: {
      '@type': 'Offer',
      priceCurrency: 'NGN',
      price: Number(product.price || 0),
      availability: product.active ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      url
    }
  });
}

function buildProductBreadcrumbJsonLd(product) {
  const url = `${SITE_URL}/products/${encodeURIComponent(product.slug)}`;
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE_URL}/` },
      { '@type': 'ListItem', position: 2, name: 'Shop', item: `${SITE_URL}/shop1.html` },
      { '@type': 'ListItem', position: 3, name: product.name, item: url }
    ]
  });
}

app.get('/robots.txt', (_req, res) => {
  res.type('text/plain');
  res.send([
    'User-agent: *',
    'Allow: /',
    'Allow: /favicon.ico',
    'Allow: /favicon-16x16.png',
    'Allow: /favicon-32x32.png',
    'Allow: /favicon-48x48.png',
    'Allow: /apple-touch-icon.png',
    'Allow: /android-chrome-192x192.png',
    'Allow: /android-chrome-512x512.png',
    'Disallow: /admin',
    'Disallow: /api/admin',
    '',
    `Sitemap: ${SITE_URL}/sitemap.xml`
  ].join('\n'));
});

app.get('/sitemap.xml', async (_req, res) => {
  try {
    const products = await Product.find({ active: true }).sort(productSort).select('slug updatedAt').lean();
    const staticUrls = [
      { loc: `${SITE_URL}/`, priority: '1.0' },
      { loc: `${SITE_URL}/index.html`, priority: '1.0' },
      { loc: `${SITE_URL}/shop1.html`, priority: '0.9' },
      { loc: `${SITE_URL}/about.html`, priority: '0.8' },
      { loc: `${SITE_URL}/returns.html`, priority: '0.6' },
      { loc: `${SITE_URL}/cart.html`, priority: '0.5' }
    ];
    const productUrls = products
      .filter(product => product.slug)
      .map(product => ({
        loc: `${SITE_URL}/product.html?slug=${encodeURIComponent(product.slug)}`,
        lastmod: product.updatedAt ? new Date(product.updatedAt).toISOString() : null,
        priority: '0.8'
      }));
    const urls = [...staticUrls, ...productUrls];
    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      ...urls.map(url => [
        '  <url>',
        `    <loc>${escapeXml(url.loc)}</loc>`,
        url.lastmod ? `    <lastmod>${escapeXml(url.lastmod)}</lastmod>` : '',
        `    <priority>${url.priority}</priority>`,
        '  </url>'
      ].filter(Boolean).join('\n')),
      '</urlset>'
    ].join('\n');

    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.send(xml);
  } catch (err) {
    console.error('Failed to build sitemap', err);
    res.status(500).type('application/xml').send('<?xml version="1.0" encoding="UTF-8"?><error>Unable to generate sitemap</error>');
  }
});

app.get('/products/:slug', async (req, res) => {
  const product = await Product.findOne({ slug: req.params.slug, active: true }).lean();
  if (!product) {
    res.status(404).sendFile(path.join(__dirname, '..', 'public', '404.html'));
    return;
  }

  const url = `${SITE_URL}/product.html?slug=${encodeURIComponent(product.slug)}`;
  const description = buildProductDescription(product);
  const image = absoluteSiteUrl(product.image);
  let html = await fs.readFile(path.join(__dirname, '..', 'public', 'product.html'), 'utf8');
  html = html
    .replace('<title>Product | KRO PK Streetwear</title>', `<title>${escapeHtml(product.name)} | KRO PK Streetwear</title>`)
    .replace('content="Shop KRO PK streetwear products, limited fashion drops, and bold everyday pieces made for the Keep Rocking mindset."', `content="${escapeHtml(description)}"`)
    .replace('href="https://www.kro-pk.shop/product.html"', `href="${escapeHtml(url)}"`)
    .replaceAll('content="Product | KRO PK Streetwear"', `content="${escapeHtml(product.name)} | KRO PK Streetwear"`)
    .replaceAll('content="Explore KRO PK streetwear and limited fashion drops."', `content="${escapeHtml(description)}"`)
    .replaceAll('content="https://www.kro-pk.shop/slideshow-1.jpg"', `content="${escapeHtml(image)}"`)
    .replace('content="https://www.kro-pk.shop/product.html"', `content="${escapeHtml(url)}"`)
    .replace('</head>', `  <script id="server-product-json-ld" type="application/ld+json">${buildProductJsonLd(product)}</script>\n  <script id="server-product-breadcrumb-json-ld" type="application/ld+json">${buildProductBreadcrumbJsonLd(product)}</script>\n</head>`);
  res.type('html').send(html);
});

app.get('/about', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'about.html'));
});

app.get('/about.html', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'about.html'));
});

app.get('/shop', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'shop1.html'));
});

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const UPLOAD_TIMEOUT_MS = Number(process.env.UPLOAD_TIMEOUT_MS || 45000);
const CLOUDINARY_UPLOAD_FOLDER = 'kro-pk/products';
const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif'
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_UPLOAD_BYTES,
    files: 4
  },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_IMAGE_MIME_TYPES.has(file.mimetype)) {
      return cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', file.fieldname));
    }
    return cb(null, true);
  }
});

function uploadPublicId(file) {
  const field = String(file?.fieldname || 'image').replace(/[^a-zA-Z0-9_-]+/g, '-') || 'image';
  const original = String(file?.originalname || '').replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 40);
  return [field, original, Date.now()].filter(Boolean).join('-');
}

function formatBytes(bytes) {
  return `${Math.round((Number(bytes || 0) / 1024 / 1024) * 10) / 10}MB`;
}

function uploadErrorStatus(err) {
  if (err?.code === 'UPLOAD_TIMEOUT') return 504;
  if (err instanceof multer.MulterError) return 400;
  if (err?.name === 'ValidationError' || err?.name === 'CastError') return 400;
  return 500;
}

function uploadErrorMessage(err) {
  if (err?.code === 'LIMIT_FILE_SIZE') return `Image is too large. Maximum size is ${formatBytes(MAX_UPLOAD_BYTES)}.`;
  if (err?.code === 'LIMIT_UNEXPECTED_FILE') return 'Only JPG, PNG, WEBP, and GIF images are allowed.';
  if (err?.code === 'UPLOAD_TIMEOUT') return 'Image upload timed out. Please try a smaller image or try again.';
  return err?.message || 'Image upload failed';
}

function sendUploadError(res, err, context) {
  const status = uploadErrorStatus(err);
  const message = uploadErrorMessage(err);
  console.error(`[upload] ${context} failed`, {
    status,
    code: err?.code,
    message: err?.message || err
  });
  if (!res.headersSent) {
    return res.status(status).json({ message });
  }
}

function runUploadMiddleware(req, res, middleware, context) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      const err = new Error(`${context} request parsing timed out`);
      err.code = 'UPLOAD_TIMEOUT';
      reject(err);
    }, UPLOAD_TIMEOUT_MS);

    middleware(req, res, err => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (err) return reject(err);
      resolve();
    });
  });
}

function uploadBufferToCloudinary(file, context) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let stream;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      const err = new Error(`${context} Cloudinary upload timed out`);
      err.code = 'UPLOAD_TIMEOUT';
      if (stream?.destroy) stream.destroy(err);
      reject(err);
    }, UPLOAD_TIMEOUT_MS);

    stream = cloudinary.uploader.upload_stream({
      folder: CLOUDINARY_UPLOAD_FOLDER,
      resource_type: 'image',
      public_id: uploadPublicId(file),
      timeout: UPLOAD_TIMEOUT_MS
    }, (err, response) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (err) return reject(err);
      if (!response?.secure_url) return reject(new Error('Cloudinary did not return a secure URL'));
      if (process.env.NODE_ENV !== 'production') {
        console.log(`[upload] ${context} Cloudinary response`, {
          public_id: response.public_id,
          secure_url: response.secure_url,
          bytes: response.bytes,
          format: response.format
        });
      }
      resolve(response);
    });

    Readable.from(file.buffer).pipe(stream);
  });
}

async function connectDB() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/kro_pk_store', {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
    maxPoolSize: 10
  });
}

const defaultProducts = [
  {
    slug: 'ipk-starboy-polo',
    name: 'IPK STARBOY POLO',
    description: 'Black motorsport polo. Over Drive shoulders. Starboy chest hit. Racing stripes.',
    price: 25000,
    image: 'ipk-polo-front.png',
    tag: 'HOT!',
    sortOrder: 10,
    sizes: { S: 5, M: 5, L: 5, XL: 5, 'ONE SIZE': 0 },
    active: true
  },
  {
    slug: 'pk-thermal',
    name: 'PK THERMAL',
    description: 'Long sleeve thermal. Waffle texture. Sleeve graphics. Layer essential.',
    price: 20000,
    image: 'pk-thermal.jpg',
    tag: 'NEW',
    sortOrder: 20,
    sizes: { S: 3, M: 3, L: 3, XL: 2, 'ONE SIZE': 0 },
    active: true
  },
  {
    slug: 'jorts',
    name: 'KRO PK JORTS',
    description: 'Joggers material jorts. Knee length. Heavy weight. Racing patch. Summer essential.',
    price: 17000,
    image: 'jorts-front.png',
    tag: 'NEW',
    sortOrder: 30,
    sizes: { S: 4, M: 4, L: 4, XL: 2, 'ONE SIZE': 0 },
    active: true
  },
  {
    slug: 'beanie',
    name: 'KRO PK BEANIE',
    description: 'Cuffed beanie. Embroidered logo. Winter essential. Keep rocking.',
    price: 10000,
    image: 'beanie-front.png',
    tag: '',
    sortOrder: 40,
    sizes: { S: 0, M: 0, L: 0, XL: 0, 'ONE SIZE': 8 },
    active: true
  },
  {
    slug: 'graphic-tee',
    name: 'KRO PK GRAPHIC TEE',
    description: 'Heavyweight cotton. Motorsport graphic print. Box fit. Everyday essential.',
    price: 12000,
    image: 'graphic-tee.png',
    tag: 'NEW',
    sortOrder: 50,
    sizes: { S: 5, M: 5, L: 5, XL: 5, 'ONE SIZE': 0 },
    active: true
  },
  {
    slug: 'kro-tee',
    name: 'KRO PK TEE',
    description: 'Core logo tee. Heavy cotton. Box fit. Essential.',
    price: 10000,
    image: '',
    tag: '',
    sortOrder: 60,
    sizes: { S: 5, M: 5, L: 5, XL: 5, 'ONE SIZE': 0 },
    active: true
  }
];

async function seedProducts() {
  const count = await Product.countDocuments();
  if (count === 0) {
    await Product.insertMany(defaultProducts);
    console.log('Seeded default products');
  }
}

async function normalizeProductSortOrder() {
  const products = await Product.find().sort(productSort).select('_id sortOrder').lean();
  const missing = products.filter(product => typeof product.sortOrder !== 'number');
  if (!missing.length) return;
  await Promise.all(missing.map((product, index) =>
    Product.updateOne({ _id: product._id }, { $set: { sortOrder: (index + 1) * 10 } })
  ));
  console.log(`Normalized sortOrder for ${missing.length} products`);
}

async function getNextOrderSequence() {
  const result = await Counter.findOneAndUpdate(
    { name: 'order' },
    { $inc: { seq: 1 } },
    { upsert: true, new: true }
  );
  return result.seq;
}

function buildOrderNumber(seq) {
  const year = new Date().getFullYear();
  return `KRO-${year}-${String(seq).padStart(4, '0')}`;
}

/** Resend `from` with friendly name so clients show "KRO PK" instead of the mailbox only. */
function resendFrom() {
  const raw = (process.env.EMAIL_FROM || 'orders@kro-pk.shop').trim();
  if (/<[^<\s]+@[^>\s]+>/.test(raw)) return raw;
  if (/^[^\s<>]+@[^\s<>]+$/.test(raw)) return `KRO PK <${raw}>`;
  return raw;
}

const EMAIL_NAVY = '#0f172a';
const EMAIL_PANEL = '#1e293b';
const EMAIL_WHITE = '#f8fafc';
const EMAIL_MUTED = '#cbd5e1';
const EMAIL_RED = '#ef4444';
const EMAIL_YELLOW = '#fbbf24';
const EMAIL_BORDER = '#334155';
const EMAIL_INSTAGRAM_URL = 'https://www.instagram.com/kro_pk1';
const EMAIL_TIKTOK_URL = 'https://www.tiktok.com/@kro_pk';
const EMAIL_HEADING_FONT = "'Arial Black', Impact, Arial, sans-serif";
const EMAIL_BODY_FONT = 'Arial, Helvetica, sans-serif';

function formatNgn(amount) {
  return `₦${Number(amount || 0).toLocaleString('en-NG')}`;
}

/** Inline + bgcolor pair to resist client dark/light mode color inversion. */
function emailBgStyle(bg) {
  return `background-color:${bg} !important;`;
}

function emailRacingStripeCellsHtml() {
  return Array.from({ length: 30 }, (_, i) => {
    const bg = i % 2 === 0 ? EMAIL_RED : EMAIL_YELLOW;
    return `<td bgcolor="${bg}" style="width:20px;height:10px;${emailBgStyle(bg)}font-size:0;line-height:0;padding:0;border:0;mso-line-height-rule:exactly;">&nbsp;</td>`;
  }).join('');
}

function emailHeaderHtml() {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="${EMAIL_NAVY}" style="max-width:600px;width:100%;margin:0 auto;border-collapse:collapse;${emailBgStyle(EMAIL_NAVY)}">
  <tr bgcolor="${EMAIL_NAVY}" style="${emailBgStyle(EMAIL_NAVY)}">
    <td align="center" bgcolor="${EMAIL_NAVY}" style="${emailBgStyle(EMAIL_NAVY)}padding:48px 24px 40px;text-align:center;border-bottom:3px solid ${EMAIL_WHITE};">
      <div bgcolor="${EMAIL_NAVY}" style="${emailBgStyle(EMAIL_NAVY)}">
        <p bgcolor="${EMAIL_NAVY}" style="margin:0 0 12px;${emailBgStyle(EMAIL_NAVY)}font-family:${EMAIL_HEADING_FONT};font-size:52px;font-weight:900;line-height:1;color:${EMAIL_WHITE} !important;letter-spacing:0.08em;text-shadow:4px 4px 0 ${EMAIL_RED};">KRO PK</p>
        <p bgcolor="${EMAIL_NAVY}" style="margin:0;${emailBgStyle(EMAIL_NAVY)}font-family:${EMAIL_BODY_FONT};font-size:13px;font-weight:700;color:${EMAIL_YELLOW} !important;letter-spacing:0.28em;text-transform:uppercase;">DROP 2026 &mdash; MOTORSPORT</p>
      </div>
    </td>
  </tr>
  <tr bgcolor="${EMAIL_NAVY}" style="${emailBgStyle(EMAIL_NAVY)}">
    <td bgcolor="${EMAIL_NAVY}" style="${emailBgStyle(EMAIL_NAVY)}padding:0;line-height:0;font-size:0;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="${EMAIL_NAVY}" style="width:100%;border-collapse:collapse;${emailBgStyle(EMAIL_NAVY)}">
        <tr bgcolor="${EMAIL_NAVY}" style="${emailBgStyle(EMAIL_NAVY)}">${emailRacingStripeCellsHtml()}</tr>
      </table>
    </td>
  </tr>
</table>`;
}

function emailFooterHtml() {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="${EMAIL_NAVY}" style="max-width:600px;width:100%;margin:0 auto;border-collapse:collapse;${emailBgStyle(EMAIL_NAVY)}">
  <tr bgcolor="${EMAIL_NAVY}" style="${emailBgStyle(EMAIL_NAVY)}">
    <td bgcolor="${EMAIL_NAVY}" style="${emailBgStyle(EMAIL_NAVY)}padding:28px 20px;text-align:center;border-top:3px solid ${EMAIL_WHITE};">
      <p bgcolor="${EMAIL_NAVY}" style="margin:0 0 12px;${emailBgStyle(EMAIL_NAVY)}font-family:${EMAIL_HEADING_FONT};font-size:28px;font-weight:900;color:${EMAIL_WHITE} !important;letter-spacing:0.08em;">KRO PK</p>
      <p bgcolor="${EMAIL_NAVY}" style="margin:0 0 16px;${emailBgStyle(EMAIL_NAVY)}font-family:${EMAIL_BODY_FONT};font-size:14px;line-height:1.5;color:${EMAIL_WHITE} !important;">
        <a href="${EMAIL_INSTAGRAM_URL}" bgcolor="${EMAIL_NAVY}" style="${emailBgStyle(EMAIL_NAVY)}color:${EMAIL_YELLOW} !important;text-decoration:none;font-weight:bold;">Instagram</a>
        <span bgcolor="${EMAIL_NAVY}" style="${emailBgStyle(EMAIL_NAVY)}color:${EMAIL_WHITE} !important;margin:0 10px;">|</span>
        <a href="${EMAIL_TIKTOK_URL}" bgcolor="${EMAIL_NAVY}" style="${emailBgStyle(EMAIL_NAVY)}color:${EMAIL_YELLOW} !important;text-decoration:none;font-weight:bold;">TikTok</a>
      </p>
      <p bgcolor="${EMAIL_NAVY}" style="margin:0;${emailBgStyle(EMAIL_NAVY)}font-family:${EMAIL_BODY_FONT};font-size:12px;color:${EMAIL_MUTED} !important;">Keep Rocking © 2026 KRO PK</p>
    </td>
  </tr>
</table>`;
}

function emailButtonHtml(label, href) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" bgcolor="${EMAIL_NAVY}" style="margin:24px auto;border-collapse:collapse;${emailBgStyle(EMAIL_NAVY)}">
  <tr bgcolor="${EMAIL_NAVY}" style="${emailBgStyle(EMAIL_NAVY)}">
    <td align="center" bgcolor="${EMAIL_RED}" style="${emailBgStyle(EMAIL_RED)}border:3px solid ${EMAIL_WHITE};">
      <a href="${escapeHtml(href)}" bgcolor="${EMAIL_RED}" style="display:inline-block;${emailBgStyle(EMAIL_RED)}padding:14px 28px;font-family:${EMAIL_HEADING_FONT};font-size:16px;font-weight:900;color:${EMAIL_WHITE} !important;text-decoration:none;letter-spacing:0.05em;">${escapeHtml(label)}</a>
    </td>
  </tr>
</table>`;
}

function emailPanelHtml(innerHtml) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="${EMAIL_NAVY}" style="width:100%;max-width:568px;margin:0 auto 16px;border-collapse:collapse;${emailBgStyle(EMAIL_NAVY)}">
  <tr bgcolor="${EMAIL_NAVY}" style="${emailBgStyle(EMAIL_NAVY)}">
    <td bgcolor="${EMAIL_PANEL}" style="${emailBgStyle(EMAIL_PANEL)}border:4px solid ${EMAIL_WHITE};padding:20px;color:${EMAIL_WHITE} !important;">
      <div bgcolor="${EMAIL_PANEL}" style="${emailBgStyle(EMAIL_PANEL)}color:${EMAIL_WHITE} !important;">${innerHtml}</div>
    </td>
  </tr>
</table>`;
}

function emailHeadingHtml(text, color = EMAIL_WHITE) {
  return `<h1 bgcolor="${EMAIL_PANEL}" style="margin:0 0 12px;${emailBgStyle(EMAIL_PANEL)}font-family:${EMAIL_HEADING_FONT};font-size:26px;font-weight:900;color:${color} !important;letter-spacing:0.04em;text-transform:uppercase;line-height:1.2;">${escapeHtml(text)}</h1>`;
}

function emailSubheadingHtml(text) {
  return `<h2 bgcolor="${EMAIL_PANEL}" style="margin:0 0 10px;${emailBgStyle(EMAIL_PANEL)}font-family:${EMAIL_HEADING_FONT};font-size:18px;font-weight:900;color:${EMAIL_YELLOW} !important;letter-spacing:0.04em;text-transform:uppercase;">${escapeHtml(text)}</h2>`;
}

function emailParagraphHtml(text) {
  return `<p bgcolor="${EMAIL_PANEL}" style="margin:0 0 12px;${emailBgStyle(EMAIL_PANEL)}font-family:${EMAIL_BODY_FONT};font-size:15px;line-height:1.6;color:${EMAIL_WHITE} !important;">${text}</p>`;
}

function emailLabelValueHtml(label, value) {
  return `<p bgcolor="${EMAIL_PANEL}" style="margin:0 0 8px;${emailBgStyle(EMAIL_PANEL)}font-family:${EMAIL_BODY_FONT};font-size:14px;line-height:1.5;color:${EMAIL_WHITE} !important;"><strong bgcolor="${EMAIL_PANEL}" style="${emailBgStyle(EMAIL_PANEL)}color:${EMAIL_YELLOW} !important;">${escapeHtml(label)}:</strong> <span bgcolor="${EMAIL_PANEL}" style="${emailBgStyle(EMAIL_PANEL)}color:${EMAIL_WHITE} !important;">${escapeHtml(value)}</span></p>`;
}

function wrapBrandedEmail(mainContentHtml) {
  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light">
<title>KRO PK</title>
<style type="text/css">
  :root { color-scheme: light only; supported-color-schemes: light; }
  body, table, td, tr, div, p, h1, h2, h3, a, span, strong {
    color-scheme: light only;
  }
  @media (prefers-color-scheme: dark) {
    body, table, td, tr, div, p, h1, h2, h3, a, span, strong {
      background-color: ${EMAIL_NAVY} !important;
      color: ${EMAIL_WHITE} !important;
    }
  }
</style>
</head>
<body bgcolor="${EMAIL_NAVY}" style="margin:0;padding:0;${emailBgStyle(EMAIL_NAVY)}color:${EMAIL_WHITE} !important;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="${EMAIL_NAVY}" style="border-collapse:collapse;${emailBgStyle(EMAIL_NAVY)}">
<tr bgcolor="${EMAIL_NAVY}" style="${emailBgStyle(EMAIL_NAVY)}"><td align="center" bgcolor="${EMAIL_NAVY}" style="${emailBgStyle(EMAIL_NAVY)}padding:0;color:${EMAIL_WHITE} !important;">
<div bgcolor="${EMAIL_NAVY}" style="${emailBgStyle(EMAIL_NAVY)}color:${EMAIL_WHITE} !important;">
${emailHeaderHtml()}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="${EMAIL_NAVY}" style="max-width:600px;width:100%;margin:0 auto;border-collapse:collapse;${emailBgStyle(EMAIL_NAVY)}">
<tr bgcolor="${EMAIL_NAVY}" style="${emailBgStyle(EMAIL_NAVY)}"><td bgcolor="${EMAIL_NAVY}" style="${emailBgStyle(EMAIL_NAVY)}padding:24px 16px 8px;color:${EMAIL_WHITE} !important;">
<div bgcolor="${EMAIL_NAVY}" style="${emailBgStyle(EMAIL_NAVY)}color:${EMAIL_WHITE} !important;">
${mainContentHtml}
</div>
</td></tr></table>
${emailFooterHtml()}
</div>
</td></tr></table>
</body></html>`;
}

function renderOrderItemCardsHtml(items) {
  return items.map(item => {
    const lineTotal = Number(item.price || 0) * Number(item.qty || 0);
    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="${EMAIL_PANEL}" style="width:100%;margin:0 0 12px;border-collapse:collapse;${emailBgStyle(EMAIL_PANEL)}">
  <tr bgcolor="${EMAIL_PANEL}" style="${emailBgStyle(EMAIL_PANEL)}">
    <td bgcolor="${EMAIL_NAVY}" style="${emailBgStyle(EMAIL_NAVY)}border:3px solid ${EMAIL_BORDER};padding:14px 16px;color:${EMAIL_WHITE} !important;">
      <p bgcolor="${EMAIL_NAVY}" style="margin:0 0 6px;${emailBgStyle(EMAIL_NAVY)}font-family:${EMAIL_HEADING_FONT};font-size:16px;font-weight:900;color:${EMAIL_YELLOW} !important;letter-spacing:0.03em;">${escapeHtml(item.name)}</p>
      <p bgcolor="${EMAIL_NAVY}" style="margin:0;${emailBgStyle(EMAIL_NAVY)}font-family:${EMAIL_BODY_FONT};font-size:14px;color:${EMAIL_WHITE} !important;">Size: <span bgcolor="${EMAIL_NAVY}" style="${emailBgStyle(EMAIL_NAVY)}color:${EMAIL_YELLOW} !important;font-weight:bold;">${escapeHtml(item.size)}</span> &nbsp;·&nbsp; Qty: <span bgcolor="${EMAIL_NAVY}" style="${emailBgStyle(EMAIL_NAVY)}color:${EMAIL_WHITE} !important;font-weight:bold;">${Number(item.qty)}</span></p>
      <p bgcolor="${EMAIL_NAVY}" style="margin:10px 0 0;${emailBgStyle(EMAIL_NAVY)}font-family:${EMAIL_HEADING_FONT};font-size:15px;font-weight:900;color:${EMAIL_WHITE} !important;">${formatNgn(lineTotal)}</p>
    </td>
  </tr>
</table>`;
  }).join('');
}

function renderOrderTotalsHtml(order) {
  const delivery = Number(order.deliveryCost ?? 0);
  return `${emailLabelValueHtml('Delivery fee', formatNgn(delivery))}
<p bgcolor="${EMAIL_PANEL}" style="margin:16px 0 0;padding-top:12px;border-top:2px solid ${EMAIL_BORDER};${emailBgStyle(EMAIL_PANEL)}font-family:${EMAIL_HEADING_FONT};font-size:20px;font-weight:900;color:${EMAIL_YELLOW} !important;">TOTAL: <span bgcolor="${EMAIL_PANEL}" style="${emailBgStyle(EMAIL_PANEL)}color:${EMAIL_YELLOW} !important;">${formatNgn(order.total)}</span></p>`;
}

function createOrderEmail(order) {
  const itemsHtml = renderOrderItemCardsHtml(order.items);
  const body = wrapBrandedEmail(`
${emailPanelHtml(`
${emailHeadingHtml('New order received', EMAIL_RED)}
${emailParagraphHtml('A new order just landed. Review the details below and process it from admin.')}
`)}
${emailPanelHtml(`
${emailSubheadingHtml('Order')}
${emailLabelValueHtml('Order number', order.orderNumber)}
${emailLabelValueHtml('Status', order.status || 'pending')}
${emailLabelValueHtml('Paystack ref', order.paystackReference || 'N/A')}
`)}
${emailPanelHtml(`
${emailSubheadingHtml('Customer')}
${emailLabelValueHtml('Name', order.customer.name)}
${emailLabelValueHtml('Phone', order.customer.phone)}
${emailLabelValueHtml('Email', order.customer.email || 'Not provided')}
${emailLabelValueHtml('Address', `${order.customer.address}, ${order.customer.city}, ${order.customer.state}`)}
`)}
${emailPanelHtml(`
${emailSubheadingHtml('Items')}
${itemsHtml}
${renderOrderTotalsHtml(order)}
`)}
${emailButtonHtml('VIEW IN ADMIN', `${SITE_URL}/admin`)}
`);

  return {
    from: resendFrom(),
    to: OWNER_EMAIL,
    subject: `🔥 NEW ORDER — ${order.orderNumber}`,
    headers: {
      'X-Priority': '1',
      'X-MSMail-Priority': 'High',
      'Importance': 'high'
    },
    html: body
  };
}

function createCustomerConfirmationEmail(order) {
  const crewBadge = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="${EMAIL_PANEL}" style="width:100%;margin:0 0 16px;border-collapse:collapse;${emailBgStyle(EMAIL_PANEL)}">
  <tr bgcolor="${EMAIL_PANEL}" style="${emailBgStyle(EMAIL_PANEL)}">
    <td align="center" bgcolor="${EMAIL_NAVY}" style="${emailBgStyle(EMAIL_NAVY)}border:4px solid ${EMAIL_YELLOW};padding:18px 16px;text-align:center;color:${EMAIL_WHITE} !important;">
      <p bgcolor="${EMAIL_NAVY}" style="margin:0 0 6px;${emailBgStyle(EMAIL_NAVY)}font-family:${EMAIL_HEADING_FONT};font-size:14px;font-weight:900;color:${EMAIL_YELLOW} !important;letter-spacing:0.12em;">KRO PK CREW MEMBER</p>
      <p bgcolor="${EMAIL_NAVY}" style="margin:0 0 4px;${emailBgStyle(EMAIL_NAVY)}font-family:${EMAIL_BODY_FONT};font-size:12px;color:${EMAIL_MUTED} !important;text-transform:uppercase;letter-spacing:0.08em;">Crew ID</p>
      <p bgcolor="${EMAIL_NAVY}" style="margin:0;${emailBgStyle(EMAIL_NAVY)}font-family:${EMAIL_HEADING_FONT};font-size:22px;font-weight:900;color:${EMAIL_WHITE} !important;letter-spacing:0.06em;">${escapeHtml(order.orderNumber)}</p>
    </td>
  </tr>
</table>`;

  const body = wrapBrandedEmail(`
${emailPanelHtml(`
${emailHeadingHtml('Order confirmed')}
${crewBadge}
${emailParagraphHtml(`Thanks for rocking with KRO PK, <strong bgcolor="${EMAIL_PANEL}" style="${emailBgStyle(EMAIL_PANEL)}color:${EMAIL_YELLOW} !important;">${escapeHtml(order.customer.name)}</strong>. Your payment is in and we are getting your drop ready.`)}
${emailLabelValueHtml('Payment reference', order.paystackReference || 'N/A')}
`)}
${emailPanelHtml(`
${emailSubheadingHtml('Delivery')}
${emailLabelValueHtml('Address', `${order.customer.address}, ${order.customer.city}, ${order.customer.state}`)}
${emailLabelValueHtml('Phone', order.customer.phone)}
`)}
${emailPanelHtml(`
${emailSubheadingHtml('Your picks')}
${renderOrderItemCardsHtml(order.items)}
${renderOrderTotalsHtml(order)}
`)}
${emailButtonHtml('VIEW YOUR ORDER', SITE_URL)}
`);

  return {
    from: resendFrom(),
    to: order.customer.email,
    subject: `Your KRO PK order ${order.orderNumber}`,
    html: body
  };
}

function createCustomerShippedEmail(order) {
  const body = wrapBrandedEmail(`
${emailPanelHtml(`
${emailHeadingHtml('YOUR ORDER IS ON THE WAY', EMAIL_YELLOW)}
${emailParagraphHtml(`Order <strong bgcolor="${EMAIL_PANEL}" style="${emailBgStyle(EMAIL_PANEL)}color:${EMAIL_YELLOW} !important;">${escapeHtml(order.orderNumber)}</strong> has left the garage and is headed your way.`)}
${emailParagraphHtml(`Expect delivery within <strong bgcolor="${EMAIL_PANEL}" style="${emailBgStyle(EMAIL_PANEL)}color:${EMAIL_WHITE} !important;">3–5 working days</strong>. We will reach out if we need anything else.`)}
`)}
${emailButtonHtml('TRACK YOUR ORDER', SITE_URL)}
`);

  return {
    from: resendFrom(),
    to: order.customer.email,
    subject: `Your KRO PK order ${order.orderNumber} is on the way`,
    html: body
  };
}

function createCustomerDeliveredEmail(order) {
  const body = wrapBrandedEmail(`
${emailPanelHtml(`
${emailHeadingHtml('ORDER DELIVERED', EMAIL_YELLOW)}
${emailParagraphHtml(`Your order <strong bgcolor="${EMAIL_PANEL}" style="${emailBgStyle(EMAIL_PANEL)}color:${EMAIL_YELLOW} !important;">${escapeHtml(order.orderNumber)}</strong> has been delivered. Thanks for repping KRO PK.`)}
${emailParagraphHtml('If you loved the drop, tell a friend. The shop is always open for the next cop.')}
`)}
${emailButtonHtml('SHOP AGAIN', `${SITE_URL}/shop1.html`)}
`);

  return {
    from: resendFrom(),
    to: order.customer.email,
    subject: `Delivered: KRO PK order ${order.orderNumber}`,
    html: body
  };
}

function createBroadcastEmail(subject, messageBody) {
  const safeBody = escapeHtml(messageBody).replace(/\n/g, '<br>');
  return wrapBrandedEmail(`
${emailPanelHtml(`
${emailHeadingHtml(subject, EMAIL_YELLOW)}
<div bgcolor="${EMAIL_PANEL}" style="${emailBgStyle(EMAIL_PANEL)}font-family:${EMAIL_BODY_FONT};font-size:15px;line-height:1.7;color:${EMAIL_WHITE} !important;">${safeBody}</div>
`)}
${emailButtonHtml('SHOP NOW', `${SITE_URL}/shop1.html`)}
`);
}

function createAbandonedCartEmail(profile) {
  const name = profile.customer?.name?.trim() || 'there';
  const itemsHtml = (profile.cartItems || []).map(item => {
    const lineTotal = Number(item.price || 0) * Number(item.qty || 0);
    return `<p bgcolor="${EMAIL_PANEL}" style="margin:0 0 10px;${emailBgStyle(EMAIL_PANEL)}font-family:${EMAIL_BODY_FONT};font-size:14px;color:${EMAIL_WHITE} !important;">
      <strong bgcolor="${EMAIL_PANEL}" style="${emailBgStyle(EMAIL_PANEL)}color:${EMAIL_YELLOW} !important;">${escapeHtml(item.name || item.id)}</strong>
      <span bgcolor="${EMAIL_PANEL}" style="${emailBgStyle(EMAIL_PANEL)}color:${EMAIL_WHITE} !important;"> — ${escapeHtml(item.size || '—')} × ${Number(item.qty || 0)} = ${formatNgn(lineTotal)}</span>
    </p>`;
  }).join('');

  const body = wrapBrandedEmail(`
${emailPanelHtml(`
${emailHeadingHtml('Still in your cart', EMAIL_YELLOW)}
${emailParagraphHtml(`Hey <strong bgcolor="${EMAIL_PANEL}" style="${emailBgStyle(EMAIL_PANEL)}color:${EMAIL_YELLOW} !important;">${escapeHtml(name)}</strong>, you left heat in your cart. Finish checkout before it sells out.`)}
${itemsHtml || emailParagraphHtml('Your picks are waiting at checkout.')}
`)}
${emailButtonHtml('COMPLETE YOUR ORDER', `${SITE_URL}/cart.html`)}
`);

  return {
    from: resendFrom(),
    to: profile.customer.email,
    subject: 'Your KRO PK cart is waiting',
    html: body
  };
}

async function processAbandonedCartReminders() {
  if (!process.env.RESEND_API_KEY) return;

  const cutoff = new Date(Date.now() - ABANDONED_CART_HOURS * 60 * 60 * 1000);
  const profiles = await ShopperProfile.find({
    'cartItems.0': { $exists: true },
    cartUpdatedAt: { $lte: cutoff },
    abandonedCartReminderSentAt: null,
    'customer.email': { $exists: true, $nin: [null, ''] },
    $or: [
      { checkedOutAt: null },
      { $expr: { $lt: ['$checkedOutAt', '$cartUpdatedAt'] } }
    ]
  }).limit(40).lean();

  for (const profile of profiles) {
    const email = String(profile.customer?.email || '').trim().toLowerCase();
    if (!email) continue;

    try {
      await resend.emails.send(createAbandonedCartEmail({ ...profile, customer: { ...profile.customer, email } }));
      await ShopperProfile.updateOne(
        { _id: profile._id },
        { $set: { abandonedCartReminderSentAt: new Date() } }
      );
    } catch (err) {
      console.error('Abandoned cart reminder failed:', email, err.message || err);
    }
  }
}

function authMiddleware(req, res, next) {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ message: 'Authentication required' });

  try {
    req.admin = jwt.verify(token, JWT_SECRET);
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Invalid authentication token' });
  }
}

app.post('/api/admin/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required' });
  }
  if (email !== ADMIN_EMAIL || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ message: 'Invalid admin credentials' });
  }

  const token = jwt.sign({ email }, JWT_SECRET, { expiresIn: '7d' });
  res.cookie('token', token, {
    httpOnly: true,
    sameSite: 'strict',
    maxAge: 7 * 24 * 60 * 60 * 1000
  });
  res.json({ message: 'Login successful' });
});

app.post('/api/admin/logout', authMiddleware, (req, res) => {
  res.clearCookie('token');
  res.json({ message: 'Logged out' });
});

app.get('/api/products/all', authMiddleware, async (req, res) => {
  const products = await Product.find().sort(productSort).lean();
  res.set('Cache-Control', 'no-store');
  res.json(products);
});

app.get('/api/products', async (req, res) => {
  const products = await Product.find({ active: true }).sort(productSort).lean();
  res.set('Cache-Control', 'no-store');
  res.json(products);
});

app.get('/api/products/:slug', async (req, res) => {
  let slug;
  try {
    slug = decodeURIComponent(req.params.slug);
  } catch {
    return res.status(400).json({ message: 'Invalid slug' });
  }
  const product = await Product.findOne({ slug }).lean();
  if (!product) return res.status(404).json({ message: 'Product not found' });
  res.set('Cache-Control', 'no-store');
  res.json(product);
});

app.get('/api/config/paystack', (req, res) => {
  const publicKey = process.env.PAYSTACK_PUBLIC_KEY;
  if (!publicKey) {
    return res.status(500).json({ message: 'PAYSTACK_PUBLIC_KEY is not configured' });
  }
  return res.json({ publicKey });
});

app.get('/api/promo/validate', async (req, res) => {
  const code = String(req.query.code || '').trim().toUpperCase();
  if (!code) return res.status(400).json({ message: 'Promo code is required' });
  const promo = await PromoCode.findOne({ code, active: true }).lean();
  if (!promo) return res.status(404).json({ message: 'Invalid promo code' });
  return res.json({ code: promo.code, discountPercent: promo.discountPercent });
});

app.post('/api/subscribe', async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!email) return res.status(400).json({ message: 'Email is required' });

  const existing = await Subscriber.findOne({ email });
  if (existing) {
    if (!existing.active) {
      existing.active = true;
      if (name) existing.name = name;
      await existing.save();
    }
    return res.status(200).json({ message: 'Subscribed', subscriber: { email: existing.email, name: existing.name } });
  }

  const subscriber = await Subscriber.create({ email, name, active: true });
  return res.status(201).json({ message: 'Subscribed', subscriber: { email: subscriber.email, name: subscriber.name } });
});

app.post('/api/analytics/events', async (req, res) => {
  const allowedTypes = ['page_view', 'product_view', 'add_to_cart', 'cart_view', 'cart_update', 'remove_from_cart', 'checkout_click'];
  const type = String(req.body?.type || '').trim();
  const visitorId = String(req.body?.visitorId || '').trim();
  if (!allowedTypes.includes(type) || !visitorId) {
    return res.status(400).json({ message: 'Invalid analytics event' });
  }

  const event = await AnalyticsEvent.create({
    type,
    visitorId,
    sessionId: String(req.body?.sessionId || '').trim(),
    path: String(req.body?.path || '').trim(),
    productSlug: String(req.body?.productSlug || '').trim(),
    productName: String(req.body?.productName || '').trim(),
    quantity: Number(req.body?.quantity || 0),
    cartCount: Number(req.body?.cartCount || 0),
    metadata: req.body?.metadata && typeof req.body.metadata === 'object' ? req.body.metadata : {}
  });

  const source = String(req.body?.source || '').trim().toLowerCase() || 'direct';
  await ShopperProfile.findOneAndUpdate(
    { visitorId },
    {
      $set: {
        sessionId: String(req.body?.sessionId || '').trim(),
        source,
        lastActivityAt: new Date()
      },
      $setOnInsert: { visitorId }
    },
    { upsert: true }
  );
  if (type === 'page_view') {
    await Visit.create({
      visitorId,
      sessionId: String(req.body?.sessionId || '').trim(),
      source,
      path: String(req.body?.path || '').trim()
    });
  }

  res.status(202).json({ accepted: true, id: event._id });
});

app.post('/api/analytics/profile', async (req, res) => {
  const visitorId = String(req.body?.visitorId || '').trim();
  if (!visitorId) return res.status(400).json({ message: 'visitorId is required' });
  const cartItems = Array.isArray(req.body?.cartItems)
    ? req.body.cartItems.map(item => ({
        id: String(item.id || '').trim(),
        name: String(item.name || '').trim(),
        size: String(item.size || '').trim(),
        qty: Number(item.qty || 0),
        price: Number(item.price || 0),
        img: String(item.img || '').trim()
      })).filter(item => item.id && item.qty > 0)
    : undefined;
  const update = {
    sessionId: String(req.body?.sessionId || '').trim(),
    source: String(req.body?.source || '').trim().toLowerCase() || 'direct',
    lastActivityAt: new Date()
  };
  if (req.body?.customer && typeof req.body.customer === 'object') {
    update.customer = {
      name: String(req.body.customer.name || '').trim(),
      phone: String(req.body.customer.phone || '').trim(),
      email: String(req.body.customer.email || '').trim().toLowerCase()
    };
  }
  if (cartItems) {
    update.cartItems = cartItems;
    update.cartUpdatedAt = new Date();
    update.abandonedCartReminderSentAt = null;
  }
  if (req.body?.checkedOut === true) {
    update.checkedOutAt = new Date();
  }
  const profile = await ShopperProfile.findOneAndUpdate(
    { visitorId },
    { $set: update, $setOnInsert: { visitorId } },
    { upsert: true, new: true }
  ).lean();
  res.status(202).json({ accepted: true, profileId: profile._id });
});

app.post('/api/orders', async (req, res) => {
  const { customer, items, paystackReference, promoCode, visitorId, sessionId } = req.body;
  if (!customer || !items || !Array.isArray(items) || !items.length || !paystackReference) {
    return res.status(400).json({ message: 'Customer, items and paystackReference are required' });
  }

  const missingFields = ['name', 'phone', 'email', 'address', 'city', 'state'].filter(f => !customer[f]?.toString().trim());
  if (missingFields.length) {
    return res.status(400).json({ message: 'All customer fields are required' });
  }

  const preparedItems = [];
  const stockErrors = [];
  const productsToUpdate = [];
  const lowStockItems = [];
  let total = 0;

  for (const item of items) {
    if (!item.slug || !item.size || !item.qty || !item.price) {
      return res.status(400).json({ message: 'Each item needs slug, size, qty, and price' });
    }

    const product = await Product.findOne({ slug: item.slug });
    if (!product || !product.active) {
      stockErrors.push({ slug: item.slug, message: 'Product unavailable' });
      continue;
    }

    const stockKey = item.size;
    const available = product.sizes?.get(stockKey) ?? 0;
    if (available < item.qty) {
      stockErrors.push({ slug: item.slug, size: stockKey, available });
      continue;
    }

    const itemTotal = item.qty * product.price;
    preparedItems.push({ slug: product.slug, name: product.name, size: stockKey, qty: item.qty, price: product.price, image: product.image });
    total += itemTotal;
    productsToUpdate.push({ product, size: stockKey, qty: item.qty });
  }

  if (stockErrors.length) {
    return res.status(409).json({ message: 'Stock validation failed', errors: stockErrors });
  }

  let discountPercent = 0;
  let appliedPromoCode = '';
  const promo = String(promoCode || '').trim().toUpperCase();
  if (promo) {
    const promoDoc = await PromoCode.findOne({ code: promo, active: true }).lean();
    if (!promoDoc) {
      return res.status(400).json({ message: 'Invalid promo code' });
    }
    discountPercent = Number(promoDoc.discountPercent) || 0;
    appliedPromoCode = promoDoc.code;
  }

  const totalBeforeDiscount = total;
  const discountedTotal = discountPercent > 0 ? Math.round(total * (1 - discountPercent / 100)) : total;
  const grandTotal = discountedTotal + FLAT_DELIVERY_FEE_NGN;

  const paystackData = await verifyPaystackPayment(paystackReference);
  const expectedAmount = grandTotal * 100;
  if (!paystackData || paystackData.status !== 'success') {
    return res.status(402).json({ message: 'Paystack payment not successful' });
  }
  if (paystackData.amount !== expectedAmount) {
    return res.status(400).json({ message: 'Paystack amount mismatch' });
  }
  if (String(paystackData.currency).toUpperCase() !== 'NGN') {
    return res.status(400).json({ message: 'Paystack payment must be in NGN' });
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    for (const update of productsToUpdate) {
      const pathKey = `sizes.${update.size}`;
      const availableBefore = update.product.sizes?.get(update.size) ?? 0;
      const result = await Product.updateOne(
        { _id: update.product._id, [pathKey]: { $gte: update.qty } },
        { $inc: { [pathKey]: -update.qty } },
        { session }
      );
      if (result.modifiedCount === 0) {
        throw new Error(`Stock unavailable for ${update.product.slug} size ${update.size}`);
      }
      const remaining = availableBefore - update.qty;
      if (remaining <= 2) {
        lowStockItems.push({
          slug: update.product.slug,
          name: update.product.name,
          size: update.size,
          remaining: Math.max(remaining, 0)
        });
      }
    }

    const nextSeq = await getNextOrderSequence();
    const orderNumber = buildOrderNumber(nextSeq);
    const order = await Order.create([{
      orderNumber,
      customer,
      items: preparedItems,
      totalBeforeDiscount: discountPercent > 0 ? totalBeforeDiscount : null,
      promoCode: appliedPromoCode,
      discountPercent,
      deliveryCost: FLAT_DELIVERY_FEE_NGN,
      total: grandTotal,
      paystackReference,
      paymentStatus: paystackData.status,
      visitorId: String(visitorId || '').trim(),
      sessionId: String(sessionId || '').trim()
    }], { session });

    await session.commitTransaction();
    session.endSession();

    if (visitorId) {
      await ShopperProfile.findOneAndUpdate(
        { visitorId: String(visitorId).trim() },
        {
          $set: {
            checkedOutAt: new Date(),
            customer: {
              name: String(customer.name || '').trim(),
              phone: String(customer.phone || '').trim(),
              email: String(customer.email || '').trim().toLowerCase()
            },
            lastActivityAt: new Date()
          }
        }
      );
    }

    const ownerMail = createOrderEmail(order[0]);
    const customerMail = createCustomerConfirmationEmail(order[0]);

    resend.emails.send(ownerMail).catch(err => {
      console.error('Owner email send error:', err.message || err);
    });

    resend.emails.send(customerMail).catch(err => {
      console.error('Customer email send error:', err.message || err);
    });

    if (lowStockItems.length) {
      resend.emails.send(createLowStockEmail(lowStockItems)).catch(err => {
        console.error('Low stock email send error:', err.message || err);
      });
    }

    res.status(201).json({ message: 'Order placed successfully', orderNumber });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    console.error(err);
    return res.status(500).json({ message: 'Unable to process order', error: err.message });
  }
});

async function verifyPaystackPayment(reference) {
  return new Promise((resolve, reject) => {
    const secretKey = process.env.PAYSTACK_SECRET_KEY;
    if (!secretKey) {
      return reject(new Error('PAYSTACK_SECRET_KEY is not configured'));
    }

    const options = {
      hostname: 'api.paystack.co',
      path: `/transaction/verify/${encodeURIComponent(reference)}`,
      method: 'GET',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/json'
      }
    };

    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const payload = JSON.parse(data);
          if (!payload || !payload.status) {
            return reject(new Error(payload?.message || 'Paystack verification failed'));
          }
          resolve(payload.data);
        } catch (err) {
          reject(err);
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

app.get('/api/admin/orders', authMiddleware, async (req, res) => {
  const { status } = req.query;
  const filter = {};
  if (status) filter.status = status;
  const orders = await Order.find(filter).sort({ createdAt: -1 }).lean();
  res.json(orders);
});

app.get('/api/admin/orders/:id', authMiddleware, async (req, res) => {
  const order = await Order.findById(req.params.id).lean();
  if (!order) return res.status(404).json({ message: 'Order not found' });
  res.json(order);
});

app.put('/api/admin/orders/:id/status', authMiddleware, async (req, res) => {
  const { status } = req.body;
  if (!['pending', 'confirmed', 'shipped', 'delivered'].includes(status)) {
    return res.status(400).json({ message: 'Invalid status' });
  }
  const existing = await Order.findById(req.params.id).lean();
  if (!existing) return res.status(404).json({ message: 'Order not found' });

  const order = await Order.findByIdAndUpdate(req.params.id, { status }, { new: true }).lean();
  if (!order) return res.status(404).json({ message: 'Order not found' });

  const prevStatus = existing.status;
  const nextStatus = order.status;
  const customerEmail = order.customer?.email;
  if (customerEmail && prevStatus !== nextStatus) {
    if (nextStatus === 'shipped') {
      resend.emails.send(createCustomerShippedEmail(order)).catch(err => {
        console.error('Customer shipped email send error:', err.message || err);
      });
    }
    if (nextStatus === 'delivered') {
      resend.emails.send(createCustomerDeliveredEmail(order)).catch(err => {
        console.error('Customer delivered email send error:', err.message || err);
      });
    }
  }

  res.json(order);
});

app.delete('/api/admin/orders/all', authMiddleware, async (_req, res) => {
  const result = await Order.deleteMany({});
  res.json({ message: 'All orders deleted', deletedCount: result.deletedCount });
});

app.delete('/api/admin/orders/:id', authMiddleware, async (req, res) => {
  if (req.params.id === 'all') {
    return res.status(400).json({ message: 'Use DELETE /api/admin/orders/all to remove all orders' });
  }
  const deleted = await Order.findByIdAndDelete(req.params.id);
  if (!deleted) return res.status(404).json({ message: 'Order not found' });
  res.json({ message: 'Order deleted' });
});

// ─── ADMIN: PROMO CODES ─────────────────────────────────────────
app.get('/api/admin/promocodes', authMiddleware, async (_req, res) => {
  const codes = await PromoCode.find().sort({ createdAt: -1 }).lean();
  res.json(codes);
});

app.post('/api/admin/promocodes', authMiddleware, async (req, res) => {
  const code = String(req.body?.code || '').trim().toUpperCase();
  const discountPercent = Number(req.body?.discountPercent);
  const active = req.body?.active === false ? false : true;
  if (!code || !discountPercent) return res.status(400).json({ message: 'Code and discountPercent are required' });
  const promo = await PromoCode.create({ code, discountPercent, active });
  res.status(201).json(promo);
});

app.patch('/api/admin/promocodes/:id', authMiddleware, async (req, res) => {
  const update = {};
  if (req.body.code !== undefined) update.code = String(req.body.code || '').trim().toUpperCase();
  if (req.body.discountPercent !== undefined) update.discountPercent = Number(req.body.discountPercent);
  if (typeof req.body.active === 'boolean') update.active = req.body.active;
  const promo = await PromoCode.findByIdAndUpdate(req.params.id, { $set: update }, { new: true }).lean();
  if (!promo) return res.status(404).json({ message: 'Promo code not found' });
  res.json(promo);
});

app.delete('/api/admin/promocodes/:id', authMiddleware, async (req, res) => {
  const result = await PromoCode.findByIdAndDelete(req.params.id);
  if (!result) return res.status(404).json({ message: 'Promo code not found' });
  res.json({ message: 'Deleted' });
});

// ─── ADMIN: BROADCASTS ─────────────────────────────────────────
app.get('/api/admin/broadcasts', authMiddleware, async (_req, res) => {
  const broadcasts = await Broadcast.find().sort({ createdAt: -1 }).lean();
  res.json(broadcasts);
});

app.get('/api/admin/subscribers', authMiddleware, async (_req, res) => {
  const subscribers = await Subscriber.find().sort({ createdAt: -1 }).lean();
  res.json(subscribers);
});

app.post('/api/admin/broadcasts', authMiddleware, async (req, res) => {
  const subject = String(req.body?.subject || '').trim();
  const body = String(req.body?.body || '').trim();
  if (!subject || !body) return res.status(400).json({ message: 'Subject and body are required' });

  const subscribers = await Subscriber.find({ active: true }).lean();
  const recipientCount = subscribers.length;
  const broadcast = await Broadcast.create({ subject, body, recipientCount, sentAt: new Date() });

  await Promise.allSettled(subscribers.map(s => {
    return resend.emails.send({
      from: resendFrom(),
      to: s.email,
      subject,
      html: createBroadcastEmail(subject, body)
    });
  }));

  res.status(201).json({ message: 'Broadcast sent', broadcastId: broadcast._id, recipientCount });
});

// ─── ADMIN: PRODUCT IMAGE UPLOAD ───────────────────────────────
app.post('/api/admin/products/:slug/image', authMiddleware, async (req, res) => {
  const startedAt = Date.now();
  let slug;

  try {
    slug = decodeURIComponent(req.params.slug);
    console.log('[upload] primary image request started', { slug });
    await runUploadMiddleware(req, res, upload.single('image'), `primary image for ${slug}`);

    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });

    const existingProduct = await Product.findOne({ slug }).select('_id slug').lean();
    if (!existingProduct) return res.status(404).json({ message: 'Product not found' });

    const cloudinaryResponse = await uploadBufferToCloudinary(req.file, `primary image for ${slug}`);
    const imagePath = cloudinaryResponse.secure_url;
    const product = await Product.findOneAndUpdate(
      { _id: existingProduct._id },
      { $set: { image: imagePath } },
      { new: true, runValidators: true }
    ).lean();

    console.log('[upload] primary image request completed', {
      slug,
      ms: Date.now() - startedAt,
      image: imagePath
    });
    return res.status(201).json({ message: 'Uploaded', image: imagePath, product });
  } catch (err) {
    return sendUploadError(res, err, `primary image${slug ? ` for ${slug}` : ''}`);
  }
});

app.post('/api/admin/products/:slug/gallery', authMiddleware, async (req, res) => {
  const startedAt = Date.now();
  let slug;

  try {
    slug = decodeURIComponent(req.params.slug);
    console.log('[upload] gallery request started', { slug });
    await runUploadMiddleware(req, res, upload.array('gallery', 4), `gallery for ${slug}`);

    if (!req.files?.length) return res.status(400).json({ message: 'No files uploaded' });

    const existingProduct = await Product.findOne({ slug }).select('_id slug').lean();
    if (!existingProduct) return res.status(404).json({ message: 'Product not found' });

    const cloudinaryResponses = await Promise.all(
      req.files.slice(0, 4).map((file, index) => uploadBufferToCloudinary(file, `gallery ${index + 1} for ${slug}`))
    );
    const paths = cloudinaryResponses.map(response => response.secure_url);
    const product = await Product.findOneAndUpdate(
      { _id: existingProduct._id },
      { $set: { images: paths } },
      { new: true, runValidators: true }
    ).lean();

    console.log('[upload] gallery request completed', {
      slug,
      ms: Date.now() - startedAt,
      count: paths.length
    });
    return res.status(201).json({ message: 'Gallery uploaded', images: paths, product });
  } catch (err) {
    return sendUploadError(res, err, `gallery${slug ? ` for ${slug}` : ''}`);
  }
});

app.patch('/api/admin/products/:slug', authMiddleware, async (req, res) => {
  const slugParam = decodeURIComponent(req.params.slug);
  console.log('[admin] PATCH /api/admin/products/:slug', slugParam, req.body);
  const { sizes, active, name, price, description, tag, image, images, sortOrder } = req.body;
  const update = {};
  if (sizes && typeof sizes === 'object') {
    for (const [key, value] of Object.entries(sizes)) {
      if (['S', 'M', 'L', 'XL', 'ONE SIZE'].includes(key)) {
        update[`sizes.${key}`] = Number(value);
      }
    }
  }
  if (typeof active === 'boolean') {
    update.active = active;
  }
  if (name) update.name = name.trim();
  if (price !== undefined) update.price = Number(price);
  if (description !== undefined) update.description = description.trim();
  if (tag !== undefined) update.tag = tag.trim();
  if (image !== undefined) update.image = image.trim();
  if (Array.isArray(images)) {
    update.images = images.map(s => String(s).trim()).filter(Boolean).slice(0, 4);
  }
  if (sortOrder !== undefined) update.sortOrder = Number(sortOrder);
  console.log('[admin] product update $set', slugParam, update);
  const product = await Product.findOneAndUpdate({ slug: slugParam }, { $set: update }, { new: true, runValidators: true }).lean();
  if (!product) return res.status(404).json({ message: 'Product not found' });
  console.log('[admin] updated product', { slug: product.slug, price: product.price, active: product.active, tag: product.tag });
  res.json(product);
});

app.post('/api/admin/products/:slug/move', authMiddleware, async (req, res) => {
  const slugParam = decodeURIComponent(req.params.slug);
  const direction = String(req.body?.direction || '').toLowerCase();
  if (!['up', 'down'].includes(direction)) {
    return res.status(400).json({ message: 'direction must be up or down' });
  }

  const products = await Product.find().sort(productSort).select('_id slug sortOrder createdAt').lean();
  const currentIndex = products.findIndex(product => product.slug === slugParam);
  if (currentIndex === -1) return res.status(404).json({ message: 'Product not found' });

  const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
  if (targetIndex < 0 || targetIndex >= products.length) {
    return res.json({ message: 'Product already at boundary', products });
  }

  const normalized = products.map((product, index) => ({
    ...product,
    sortOrder: typeof product.sortOrder === 'number' ? product.sortOrder : (index + 1) * 10
  }));
  const current = normalized[currentIndex];
  const target = normalized[targetIndex];
  await Promise.all([
    Product.updateOne({ _id: current._id }, { $set: { sortOrder: target.sortOrder } }),
    Product.updateOne({ _id: target._id }, { $set: { sortOrder: current.sortOrder } })
  ]);

  const updatedProducts = await Product.find().sort(productSort).lean();
  res.json({ message: 'Product reordered', products: updatedProducts });
});

app.delete('/api/admin/products/:slug', authMiddleware, async (req, res) => {
  const slugParam = decodeURIComponent(req.params.slug);
  const result = await Product.deleteOne({ slug: slugParam });
  if (!result.deletedCount) return res.status(404).json({ message: 'Product not found' });
  res.json({ message: 'Product deleted', deletedCount: result.deletedCount, slug: slugParam });
});

app.post('/api/admin/products', authMiddleware, async (req, res) => {
  const { name, slug, description, price, tag, image, images, sizes, active, sortOrder } = req.body;
  if (!name || !price) {
    return res.status(400).json({ message: 'Name and price are required' });
  }
  const normalizedSlug = slug?.toString().trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  let finalSlug = normalizedSlug || `product-${Date.now()}`;
  let idx = 1;
  while (await Product.exists({ slug: finalSlug })) {
    finalSlug = `${normalizedSlug || 'product'}-${idx++}`;
  }

  const defaultSizes = { S: 0, M: 0, L: 0, XL: 0, 'ONE SIZE': 0 };
  const productSizes = { ...defaultSizes, ...(sizes && typeof sizes === 'object' ? sizes : {}) };

  const gallery = Array.isArray(images)
    ? images.map(s => String(s).trim()).filter(Boolean).slice(0, 4)
    : [];

  const newProduct = await Product.create({
    slug: finalSlug,
    name: name.trim(),
    description: description?.trim() || '',
    price: Number(price),
    image: image?.trim() || '',
    images: gallery,
    tag: tag?.trim() || '',
    sortOrder: sortOrder !== undefined ? Number(sortOrder) : Date.now(),
    sizes: productSizes,
    active: active === false ? false : true
  });
  res.status(201).json(newProduct);
});

app.get('/api/admin/stats', authMiddleware, async (req, res) => {
  const totalOrders = await Order.countDocuments();
  const pendingOrders = await Order.countDocuments({ status: 'pending' });
  const revenueData = await Order.aggregate([
    { $group: { _id: null, totalRevenue: { $sum: '$total' } } }
  ]);
  const totalRevenue = revenueData.length ? revenueData[0].totalRevenue : 0;
  res.json({ totalOrders, pendingOrders, totalRevenue });
});

function getAnalyticsRange(range = 'today') {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (range === 'last7') start.setDate(start.getDate() - 6);
  if (range === 'last30') start.setDate(start.getDate() - 29);
  if (range === 'last90') start.setDate(start.getDate() - 89);
  if (range === 'thisMonth') start.setDate(1);
  if (range === 'all') return { key: 'all', label: 'All time', start: null, end: now };
  const labels = {
    today: 'Today',
    last7: 'Last 7 days',
    last30: 'Last 30 days',
    last90: 'Last 90 days',
    thisMonth: 'This month'
  };
  return { key: range, label: labels[range] || 'Today', start, end: now };
}

async function buildAnalyticsReport(rangeKey = 'today') {
  const range = getAnalyticsRange(rangeKey);
  const inRange = range.start ? { createdAt: { $gte: range.start, $lte: range.end } } : {};
  const abandonmentCutoff = new Date(Date.now() - 30 * 60 * 1000);
  const [
    todaysVisits,
    uniqueVisitors,
    totalCarts,
    checkoutClicksToday,
    ordersToday,
    revenueToday,
    productViewsCount,
    addToCartCount,
    productEventRows,
    salesRows,
    customerRows,
    abandonedRows,
    trafficRows
  ] = await Promise.all([
    Visit.countDocuments(inRange),
    Visit.distinct('visitorId', inRange).then(ids => ids.length),
    ShopperProfile.countDocuments({ cartItems: { $exists: true, $ne: [] }, ...(range.start ? { cartUpdatedAt: { $gte: range.start, $lte: range.end } } : {}) }),
    AnalyticsEvent.countDocuments({ type: 'checkout_click', ...inRange }),
    Order.countDocuments(inRange),
    Order.aggregate([
      { $match: inRange },
      { $group: { _id: null, totalRevenue: { $sum: '$total' } } }
    ]),
    AnalyticsEvent.countDocuments({ type: 'product_view', ...inRange }),
    AnalyticsEvent.countDocuments({ type: 'add_to_cart', ...inRange }),
    AnalyticsEvent.aggregate([
        { $match: { type: { $in: ['product_view', 'add_to_cart'] }, productSlug: { $ne: '' }, ...inRange } },
      {
        $group: {
          _id: '$productSlug',
          productName: { $last: '$productName' },
          productViews: { $sum: { $cond: [{ $eq: ['$type', 'product_view'] }, 1, 0] } },
          addToCarts: { $sum: { $cond: [{ $eq: ['$type', 'add_to_cart'] }, 1, 0] } }
        }
      },
      { $sort: { productViews: -1, addToCarts: -1, _id: 1 } }
    ]),
      Order.aggregate([
        { $match: inRange },
        { $unwind: '$items' },
      {
        $group: {
          _id: '$items.slug',
          unitsSold: { $sum: '$items.qty' },
          revenue: { $sum: { $multiply: ['$items.qty', '$items.price'] } }
        }
      }
      ]),
      ShopperProfile.find({
        ...(range.start ? { lastActivityAt: { $gte: range.start, $lte: range.end } } : {}),
        $or: [
          { 'customer.name': { $ne: '' } },
          { 'customer.phone': { $ne: '' } },
          { 'customer.email': { $ne: '' } }
        ]
      }).sort({ lastActivityAt: -1 }).limit(50).lean(),
      ShopperProfile.find({
        cartItems: { $exists: true, $ne: [] },
        cartUpdatedAt: { $lte: abandonmentCutoff },
        ...(range.start ? { cartUpdatedAt: { $gte: range.start, $lte: range.end } } : {}),
        $expr: {
          $or: [
            { $eq: ['$checkedOutAt', null] },
            { $lt: ['$checkedOutAt', '$cartUpdatedAt'] }
          ]
        }
      }).sort({ cartUpdatedAt: -1 }).limit(50).lean(),
      Visit.aggregate([
        ...(range.start ? [{ $match: inRange }] : []),
        { $group: { _id: '$source', visits: { $sum: 1 } } }
      ])
    ]);

  const salesBySlug = new Map(salesRows.map(row => [row._id, row]));
  const productPerformance = productEventRows.map(row => ({
    slug: row._id,
    name: row.productName || row._id,
    productViews: row.productViews,
    addToCarts: row.addToCarts,
    unitsSold: salesBySlug.get(row._id)?.unitsSold || 0,
    revenue: salesBySlug.get(row._id)?.revenue || 0,
    conversionRate: row.productViews > 0
      ? Number((((salesBySlug.get(row._id)?.unitsSold || 0) / row.productViews) * 100).toFixed(1))
      : 0
  }));

  salesRows.forEach(row => {
    if (!productPerformance.some(product => product.slug === row._id)) {
      productPerformance.push({
        slug: row._id,
        name: row._id,
        productViews: 0,
          addToCarts: 0,
          unitsSold: row.unitsSold || 0,
          revenue: row.revenue || 0,
          conversionRate: 0
        });
      }
    });

  const bySold = [...productPerformance].filter(product => product.unitsSold > 0).sort((a, b) => b.unitsSold - a.unitsSold || b.revenue - a.revenue);
  const viewedProducts = productPerformance.filter(product => product.productViews > 0);
  const byViews = [...viewedProducts].sort((a, b) => b.productViews - a.productViews);
  const byAdds = [...productPerformance].filter(product => product.addToCarts > 0).sort((a, b) => b.addToCarts - a.addToCarts);
  const byConversionAsc = [...viewedProducts].sort((a, b) => a.conversionRate - b.conversionRate || a.productViews - b.productViews);
  const traffic = Object.fromEntries(['instagram', 'tiktok', 'snapchat', 'whatsapp', 'direct'].map(source => [source, 0]));
  trafficRows.forEach(row => {
    traffic[row._id || 'direct'] = row.visits;
  });

  const visits = todaysVisits;
  const orders = ordersToday;
  const conversionRate = visits > 0 ? Number(((orders / visits) * 100).toFixed(1)) : 0;
  const abandonedCount = abandonedRows.length;
  const trafficWinner = Object.entries(traffic).sort((a, b) => b[1] - a[1])[0];
  const insights = orders === 0
    ? [
        'No completed orders were recorded in this period.',
        'Conversion cannot be judged properly until sales data increases.',
        'Product interest is currently based on views and add-to-cart activity.',
        'Early data should be treated as directional because the sample size is still small.'
      ]
    : [
        `${orders} completed order${orders === 1 ? '' : 's'} were recorded in this period.`,
        `Overall conversion for the selected range is ${conversionRate}%.`,
        abandonedCount > 0
          ? `${abandonedCount} abandoned cart${abandonedCount === 1 ? ' needs' : 's need'} follow-up.`
          : 'No abandoned carts are currently visible in this range.'
      ];
  const recommendations = [
    bySold[0]
      ? `Best product to push: ${bySold[0].name}.`
      : 'There is not enough sales data yet to identify a strongest sales performer.',
    byConversionAsc[0]
      ? `Review ${byConversionAsc[0].name}; it has the weakest observed conversion in this period.`
      : 'There is not enough product conversion data yet to name a weak performer.',
    trafficWinner?.[1] > 0
      ? `Traffic source performing best: ${trafficWinner[0]}.`
      : 'Traffic source volume is still too low to identify a clear winner.',
    abandonedCount > 0
      ? `${abandonedCount} abandoned cart${abandonedCount === 1 ? ' needs' : 's need'} follow-up.`
      : 'No abandoned carts are currently visible in this range.',
    checkoutClicksToday > orders
      ? 'Checkout clicks exceed orders; review payment friction and form completion.'
      : 'Checkout-to-order flow looks healthy for the selected period.'
  ];

  return {
    range,
    overview: {
      visits,
      uniqueVisitors,
      totalCarts,
      checkoutClicks: checkoutClicksToday,
      orders,
      revenue: revenueToday[0]?.totalRevenue || 0,
      conversionRate,
      productViews: productViewsCount,
      addToCarts: addToCartCount
    },
    productPerformance,
    productHighlights: {
      bestProduct: bySold[0] || null,
      worstProduct: byConversionAsc[0] || null,
      mostViewedProduct: byViews[0] || null,
      mostAddedToCartProduct: byAdds[0] || null
    },
    customers: customerRows,
    abandonedCarts: abandonedRows,
    traffic,
    insights,
    recommendations
  };
}

function createLowStockEmail(lowStockItems) {
  const rows = lowStockItems.map(item =>
    emailLabelValueHtml(
      `${item.name} (${item.size})`,
      `${item.remaining} unit${item.remaining === 1 ? '' : 's'} remaining`
    )
  ).join('');

  const body = wrapBrandedEmail(`
${emailPanelHtml(`
${emailHeadingHtml('Low stock alert', EMAIL_RED)}
${emailParagraphHtml('An order just reduced these product sizes to 2 or fewer units:')}
${rows}
${emailParagraphHtml('Restock or archive the product from the admin dashboard if needed.')}
`)}
${emailButtonHtml('VIEW IN ADMIN', `${SITE_URL}/admin`)}
`);

  return {
    from: resendFrom(),
    to: OWNER_EMAIL,
    subject: 'KRO PK low stock alert',
    html: body
  };
}

app.get('/api/admin/analytics', authMiddleware, async (req, res) => {
  res.json(await buildAnalyticsReport(String(req.query.range || 'today')));
});

function summarizeReport(report) {
  const best = report.productHighlights.bestProduct?.name;
  const trafficWinner = Object.entries(report.traffic).sort((a, b) => b[1] - a[1])[0]?.[0] || 'direct';
  if (!best) {
    return `For ${report.range.label.toLowerCase()}, the shop recorded ${report.overview.visits} visits and ${report.overview.orders} orders. There is not enough sales data yet to identify a strongest sales performer. ${trafficWinner} is the leading traffic source in the selected period.`;
  }
  return `For ${report.range.label.toLowerCase()}, the shop recorded ${report.overview.visits} visits, ${report.overview.orders} orders, and ${report.overview.conversionRate}% conversion. ${best} is the strongest sales performer, while ${trafficWinner} is the leading traffic source.`;
}

function writePdfSection(doc, title) {
  doc.moveDown(0.6).fontSize(15).fillColor('#0f172a').text(title);
  doc.moveDown(0.35);
}

function enoughData(values = []) {
  return values.some(value => Number(value || 0) > 0);
}

function writeNoChartData(doc) {
  doc.fontSize(10).fillColor('#64748b').text('Not enough data to generate this chart yet.');
}

function drawDonutChart(doc, entries, x, y, radius = 48) {
  const total = entries.reduce((sum, [, value]) => sum + Number(value || 0), 0);
  if (!total) return false;
  const colors = ['#0f172a', '#fbbf24', '#ef4444', '#2563eb', '#16a34a'];
  let start = -Math.PI / 2;
  entries.forEach(([label, value], index) => {
    const angle = (Number(value || 0) / total) * Math.PI * 2;
    doc.moveTo(x, y).fillColor(colors[index % colors.length]).path(`M ${x} ${y} L ${x + radius * Math.cos(start)} ${y + radius * Math.sin(start)} A ${radius} ${radius} 0 ${angle > Math.PI ? 1 : 0} 1 ${x + radius * Math.cos(start + angle)} ${y + radius * Math.sin(start + angle)} Z`).fill();
    start += angle;
    doc.fillColor(colors[index % colors.length]).rect(x + 80, y - 42 + index * 16, 10, 10).fill();
    doc.fillColor('#111827').fontSize(9).text(`${label}: ${value}`, x + 96, y - 44 + index * 16);
  });
  doc.fillColor('#ffffff').circle(x, y, radius * 0.45).fill();
  return true;
}

function drawGroupedBarChart(doc, products, x, y, width = 480, height = 140) {
  if (!products.length || !products.some(product => product.productViews || product.addToCarts || product.unitsSold)) return false;
  const top = Math.max(...products.flatMap(product => [product.productViews, product.addToCarts, product.unitsSold]), 1);
  const groupWidth = width / products.length;
  const barWidth = Math.min(18, groupWidth / 4);
  const colors = ['#0f172a', '#fbbf24', '#ef4444'];
  products.forEach((product, index) => {
    [product.productViews, product.addToCarts, product.unitsSold].forEach((value, series) => {
      const barHeight = (Number(value || 0) / top) * height;
      doc.fillColor(colors[series]).rect(x + index * groupWidth + series * (barWidth + 4), y + height - barHeight, barWidth, barHeight).fill();
    });
    doc.fillColor('#111827').fontSize(7).text(product.name.slice(0, 10), x + index * groupWidth, y + height + 6, { width: groupWidth - 4 });
  });
  doc.fontSize(9).fillColor('#111827').text('Views', x, y - 15);
  doc.fillColor(colors[0]).rect(x + 30, y - 12, 8, 8).fill();
  doc.fillColor('#111827').text('Adds', x + 55, y - 15);
  doc.fillColor(colors[1]).rect(x + 82, y - 12, 8, 8).fill();
  doc.fillColor('#111827').text('Sold', x + 108, y - 15);
  doc.fillColor(colors[2]).rect(x + 135, y - 12, 8, 8).fill();
  return true;
}

function drawFunnelChart(doc, stages, x, y, width = 480, height = 120) {
  if (!enoughData(stages.map(stage => stage.value))) return false;
  const max = Math.max(...stages.map(stage => stage.value), 1);
  stages.forEach((stage, index) => {
    const barWidth = (stage.value / max) * width;
    doc.fillColor(['#0f172a', '#334155', '#2563eb', '#fbbf24', '#16a34a'][index]).rect(x, y + index * 22, barWidth, 14).fill();
    doc.fillColor('#111827').fontSize(9).text(`${stage.label}: ${stage.value}`, x + 4, y + index * 22 + 2);
  });
  return true;
}

function drawSimpleBarPair(doc, left, right, x, y, width = 220, height = 70) {
  if (!enoughData([left.value, right.value])) return false;
  const max = Math.max(left.value, right.value, 1);
  [left, right].forEach((item, index) => {
    const barHeight = (item.value / max) * height;
    doc.fillColor(index === 0 ? '#2563eb' : '#ef4444').rect(x + index * 90, y + height - barHeight, 48, barHeight).fill();
    doc.fillColor('#111827').fontSize(9).text(`${item.label}\n${item.value}`, x + index * 90, y + height + 6, { width: 70 });
  });
  return true;
}

app.get('/api/admin/analytics/export.pdf', authMiddleware, async (req, res) => {
  const report = await buildAnalyticsReport(String(req.query.range || 'today'));
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="kro-pk-analytics-${report.range.key}.pdf"`);
  const doc = new PDFDocument({ margin: 42 });
  doc.pipe(res);
  doc.fontSize(22).fillColor('#0f172a').text('KRO PK Analytics Report');
  doc.fontSize(10).fillColor('#475569').text(`Date range: ${report.range.label}`);
  writePdfSection(doc, 'Executive summary');
  doc.fontSize(10).fillColor('#111827').text(summarizeReport(report));
  writePdfSection(doc, 'Key metrics');
  const metrics = [
    ['Visits', report.overview.visits],
    ['Unique visitors', report.overview.uniqueVisitors],
    ['Total carts', report.overview.totalCarts],
    ['Checkout clicks', report.overview.checkoutClicks],
    ['Orders', report.overview.orders],
    ['Revenue', `NGN ${Number(report.overview.revenue || 0).toLocaleString('en-NG')}`],
    ['Conversion rate', `${report.overview.conversionRate}%`]
  ];
  metrics.forEach(([label, value]) => doc.fontSize(10).text(`${label}: ${value}`));
  writePdfSection(doc, 'Traffic source breakdown');
  if (!drawDonutChart(doc, Object.entries(report.traffic), 110, doc.y + 48)) writeNoChartData(doc);
  doc.moveDown(6);
  writePdfSection(doc, 'Product performance');
  if (!drawGroupedBarChart(doc, report.productPerformance.slice(0, 6), 42, doc.y + 12)) writeNoChartData(doc);
  doc.moveDown(9);
  report.productPerformance.slice(0, 10).forEach(product => {
    doc.fontSize(9).text(`${product.name} | Views ${product.productViews} | Adds ${product.addToCarts} | Sold ${product.unitsSold} | Revenue NGN ${Number(product.revenue || 0).toLocaleString('en-NG')} | Conversion ${product.conversionRate}%`);
  });
  writePdfSection(doc, 'Funnel chart');
  if (!drawFunnelChart(doc, [
    { label: 'Visits', value: report.overview.visits },
    { label: 'Product Views', value: report.overview.productViews },
    { label: 'Add To Cart', value: report.overview.addToCarts },
    { label: 'Checkout Clicks', value: report.overview.checkoutClicks },
    { label: 'Orders', value: report.overview.orders }
  ], 42, doc.y + 6)) writeNoChartData(doc);
  doc.moveDown(7);
  writePdfSection(doc, 'Cart and abandoned cart summary');
  doc.fontSize(10).text(`Active carts in range: ${report.overview.totalCarts}`);
  doc.text(`Abandoned carts in range: ${report.abandonedCarts.length}`);
  if (!drawSimpleBarPair(doc,
    { label: 'Active carts', value: report.overview.totalCarts },
    { label: 'Abandoned carts', value: report.abandonedCarts.length },
    42, doc.y + 8
  )) writeNoChartData(doc);
  doc.moveDown(6);
  writePdfSection(doc, 'Revenue / orders chart');
  if (!enoughData([report.overview.orders, report.overview.revenue])) {
    writeNoChartData(doc);
  } else {
    drawSimpleBarPair(doc,
      { label: 'Orders', value: report.overview.orders },
      { label: 'Revenue', value: report.overview.revenue },
      42, doc.y + 8
    );
    doc.moveDown(6);
  }
  writePdfSection(doc, 'Customer summary');
  doc.fontSize(10).text(`Known customers in range: ${report.customers.length}`);
  doc.text(`Customers with abandoned carts: ${report.abandonedCarts.length}`);
  writePdfSection(doc, 'Business insights');
  report.insights.forEach(insight => doc.fontSize(10).text(`• ${insight}`));
  writePdfSection(doc, 'Recommendations');
  report.insights.forEach(insight => doc.fontSize(10).text(`• ${insight}`));
  doc.end();
});

app.get('/api/admin/analytics/export.xlsx', authMiddleware, async (req, res) => {
  const report = await buildAnalyticsReport(String(req.query.range || 'today'));
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'KRO PK';
  const overview = workbook.addWorksheet('Overview');
  overview.addRow(['KRO PK Analytics Report']);
  overview.addRow(['Date range', report.range.label]);
  overview.addRows([
    ['Visits', report.overview.visits],
    ['Unique visitors', report.overview.uniqueVisitors],
    ['Total carts', report.overview.totalCarts],
    ['Checkout clicks', report.overview.checkoutClicks],
    ['Orders', report.overview.orders],
    ['Revenue', report.overview.revenue],
    ['Conversion rate', report.overview.conversionRate]
  ]);
  const products = workbook.addWorksheet('Products');
  products.columns = [
    { header: 'Product Name', key: 'name' },
    { header: 'Slug', key: 'slug' },
    { header: 'Product Views', key: 'productViews' },
    { header: 'Add To Carts', key: 'addToCarts' },
    { header: 'Units Sold', key: 'unitsSold' },
    { header: 'Revenue', key: 'revenue' },
    { header: 'Conversion Rate', key: 'conversionRate' }
  ];
  products.addRows(report.productPerformance);
  const traffic = workbook.addWorksheet('Traffic');
  traffic.columns = [{ header: 'Source', key: 'source' }, { header: 'Visits', key: 'visits' }];
  traffic.addRows(Object.entries(report.traffic).map(([source, visits]) => ({ source, visits })));
  const abandoned = workbook.addWorksheet('Abandoned Carts');
  abandoned.columns = [
    { header: 'Name', key: 'name' }, { header: 'Phone', key: 'phone' }, { header: 'Email', key: 'email' },
    { header: 'Cart items', key: 'items' }, { header: 'Abandoned at', key: 'abandonedAt' }
  ];
  abandoned.addRows(report.abandonedCarts.map(cart => ({
    name: cart.customer?.name || '',
    phone: cart.customer?.phone || '',
    email: cart.customer?.email || '',
    items: (cart.cartItems || []).map(item => `${item.name || item.id} x ${item.qty}`).join(', '),
    abandonedAt: cart.cartUpdatedAt
  })));
  const customers = workbook.addWorksheet('Customers');
  customers.columns = [
    { header: 'Name', key: 'name' }, { header: 'Phone', key: 'phone' }, { header: 'Email', key: 'email' },
    { header: 'Last activity', key: 'lastActivity' }, { header: 'Cart items', key: 'items' }
  ];
  customers.addRows(report.customers.map(customer => ({
    name: customer.customer?.name || '',
    phone: customer.customer?.phone || '',
    email: customer.customer?.email || '',
    lastActivity: customer.lastActivityAt,
    items: (customer.cartItems || []).map(item => `${item.name || item.id} x ${item.qty}`).join(', ')
  })));
  workbook.eachSheet(sheet => {
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFBBF24' } };
    sheet.columns?.forEach(column => {
      const values = column.values || [];
      const maxLength = values.reduce((max, value) => Math.max(max, String(value ?? '').length), 0);
      column.width = Math.min(Math.max(maxLength + 2, 14), 32);
    });
  });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="kro-pk-analytics-${report.range.key}.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
});

app.get('/api/admin/analytics/export.csv', authMiddleware, async (req, res) => {
  const report = await buildAnalyticsReport(String(req.query.range || 'today'));
  const lines = [
    ['Section', 'Metric', 'Value', 'Product Name', 'Slug', 'Product Views', 'Add To Carts', 'Units Sold', 'Revenue', 'Conversion Rate', 'Traffic Source', 'Visits'],
    ['Overview', 'Date Range', report.range.label, '', '', '', '', '', '', '', '', ''],
    ['Overview', 'Visits', report.overview.visits, '', '', '', '', '', '', '', '', ''],
    ['Overview', 'Unique Visitors', report.overview.uniqueVisitors, '', '', '', '', '', '', '', '', ''],
    ['Overview', 'Total Carts', report.overview.totalCarts, '', '', '', '', '', '', '', '', ''],
    ['Overview', 'Checkout Clicks', report.overview.checkoutClicks, '', '', '', '', '', '', '', '', ''],
    ['Overview', 'Orders', report.overview.orders, '', '', '', '', '', '', '', '', ''],
    ['Overview', 'Revenue', report.overview.revenue, '', '', '', '', '', '', '', '', ''],
    ['Overview', 'Conversion Rate', report.overview.conversionRate, '', '', '', '', '', '', '', '', ''],
    ...report.productPerformance.map(product => [
      'Product Performance', '', '', product.name, product.slug, product.productViews,
      product.addToCarts, product.unitsSold, product.revenue, product.conversionRate, '', ''
    ]),
    ...Object.entries(report.traffic).map(([source, visits]) => ['Traffic', '', '', '', '', '', '', '', '', '', source, visits])
  ];
  const csv = lines.map(row => row.map(value => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="kro-pk-analytics-${report.range.key}.csv"`);
  res.send(csv);
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'admin.html'));
});

app.get('/admin/login', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'admin-login.html'));
});

app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, '..', 'public', '404.html'));
});

connectDB().then(() => seedProducts()).then(() => normalizeProductSortOrder()).then(() => {
  processAbandonedCartReminders().catch(err => {
    console.error('Abandoned cart reminder run failed:', err.message || err);
  });
  setInterval(() => {
    processAbandonedCartReminders().catch(err => {
      console.error('Abandoned cart reminder run failed:', err.message || err);
    });
  }, 60 * 60 * 1000);

  app.listen(PORT, () => {
    console.log(`KRO PK backend running on http://localhost:${PORT}`);
    console.log(`COMING_SOON raw value: ${COMING_SOON_RAW === undefined ? '(unset)' : JSON.stringify(COMING_SOON_RAW)}; enabled: ${COMING_SOON_ENABLED}`);
    if (COMING_SOON_ENABLED) console.log('COMING_SOON mode: public routes redirect to /coming-soon');
  });
}).catch(err => {
  console.error('Failed to start server', err);
  process.exit(1);
});
