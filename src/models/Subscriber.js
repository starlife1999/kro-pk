const mongoose = require('mongoose');

const subscriberSchema = new mongoose.Schema({
  name: { type: String, default: '', trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  active: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

subscriberSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('Subscriber', subscriberSchema);

