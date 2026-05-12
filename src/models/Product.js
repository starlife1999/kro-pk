const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  slug: { type: String, required: true, unique: true, trim: true },
  name: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  price: { type: Number, required: true, min: 0 },
  image: { type: String, default: '' },
  images: { type: [String], default: [] },
  tag: { type: String, default: '' },
  sizes: {
    type: Map,
    of: Number,
    default: { S: 0, M: 0, L: 0, XL: 0, 'ONE SIZE': 0 }
  },
  active: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Product', productSchema);
