require('dotenv').config();
const mongoose = require('mongoose');

const Product = require('./src/models/Product');

async function updateStock() {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    const stockUpdates = {
      'ipk-starboy-polo': { S: 5, M: 5, L: 5, XL: 5, 'ONE SIZE': 0 },
      'pk-thermal': { S: 3, M: 3, L: 3, XL: 2, 'ONE SIZE': 0 },
      'jorts': { S: 4, M: 4, L: 4, XL: 2, 'ONE SIZE': 0 },
      'beanie': { S: 0, M: 0, L: 0, XL: 0, 'ONE SIZE': 8 },
      'graphic-tee': { S: 5, M: 5, L: 5, XL: 5, 'ONE SIZE': 0 },
      'kro-tee': { S: 5, M: 5, L: 5, XL: 5, 'ONE SIZE': 0 }
    };

    for (const [slug, sizes] of Object.entries(stockUpdates)) {
      await Product.updateOne({ slug }, { sizes });
      console.log(`Updated stock for ${slug}`);
    }

    console.log('Stock update complete');
  } catch (error) {
    console.error('Error updating stock:', error);
  } finally {
    await mongoose.disconnect();
  }
}

updateStock();