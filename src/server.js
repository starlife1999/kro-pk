require('dotenv').config();
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');

const Product = require('./models/Product');
const Order = require('./models/Order');
const Counter = require('./models/Counter');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@kropk.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'password';
const OWNER_EMAIL = process.env.OWNER_EMAIL || 'orders@kropk.com';

if (!process.env.MONGODB_URI) {
  console.warn('Warning: MONGODB_URI not set. Using default local mongodb://localhost:27017/kro_pk_store');
}

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '..', 'public')));

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
    from: process.env.EMAIL_USER,
    to: OWNER_EMAIL,
    subject: `New order ${order.orderNumber}`,
    text: `New order received:\n\nOrder number: ${order.orderNumber}\nCustomer: ${order.customer.name}\nPhone: ${order.customer.phone}\nAddress: ${order.customer.address}, ${order.customer.city}, ${order.customer.state}\n\nItems:\n${items}\n\nTotal: ₦${order.total.toLocaleString('en-NG')}\n\nStatus: ${order.status}\n\nPlease review the admin dashboard to process this order.`,
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
  res.json(products);
});

app.get('/api/products', async (req, res) => {
  const products = await Product.find().sort({ createdAt: 1 }).lean();
  res.json(products);
});

app.get('/api/products/:slug', async (req, res) => {
  const product = await Product.findOne({ slug: req.params.slug }).lean();
  if (!product) return res.status(404).json({ message: 'Product not found' });
  res.json(product);
});

app.post('/api/orders', async (req, res) => {
  console.log('Order request body:', JSON.stringify(req.body, null, 2));
  const { customer, items } = req.body;
  if (!customer || !items || !Array.isArray(items) || !items.length) {
    return res.status(400).json({ message: 'Customer and items are required' });
  }

  const missingFields = ['name', 'phone', 'address', 'city', 'state'].filter(f => !customer[f]?.toString().trim());
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
    console.log(`Product ${item.slug}:`, { found: !!product, active: product?.active, sizes: product?.sizes });
    if (!product || !product.active) {
      stockErrors.push({ slug: item.slug, message: 'Product unavailable' });
      continue;
    }

    const stockKey = item.size;
    const available = product.sizes?.get(stockKey) ?? 0;
    console.log(`Stock check for ${item.slug} size ${stockKey}: requested ${item.qty}, available ${available}`);
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
    const order = await Order.create([{ orderNumber, customer, items: preparedItems, total }], { session });

    await session.commitTransaction();
    session.endSession();

    const mail = createOrderEmail(order[0]);
    transporter.sendMail(mail).catch(err => console.error('Email error:', err));

    res.status(201).json({ message: 'Order placed successfully', orderNumber });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    console.error(err);
    return res.status(500).json({ message: 'Unable to process order', error: err.message });
  }
});

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
  const order = await Order.findByIdAndUpdate(req.params.id, { status }, { new: true }).lean();
  if (!order) return res.status(404).json({ message: 'Order not found' });
  res.json(order);
});

app.patch('/api/admin/products/:slug', authMiddleware, async (req, res) => {
  const { sizes, active, name, price, description, tag, image } = req.body;
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
  const product = await Product.findOneAndUpdate({ slug: req.params.slug }, { $set: update }, { new: true }).lean();
  if (!product) return res.status(404).json({ message: 'Product not found' });
  res.json(product);
});

app.post('/api/admin/products', authMiddleware, async (req, res) => {
  const { name, slug, description, price, tag, image, sizes, active } = req.body;
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

  const newProduct = await Product.create({
    slug: finalSlug,
    name: name.trim(),
    description: description?.trim() || '',
    price: Number(price),
    image: image?.trim() || '',
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
