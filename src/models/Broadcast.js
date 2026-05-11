const mongoose = require('mongoose');

const broadcastSchema = new mongoose.Schema({
  subject: { type: String, required: true, trim: true },
  body: { type: String, required: true, trim: true },
  sentAt: { type: Date, default: null },
  recipientCount: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Broadcast', broadcastSchema);

