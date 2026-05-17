const mongoose = require('mongoose');

const visitSchema = new mongoose.Schema({
  visitorId: { type: String, required: true, index: true },
  sessionId: { type: String, default: '', index: true },
  source: { type: String, default: 'direct', index: true },
  path: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now, index: true }
});

visitSchema.index({ source: 1, createdAt: -1 });

module.exports = mongoose.model('Visit', visitSchema);
