require('dotenv').config();
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const https = require('https');
const { Resend } = require('resend');
const fs = require('fs');
const multer = require('multer');

const Product = require('./models/Product');
const Order = require('./models/Order');
const Counter = require('./models/Counter');
const PromoCode = require('./models/PromoCode');
const Subscriber = require('./models/Subscriber');
const Broadcast = require('./models/Broadcast');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@kropk.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'password';
const OWNER_EMAIL = process.env.OWNER_EMAIL || 'orders@kropk.com';
/** Flat nationwide delivery in NGN (must match cart checkout). */
const FLAT_DELIVERY_FEE_NGN = 4500;

if (!process.env.MONGODB_URI) {
  console.warn('Warning: MONGODB_URI not set. Using default local mongodb://localhost:27017/kro_pk_store');
}

const resend = new Resend(process.env.RESEND_API_KEY);

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '..', 'public')));

const uploadsDir = path.join(__dirname, '..', 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadsDir),
    filename: (_req, file, cb) => {
      const safeBase = String(file.originalname || 'upload').replace(/[^a-zA-Z0-9._-]+/g, '-');
      const ext = path.extname(safeBase) || '';
      const base = path.basename(safeBase, ext);
      cb(null, `${base}-${Date.now()}${ext}`);
    }
  }),
  limits: { fileSize: 5 * 1024 * 1024 }
});

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

function createOrderEmail(order) {
  const items = order.items.map(item =>
    `• ${item.name} / ${item.size} × ${item.qty} = ₦${item.price.toLocaleString('en-NG')}`
  ).join('\n');

  return {
    from: process.env.EMAIL_FROM || 'onboarding@resend.dev',
    to: OWNER_EMAIL,
    subject: `New order ${order.orderNumber}`,
    html: `
      <h2>New order received</h2>
      <p><strong>Order number:</strong> ${order.orderNumber}</p>
      <p><strong>Customer:</strong> ${order.customer.name}</p>
      <p><strong>Phone:</strong> ${order.customer.phone}</p>
      <p><strong>Email:</strong> ${order.customer.email || 'Not provided'}</p>
      <p><strong>Address:</strong> ${order.customer.address}, ${order.customer.city}, ${order.customer.state}</p>
      <p><strong>Paystack ref:</strong> ${order.paystackReference || 'N/A'}</p>
      <h3>Items:</h3>
      <pre>${items}</pre>
      <p><strong>Delivery:</strong> ₦${(order.deliveryCost ?? 0).toLocaleString('en-NG')}</p>
      <p><strong>Total:</strong> ₦${order.total.toLocaleString('en-NG')}</p>
      <p><strong>Status:</strong> ${order.status}</p>
      <p>Please review the admin dashboard to process this order.</p>
    `,
  };
}

function createCustomerConfirmationEmail(order) {
  const items = order.items.map(item =>
    `• ${item.name} / ${item.size} × ${item.qty} = ₦${item.price.toLocaleString('en-NG')}`
  ).join('\n');

  return {
    from: process.env.EMAIL_FROM || 'onboarding@resend.dev',
    to: order.customer.email,
    subject: `Your KRO PK order ${order.orderNumber}`,
    html: `
      <h2>Thanks for your order!</h2>
      <p>Your order number is <strong>${order.orderNumber}</strong>.</p>
      <p>Payment reference: <strong>${order.paystackReference || 'N/A'}</strong></p>
      <p>We will contact you soon to confirm payment and delivery.</p>
      <h3>Order details</h3>
      <p><strong>Name:</strong> ${order.customer.name}</p>
      <p><strong>Phone:</strong> ${order.customer.phone}</p>
      <p><strong>Address:</strong> ${order.customer.address}, ${order.customer.city}, ${order.customer.state}</p>
      <h3>Items</h3>
      <pre>${items}</pre>
      <p><strong>Delivery:</strong> ₦${(order.deliveryCost ?? 0).toLocaleString('en-NG')}</p>
      <p><strong>Total:</strong> ₦${order.total.toLocaleString('en-NG')}</p>
      <p>We will reach out soon with payment and delivery details.</p>
    `,
  };
}

function createCustomerShippedEmail(order) {
  return {
    from: process.env.EMAIL_FROM || 'onboarding@resend.dev',
    to: order.customer.email,
    subject: `Your KRO PK order ${order.orderNumber} is on the way`,
    html: `
      <h2>Your order is on the way 🚚</h2>
      <p>Good news — your order <strong>${order.orderNumber}</strong> has been shipped.</p>
      <p>We’ll reach out if we need anything else. Thank you for shopping KRO PK.</p>
    `,
  };
}

function createCustomerDeliveredEmail(order) {
  return {
    from: process.env.EMAIL_FROM || 'onboarding@resend.dev',
    to: order.customer.email,
    subject: `Delivered: KRO PK order ${order.orderNumber}`,
    html: `
      <h2>Delivered ✅</h2>
      <p>Your order <strong>${order.orderNumber}</strong> has been delivered.</p>
      <p>Thanks for rocking with us. If you love it, tell a friend.</p>
    `,
  };
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
  const products = await Product.find().sort({ createdAt: 1 }).lean();
  res.set('Cache-Control', 'no-store');
  res.json(products);
});

app.get('/api/products', async (req, res) => {
  const products = await Product.find().sort({ createdAt: 1 }).lean();
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

app.post('/api/orders', async (req, res) => {
  const { customer, items, paystackReference, promoCode } = req.body;
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
      const result = await Product.updateOne(
        { _id: update.product._id, [pathKey]: { $gte: update.qty } },
        { $inc: { [pathKey]: -update.qty } },
        { session }
      );
      if (result.modifiedCount === 0) {
        throw new Error(`Stock unavailable for ${update.product.slug} size ${update.size}`);
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
      paymentStatus: paystackData.status
    }], { session });

    await session.commitTransaction();
    session.endSession();

    const ownerMail = createOrderEmail(order[0]);
    const customerMail = createCustomerConfirmationEmail(order[0]);

    resend.emails.send(ownerMail).catch(err => {
      console.error('Owner email send error:', err.message || err);
    });

    resend.emails.send(customerMail).catch(err => {
      console.error('Customer email send error:', err.message || err);
    });

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

  const from = process.env.EMAIL_FROM || 'onboarding@resend.dev';
  await Promise.allSettled(subscribers.map(s => {
    return resend.emails.send({
      from,
      to: s.email,
      subject,
      html: `<div style="font-family:Arial,sans-serif;line-height:1.6;">${body.replace(/\n/g, '<br>')}</div>`
    });
  }));

  res.status(201).json({ message: 'Broadcast sent', broadcastId: broadcast._id, recipientCount });
});

// ─── ADMIN: PRODUCT IMAGE UPLOAD ───────────────────────────────
app.post('/api/admin/products/:slug/image', authMiddleware, upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
  const slug = decodeURIComponent(req.params.slug);
  const imagePath = `uploads/${req.file.filename}`;
  const product = await Product.findOneAndUpdate(
    { slug },
    { $set: { image: imagePath } },
    { new: true, runValidators: true }
  ).lean();
  if (!product) return res.status(404).json({ message: 'Product not found' });
  res.status(201).json({ message: 'Uploaded', image: imagePath, product });
});

app.post('/api/admin/products/:slug/gallery', authMiddleware, upload.array('gallery', 4), async (req, res) => {
  const slug = decodeURIComponent(req.params.slug);
  if (!req.files?.length) return res.status(400).json({ message: 'No files uploaded' });
  const paths = req.files.slice(0, 4).map(f => `uploads/${f.filename}`);
  const product = await Product.findOneAndUpdate(
    { slug },
    { $set: { images: paths } },
    { new: true, runValidators: true }
  ).lean();
  if (!product) return res.status(404).json({ message: 'Product not found' });
  res.status(201).json({ message: 'Gallery uploaded', images: paths, product });
});

app.patch('/api/admin/products/:slug', authMiddleware, async (req, res) => {
  const slugParam = decodeURIComponent(req.params.slug);
  console.log('[admin] PATCH /api/admin/products/:slug', slugParam, req.body);
  const { sizes, active, name, price, description, tag, image, images } = req.body;
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
  console.log('[admin] product update $set', slugParam, update);
  const product = await Product.findOneAndUpdate({ slug: slugParam }, { $set: update }, { new: true, runValidators: true }).lean();
  if (!product) return res.status(404).json({ message: 'Product not found' });
  console.log('[admin] updated product', { slug: product.slug, price: product.price, active: product.active, tag: product.tag });
  res.json(product);
});

app.post('/api/admin/products', authMiddleware, async (req, res) => {
  const { name, slug, description, price, tag, image, images, sizes, active } = req.body;
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

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'admin.html'));
});

app.get('/admin/login', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'admin-login.html'));
});

app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, '..', 'public', 'error.htm'));
});

connectDB().then(() => seedProducts()).then(() => {
  app.listen(PORT, () => {
    console.log(`KRO PK backend running on http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('Failed to start server', err);
  process.exit(1);
});
