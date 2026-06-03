const mongoose = require('mongoose');

const comingSoonVisitSchema = new mongoose.Schema({
  visitorId: { type: String, required: true, index: true },
  timestamp: { type: Date, default: Date.now, index: true },
  userAgent: { type: String, default: '' },
  emailSubmitted: { type: Boolean, default: false, index: true },
  passwordUnlocked: { type: Boolean, default: false, index: true },
  email: { type: String, default: '' }
});

comingSoonVisitSchema.index({ timestamp: -1 });
comingSoonVisitSchema.index({ emailSubmitted: 1, timestamp: -1 });
comingSoonVisitSchema.index({ passwordUnlocked: 1, timestamp: -1 });

module.exports = mongoose.model('ComingSoonVisit', comingSoonVisitSchema);
