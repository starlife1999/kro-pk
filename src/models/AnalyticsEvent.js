const mongoose = require('mongoose');

const analyticsEventSchema = new mongoose.Schema({
  type: {
    type: String,
    required: true,
    enum: ['page_view', 'product_view', 'add_to_cart', 'cart_view', 'cart_update', 'remove_from_cart', 'checkout_click']
  },
  visitorId: { type: String, required: true, index: true },
  sessionId: { type: String, default: '', index: true },
  path: { type: String, default: '' },
  productSlug: { type: String, default: '', index: true },
  productName: { type: String, default: '' },
  quantity: { type: Number, default: 0 },
  cartCount: { type: Number, default: 0 },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  createdAt: { type: Date, default: Date.now, index: true }
});

analyticsEventSchema.index({ type: 1, createdAt: -1 });
analyticsEventSchema.index({ productSlug: 1, type: 1, createdAt: -1 });

module.exports = mongoose.model('AnalyticsEvent', analyticsEventSchema);
