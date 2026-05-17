const mongoose = require('mongoose');

const shopperProfileSchema = new mongoose.Schema({
  visitorId: { type: String, required: true, unique: true, index: true },
  sessionId: { type: String, default: '' },
  source: { type: String, default: 'direct', index: true },
  customer: {
    name: { type: String, default: '' },
    phone: { type: String, default: '' },
    email: { type: String, default: '' }
  },
  cartItems: {
    type: [{
      id: String,
      name: String,
      size: String,
      qty: Number,
      price: Number,
      img: String
    }],
    default: []
  },
  cartUpdatedAt: { type: Date, default: null },
  lastActivityAt: { type: Date, default: Date.now, index: true },
  checkedOutAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('ShopperProfile', shopperProfileSchema);
