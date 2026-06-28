const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema({
  slug: { type: String, required: true },
  name: { type: String, required: true },
  size: { type: String, required: true },
  qty: { type: Number, required: true },
  price: { type: Number, required: true },
  image: { type: String, default: '' }
}, { _id: false });

const customerSchema = new mongoose.Schema({
  name: String,
  phone: String,
  email: String,
  address: String,
  city: String,
  state: String
}, { _id: false });

const orderSchema = new mongoose.Schema({
  orderNumber: { type: String, required: true, unique: true },
  customer: { type: customerSchema, required: true },
  items: { type: [orderItemSchema], required: true },
  totalBeforeDiscount: { type: Number, default: null },
  promoCode: { type: String, default: '' },
  discountPercent: { type: Number, default: 0 },
  deliveryCost: { type: Number, default: 0 },
  universityPickup: { type: Boolean, default: false },
  total: { type: Number, required: true },
  paystackReference: { type: String, required: true, unique: true },
  visitorId: { type: String, default: '', index: true },
  sessionId: { type: String, default: '' },
  paymentStatus: { type: String, default: 'pending' },
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'shipped', 'delivered'],
    default: 'pending'
  },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Order', orderSchema);
