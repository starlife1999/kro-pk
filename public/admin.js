const orderBody = document.getElementById('ordersBody');
const orderDetail = document.getElementById('orderDetail');
const orderSummary = document.getElementById('orderSummary');
const statusFilter = document.getElementById('orderStatusFilter');
const exportCsvBtn = document.getElementById('exportCsvBtn');
const deleteAllOrdersBtn = document.getElementById('deleteAllOrdersBtn');
const tabs = document.querySelectorAll('.tab');
const ordersPanel = document.getElementById('ordersPanel');
const inventoryPanel = document.getElementById('inventoryPanel');
const inventoryGrid = document.getElementById('inventoryGrid');
const productsPanel = document.getElementById('productsPanel');
const productsGrid = document.getElementById('productsGrid');
const analyticsPanel = document.getElementById('analyticsPanel');
const analyticsOverview = document.getElementById('analyticsOverview');
const analyticsHighlights = document.getElementById('analyticsHighlights');
const analyticsProductsBody = document.getElementById('analyticsProductsBody');
const analyticsCustomersBody = document.getElementById('analyticsCustomersBody');
const analyticsAbandonedBody = document.getElementById('analyticsAbandonedBody');
const analyticsTraffic = document.getElementById('analyticsTraffic');
const analyticsRange = document.getElementById('analyticsRange');
const exportPdfBtn = document.getElementById('exportPdfBtn');
const exportXlsxBtn = document.getElementById('exportXlsxBtn');
const exportCsvBtnAnalytics = document.getElementById('exportCsvBtnAnalytics');
const promoCodesPanel = document.getElementById('promoCodesPanel');
const promoCodesGrid = document.getElementById('promoCodesGrid');
const subscribersPanel = document.getElementById('subscribersPanel');
const subscribersBody = document.getElementById('subscribersBody');
const subscribersTotalCount = document.getElementById('subscribersTotalCount');
const broadcastsPanel = document.getElementById('broadcastsPanel');
const broadcastsGrid = document.getElementById('broadcastsGrid');
const createPromoBtn = document.getElementById('createPromoBtn');
const sendBroadcastBtn = document.getElementById('sendBroadcastBtn');
const subscriberCountLabel = document.getElementById('subscriberCountLabel');
const showAddProductBtn = document.getElementById('showAddProductBtn');
const productForm = document.getElementById('productForm');
const statOrders = document.getElementById('statOrders');
const statPending = document.getElementById('statPending');
const statRevenue = document.getElementById('statRevenue');
const logoutBtn = document.getElementById('logoutBtn');

let orders = [];
let products = [];
let selectedOrder = null;

const fetchJson = async (url, options = {}) => {
  console.log('[admin] request', url, options);
  const res = await fetch(url, options);
  const raw = await res.text();
  let body = {};
  try { body = raw ? JSON.parse(raw) : {}; } catch { body = { raw }; }
  console.log('[admin] response', url, res.status, body);
  if (!res.ok) {
    throw new Error(body.message || `Request failed (${res.status})`);
  }
  return body;
};

const formatPrice = value => `₦${Number(value).toLocaleString('en-NG')}`;
const escapeHtml = str => String(str || '').replace(/[&<>"']/g, tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[tag]);

const loadStats = async () => {
  const data = await fetchJson('/api/admin/stats', { credentials: 'include' });
  statOrders.textContent = data.totalOrders;
  statPending.textContent = data.pendingOrders;
  statRevenue.textContent = formatPrice(data.totalRevenue);
};

const loadOrders = async () => {
  const filter = statusFilter.value ? `?status=${statusFilter.value}` : '';
  orders = await fetchJson(`/api/admin/orders${filter}`);
  orderBody.innerHTML = orders.map(order => `
    <tr>
      <td>${order.orderNumber}</td>
      <td>${order.customer.name}</td>
      <td>${formatPrice(order.total)}</td>
      <td><span class="badge ${order.status}">${order.status}</span></td>
      <td><button class="btn-small order-view-button" data-id="${order._id}">View</button></td>
    </tr>
  `).join('');

  orderBody.querySelectorAll('.order-view-button').forEach(button => {
    button.addEventListener('click', () => showOrderDetails(button.dataset.id));
  });
};

const exportOrdersCsv = () => {
  if (!orders.length) return;
  const headers = ['Order Number','Name','Email','Phone','Status','Total','City','State','Address','Created At'];
  const rows = orders.map(order => [
    order.orderNumber,
    order.customer.name,
    order.customer.email || '',
    order.customer.phone || '',
    order.status,
    order.total,
    order.customer.city || '',
    order.customer.state || '',
    order.customer.address || '',
    new Date(order.createdAt).toLocaleString('en-NG')
  ]);
  const csv = [headers, ...rows].map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `orders-${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

const showOrderDetails = async id => {
  selectedOrder = await fetchJson(`/api/admin/orders/${id}`);
  const itemsHtml = selectedOrder.items.map(item => `<li>${item.name} / ${item.size} × ${item.qty} = ${formatPrice(item.price)}</li>`).join('');
  orderDetail.classList.remove('hidden');
  orderSummary.innerHTML = `
    <div><strong>Order</strong>: ${selectedOrder.orderNumber}</div>
    <div><strong>Status</strong>: <span class="badge ${selectedOrder.status}">${selectedOrder.status}</span></div>
    <div><strong>Customer</strong>: ${selectedOrder.customer.name}</div>
    <div><strong>Email</strong>: ${escapeHtml(selectedOrder.customer.email || 'N/A')}</div>
    <div><strong>Phone</strong>: ${selectedOrder.customer.phone}</div>
    <div><strong>Address</strong>: ${selectedOrder.customer.address}, ${selectedOrder.customer.city}, ${selectedOrder.customer.state}</div>
    <div><strong>Delivery fee</strong>: ${formatPrice(selectedOrder.deliveryCost ?? 0)}</div>
    <div><strong>Total</strong>: ${formatPrice(selectedOrder.total)}</div>
    <div style="margin-top:1rem;"><strong>Items</strong><ul style="padding-left:1.2rem;">${itemsHtml}</ul></div>
    <div style="margin-top:1rem;display:flex;gap:.75rem;flex-wrap:wrap;align-items:center;">
      <label style="font-size:.95rem;">Update status</label>
      <select id="statusSelect" style="padding:.8rem 1rem;border-radius:12px;border:1px solid #334155;background:#090f1f;color:#fff;">
        <option value="pending">pending</option>
        <option value="confirmed">confirmed</option>
        <option value="shipped">shipped</option>
        <option value="delivered">delivered</option>
      </select>
      <button id="saveStatusBtn" class="btn-small">Save</button>
      <button id="deleteOrderBtn" class="btn-small" style="background:#b91c1c;">Delete order</button>
    </div>
  `;
  document.getElementById('statusSelect').value = selectedOrder.status;
  document.getElementById('saveStatusBtn').addEventListener('click', saveOrderStatus);
  document.getElementById('deleteOrderBtn').addEventListener('click', deleteSelectedOrder);
};

const saveOrderStatus = async () => {
  if (!selectedOrder) return;
  const status = document.getElementById('statusSelect').value;
  await fetchJson(`/api/admin/orders/${selectedOrder._id}/status`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status })
  });
  await loadOrders();
  await loadStats();
  showMessage('Order status updated');
};

const deleteSelectedOrder = async () => {
  if (!selectedOrder) return;
  if (!window.confirm(`Delete order ${selectedOrder.orderNumber} permanently? This cannot be undone.`)) return;
  try {
    await fetchJson(`/api/admin/orders/${selectedOrder._id}`, { method: 'DELETE', credentials: 'include' });
    selectedOrder = null;
    orderSummary.innerHTML = 'Select an order to see full details and update status.';
    orderDetail.classList.add('hidden');
    showMessage('Order deleted');
    await loadOrders();
    await loadStats();
  } catch (err) {
    showMessage(err.message || 'Delete failed');
  }
};

const deleteAllOrders = async () => {
  if (!window.confirm('Delete ALL orders from the database? This cannot be undone.')) return;
  try {
    const res = await fetchJson('/api/admin/orders/all', { method: 'DELETE', credentials: 'include' });
    selectedOrder = null;
    orderSummary.innerHTML = 'Select an order to see full details and update status.';
    orderDetail.classList.add('hidden');
    showMessage(`Deleted ${res.deletedCount ?? 0} orders`);
    await loadOrders();
    await loadStats();
  } catch (err) {
    showMessage(err.message || 'Delete failed');
  }
};

const loadInventory = async () => {
  products = await fetchJson('/api/products/all', { credentials: 'include' });
  inventoryGrid.innerHTML = products.map(product => {
    const lowStock = Object.values(product.sizes).some(x => x <= 2 && x >= 0);
    return `
      <div class="product-card" data-slug="${product.slug}">
        <div class="product-row">
          <div>
            <h3>${product.name}</h3>
            <div style="color:#94a3b8;font-size:.95rem;">${product.slug}</div>
          </div>
          <div style="display:flex;gap:.5rem;align-items:center;">
            <span class="badge ${product.active ? 'confirmed' : 'pending'}">${product.active ? 'Active' : 'Inactive'}</span>
          </div>
        </div>
        <div class="stock-grid">
          ${['S','M','L','XL','ONE SIZE'].map(size => `
            <div>
              <label style="font-size:.8rem;color:#94a3b8;">${size}</label>
              <input class="stock-input" data-size="${size}" value="${product.sizes[size] ?? 0}" type="number" min="0">
            </div>
          `).join('')}
        </div>
        <div class="product-actions">
          <label><input type="checkbox" ${product.active ? 'checked' : ''}> Active</label>
          <button class="save-product btn-small">Save</button>
          ${lowStock ? '<span style="color:#f87171;font-size:.9rem;">Low stock</span>' : ''}
        </div>
      </div>
    `;
  }).join('');

  inventoryGrid.querySelectorAll('.save-product').forEach(btn => {
    btn.addEventListener('click', async event => {
      try {
        const card = event.target.closest('.product-card');
        const slug = card.dataset.slug;
        const sizes = {};
        card.querySelectorAll('.stock-input').forEach(input => {
          if (input.dataset.size) sizes[input.dataset.size] = Number(input.value || 0);
        });
        const active = card.querySelector('input[type="checkbox"]').checked;
        const payload = { sizes, active };
        console.log('[admin] inventory save payload', slug, payload);
        await fetchJson(`/api/admin/products/${slug}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(payload)
        });
        showMessage('Product stock updated');
        await loadInventory();
      } catch (err) {
        console.error(err);
        showMessage(err.message || 'Unable to save inventory changes');
      }
    });
  });
};

const loadProducts = async () => {
  products = await fetchJson('/api/products/all', { credentials: 'include' });
  productsGrid.innerHTML = products.map((product, index) => {
    const imgs = Array.isArray(product.images) ? product.images : [];
    const galleryInputs = [0, 1, 2, 3].map(i => `
            <div>
              <label style="font-size:.8rem;color:#94a3b8;">Gallery ${i + 1} URL</label>
              <input class="stock-input product-gallery-url" data-slot="${i}" value="${escapeHtml(imgs[i] || '')}" placeholder="uploads/...">
            </div>`).join('');
    return `
    <div class="product-card" data-slug="${escapeHtml(product.slug)}" data-sort-order="${Number(product.sortOrder ?? 0)}">
      <div class="product-row">
        <div>
          <label style="font-size:.8rem;color:#94a3b8;">Name</label>
          <input class="stock-input product-name" value="${escapeHtml(product.name || '')}">
        </div>
        <div style="text-align:right;color:#94a3b8;font-size:.95rem;">Slug: ${escapeHtml(product.slug || '')}<br>Order: ${Number(product.sortOrder ?? 0)}</div>
      </div>
      <div class="stock-grid">
        <div>
          <label style="font-size:.8rem;color:#94a3b8;">Price</label>
          <input class="stock-input product-price" type="number" min="0" value="${product.price ?? 0}">
        </div>
        <div>
          <label style="font-size:.8rem;color:#94a3b8;">Tag</label>
          <input class="stock-input product-tag" value="${escapeHtml(product.tag || '')}">
        </div>
        <div>
          <label style="font-size:.8rem;color:#94a3b8;">Primary image URL</label>
          <input class="stock-input product-image" value="${escapeHtml(product.image || '')}">
        </div>
        <div>
          <label style="font-size:.8rem;color:#94a3b8;">Upload primary</label>
          <input class="stock-input product-image-file" type="file" accept="image/*">
        </div>
        ${galleryInputs}
        <div style="grid-column:1/-1;">
          <label style="font-size:.8rem;color:#94a3b8;">Upload gallery (max 4 files, replaces gallery URLs below)</label>
          <input class="stock-input product-gallery-files" type="file" accept="image/*" multiple>
        </div>
      </div>
      <div style="margin-top:1rem;">
        <label style="font-size:.8rem;color:#94a3b8;">Description</label>
        <textarea class="stock-input product-desc" style="height:5rem;">${escapeHtml(product.description || '')}</textarea>
      </div>
      <div class="product-actions">
        <button class="move-product btn-small" data-direction="up" ${index === 0 ? 'disabled style="opacity:.45;cursor:not-allowed;"' : ''}>↑</button>
        <button class="move-product btn-small" data-direction="down" ${index === products.length - 1 ? 'disabled style="opacity:.45;cursor:not-allowed;"' : ''}>↓</button>
        <label><input type="checkbox" class="product-active" ${product.active ? 'checked' : ''}> Active</label>
        <button class="save-product btn-small">Save</button>
        <button class="archive-product btn-small" style="background:#f59e0b;color:#111827;">Archive</button>
        <button class="delete-product btn-small" style="background:#b91c1c;">Delete</button>
      </div>
    </div>`;
  }).join('');

  productsGrid.querySelectorAll('.product-image-file').forEach(input => {
    input.addEventListener('change', async e => {
      const file = e.target.files?.[0];
      if (!file) return;
      const card = e.target.closest('.product-card');
      const slug = card.dataset.slug;
      const form = new FormData();
      form.append('image', file);
      try {
        const res = await fetch(`/api/admin/products/${encodeURIComponent(slug)}/image`, {
          method: 'POST',
          credentials: 'include',
          body: form
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.message || 'Upload failed');
        const updatedImage = body.product?.image ?? body.image ?? '';
        card.querySelector('.product-image').value = updatedImage;
        showMessage('Primary image uploaded');
        await loadProducts();
      } catch (err) {
        console.error(err);
        showMessage(err.message || 'Image upload failed');
      } finally {
        e.target.value = '';
      }
    });
  });

  productsGrid.querySelectorAll('.product-gallery-files').forEach(input => {
    input.addEventListener('change', async e => {
      const files = Array.from(e.target.files || []).slice(0, 4);
      if (!files.length) return;
      const card = e.target.closest('.product-card');
      const slug = card.dataset.slug;
      const form = new FormData();
      files.forEach(f => form.append('gallery', f));
      try {
        const res = await fetch(`/api/admin/products/${encodeURIComponent(slug)}/gallery`, {
          method: 'POST',
          credentials: 'include',
          body: form
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.message || 'Gallery upload failed');
        showMessage('Gallery images uploaded');
        await loadProducts();
      } catch (err) {
        console.error(err);
        showMessage(err.message || 'Gallery upload failed');
      } finally {
        e.target.value = '';
      }
    });
  });

  productsGrid.querySelectorAll('.save-product').forEach(btn => {
    btn.addEventListener('click', async event => {
      try {
        const card = event.target.closest('.product-card');
        const slug = card.dataset.slug;
        const galleryUrls = [0, 1, 2, 3].map(i => {
          const inp = card.querySelector(`.product-gallery-url[data-slot="${i}"]`);
          return inp ? inp.value.trim() : '';
        }).filter(Boolean);
        const payload = {
          name: card.querySelector('.product-name').value.trim(),
          price: Number(card.querySelector('.product-price').value),
          description: card.querySelector('.product-desc').value.trim(),
          tag: card.querySelector('.product-tag').value.trim(),
          image: card.querySelector('.product-image').value.trim(),
          images: galleryUrls.slice(0, 4),
          sortOrder: Number(card.dataset.sortOrder || 0),
          active: card.querySelector('.product-active').checked
        };
        console.log('[admin] products save payload', slug, payload);
        await fetchJson(`/api/admin/products/${encodeURIComponent(slug)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(payload)
        });
        showMessage('Product updated');
        await loadProducts();
        await loadInventory();
      } catch (err) {
        console.error(err);
        showMessage(err.message || 'Unable to save product changes');
      }
    });
  });

  productsGrid.querySelectorAll('.archive-product').forEach(btn => {
    btn.addEventListener('click', async event => {
      const card = event.target.closest('.product-card');
      const slug = card.dataset.slug;
      const name = card.querySelector('.product-name')?.value.trim() || slug;
      if (!window.confirm(`Archive ${name}? It will be hidden from the store but kept in the database.`)) return;
      try {
        await fetchJson(`/api/admin/products/${encodeURIComponent(slug)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ active: false })
        });
        showMessage('Product archived');
        await loadProducts();
        await loadInventory();
      } catch (err) {
        console.error(err);
        showMessage(err.message || 'Unable to archive product');
      }
    });
  });

  productsGrid.querySelectorAll('.delete-product').forEach(btn => {
    btn.addEventListener('click', async event => {
      const card = event.target.closest('.product-card');
      const slug = card.dataset.slug;
      const name = card.querySelector('.product-name')?.value.trim() || slug;
      if (!window.confirm(`Permanently delete ${name} from MongoDB? This cannot be undone.`)) return;
      try {
        await fetchJson(`/api/admin/products/${encodeURIComponent(slug)}`, {
          method: 'DELETE',
          credentials: 'include'
        });
        showMessage('Product deleted');
        await loadProducts();
        await loadInventory();
      } catch (err) {
        console.error(err);
        showMessage(err.message || 'Unable to delete product');
      }
    });
  });

  productsGrid.querySelectorAll('.move-product').forEach(btn => {
    btn.addEventListener('click', async event => {
      const card = event.target.closest('.product-card');
      const slug = card.dataset.slug;
      const direction = event.target.dataset.direction;
      try {
        await fetchJson(`/api/admin/products/${encodeURIComponent(slug)}/move`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ direction })
        });
        showMessage(direction === 'up' ? 'Product moved up' : 'Product moved down');
        await loadProducts();
        await loadInventory();
      } catch (err) {
        console.error(err);
        showMessage(err.message || 'Unable to reorder product');
      }
    });
  });
};

const createProduct = async () => {
  const payload = {
    name: document.getElementById('newProductName').value.trim(),
    price: Number(document.getElementById('newProductPrice').value),
    description: document.getElementById('newProductDescription').value.trim(),
    tag: document.getElementById('newProductTag').value.trim(),
    image: document.getElementById('newProductImage').value.trim(),
    active: document.getElementById('newProductActive').checked
  };
  if (!payload.name || !payload.price) {
    showMessage('Name and price are required');
    return;
  }
  await fetchJson('/api/admin/products', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload)
  });
  showMessage('Product created');
  document.getElementById('newProductName').value = '';
  document.getElementById('newProductPrice').value = '';
  document.getElementById('newProductDescription').value = '';
  document.getElementById('newProductTag').value = '';
  document.getElementById('newProductImage').value = '';
  document.getElementById('newProductActive').checked = true;
  productForm.classList.add('hidden');
  await loadProducts();
  await loadInventory();
};

const switchTab = tabName => {
  tabs.forEach(tab => tab.classList.toggle('active', tab.dataset.tab === tabName));
  ordersPanel.classList.toggle('hidden', tabName !== 'orders');
  inventoryPanel.classList.toggle('hidden', tabName !== 'inventory');
  productsPanel.classList.toggle('hidden', tabName !== 'products');
  analyticsPanel.classList.toggle('hidden', tabName !== 'analytics');
  promoCodesPanel.classList.toggle('hidden', tabName !== 'promocodes');
  subscribersPanel.classList.toggle('hidden', tabName !== 'subscribers');
  broadcastsPanel.classList.toggle('hidden', tabName !== 'broadcasts');
  if (tabName === 'analytics') loadAnalytics();
  if (tabName === 'subscribers') loadSubscribers();
};

const renderMetricCards = metrics => metrics.map(metric => `
  <div class="analytics-card">
    <span>${escapeHtml(metric.label)}</span>
    <strong>${metric.value}</strong>
  </div>
`).join('');

const normalizeWhatsAppPhone = value => {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('0')) return `234${digits.slice(1)}`;
  return digits;
};

const loadAnalytics = async () => {
  const selectedRange = analyticsRange?.value || 'today';
  const data = await fetchJson(`/api/admin/analytics?range=${encodeURIComponent(selectedRange)}`, { credentials: 'include' });
  analyticsOverview.innerHTML = renderMetricCards([
    { label: `${data.range?.label || 'Selected range'} visits`, value: data.overview.visits ?? 0 },
    { label: 'Unique visitors', value: data.overview.uniqueVisitors ?? 0 },
    { label: 'Total carts', value: data.overview.totalCarts ?? 0 },
    { label: 'Checkout clicks', value: data.overview.checkoutClicks ?? 0 },
    { label: 'Orders', value: data.overview.orders ?? 0 },
    { label: 'Sales revenue', value: formatPrice(data.overview.revenue ?? 0) }
  ]);

  const highlights = data.productHighlights || {};
  analyticsHighlights.innerHTML = renderMetricCards([
    { label: 'Best product', value: escapeHtml(highlights.bestProduct?.name || '—') },
    { label: 'Worst product', value: escapeHtml(highlights.worstProduct?.name || '—') },
    { label: 'Most viewed product', value: escapeHtml(highlights.mostViewedProduct?.name || '—') },
    { label: 'Most added-to-cart product', value: escapeHtml(highlights.mostAddedToCartProduct?.name || '—') }
  ]);

  analyticsProductsBody.innerHTML = (data.productPerformance || []).map(product => `
    <tr>
      <td>${escapeHtml(product.name || product.slug)}</td>
      <td>${product.productViews ?? 0}</td>
      <td>${product.addToCarts ?? 0}</td>
      <td>${product.unitsSold ?? 0}</td>
      <td>${formatPrice(product.revenue ?? 0)}</td>
      <td>${product.conversionRate ?? 0}%</td>
    </tr>
  `).join('') || '<tr><td colspan="6" style="color:#94a3b8;">No product activity yet.</td></tr>';

  const cartText = items => (items || []).map(item => `${item.name || item.id} × ${item.qty || 0}`).join(', ') || '—';
  analyticsCustomersBody.innerHTML = (data.customers || []).map(customer => `
    <tr>
      <td>${escapeHtml(customer.customer?.name || '—')}</td>
      <td>${escapeHtml(customer.customer?.phone || '—')}</td>
      <td>${escapeHtml(customer.customer?.email || '—')}</td>
      <td>${customer.lastActivityAt ? new Date(customer.lastActivityAt).toLocaleString() : '—'}</td>
      <td>${escapeHtml(cartText(customer.cartItems))}</td>
    </tr>
  `).join('') || '<tr><td colspan="5" style="color:#94a3b8;">No customer activity yet.</td></tr>';

  analyticsAbandonedBody.innerHTML = (data.abandonedCarts || []).map(cart => {
    const customer = cart.customer || {};
    const phone = normalizeWhatsAppPhone(customer.phone);
    const message = encodeURIComponent(`Hi ${customer.name || 'there'}, you left these in your KRO PK cart: ${cartText(cart.cartItems)}. Need help completing your order?`);
    return `
      <tr>
        <td>${escapeHtml(customer.name || '—')}<br><span style="color:#94a3b8;">${escapeHtml(customer.phone || customer.email || 'No contact yet')}</span></td>
        <td>${escapeHtml(cartText(cart.cartItems))}</td>
        <td>${cart.cartUpdatedAt ? new Date(cart.cartUpdatedAt).toLocaleString() : '—'}</td>
        <td>${phone ? `<button class="whatsapp-btn" data-wa-url="https://wa.me/${phone}?text=${message}">WhatsApp</button>` : 'No phone'}</td>
      </tr>
    `;
  }).join('') || '<tr><td colspan="4" style="color:#94a3b8;">No abandoned carts yet.</td></tr>';

  analyticsAbandonedBody.querySelectorAll('[data-wa-url]').forEach(button => {
    button.addEventListener('click', () => window.open(button.dataset.waUrl, '_blank', 'noopener'));
  });

  const traffic = data.traffic || {};
  const totalTraffic = Object.values(traffic).reduce((sum, value) => sum + Number(value || 0), 0) || 1;
  analyticsTraffic.innerHTML = ['instagram', 'tiktok', 'snapchat', 'whatsapp', 'direct'].map(source => {
    const visits = traffic[source] || 0;
    const pct = Math.round((visits / totalTraffic) * 100);
    return `
      <div class="traffic-row">
        <span>${source[0].toUpperCase() + source.slice(1)}</span>
        <div class="traffic-bar"><div class="traffic-fill" style="width:${pct}%"></div></div>
        <strong>${visits}</strong>
      </div>
    `;
  }).join('');
};

const loadPromoCodes = async () => {
  const codes = await fetchJson('/api/admin/promocodes', { credentials: 'include' });
  promoCodesGrid.innerHTML = codes.map(code => `
    <div class="product-card" data-id="${code._id}">
      <div class="product-row">
        <div>
          <label style="font-size:.8rem;color:#94a3b8;">Code</label>
          <input class="stock-input promo-code" value="${escapeHtml(code.code)}">
        </div>
        <div style="text-align:right;color:#94a3b8;font-size:.95rem;">${code.active ? 'Active' : 'Inactive'}</div>
      </div>
      <div class="stock-grid" style="margin-top:.75rem;">
        <div>
          <label style="font-size:.8rem;color:#94a3b8;">Discount %</label>
          <input class="stock-input promo-percent" type="number" min="1" max="100" value="${code.discountPercent ?? 0}">
        </div>
        <div style="display:flex;align-items:end;gap:.75rem;">
          <label style="display:inline-flex;align-items:center;gap:.5rem;">
            <input type="checkbox" class="promo-active" ${code.active ? 'checked' : ''}> Active
          </label>
        </div>
      </div>
      <div class="product-actions" style="margin-top:1rem;">
        <button class="btn-small promo-save">Save</button>
        <button class="btn-small promo-delete" style="background:#ef4444;">Delete</button>
      </div>
    </div>
  `).join('');

  promoCodesGrid.querySelectorAll('.promo-save').forEach(btn => {
    btn.addEventListener('click', async e => {
      const card = e.target.closest('.product-card');
      const id = card.dataset.id;
      const payload = {
        code: card.querySelector('.promo-code').value.trim(),
        discountPercent: Number(card.querySelector('.promo-percent').value),
        active: card.querySelector('.promo-active').checked
      };
      await fetchJson(`/api/admin/promocodes/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload)
      });
      showMessage('Promo code updated');
      await loadPromoCodes();
    });
  });

  promoCodesGrid.querySelectorAll('.promo-delete').forEach(btn => {
    btn.addEventListener('click', async e => {
      const card = e.target.closest('.product-card');
      const id = card.dataset.id;
      await fetchJson(`/api/admin/promocodes/${id}`, { method: 'DELETE', credentials: 'include' });
      showMessage('Promo code deleted');
      await loadPromoCodes();
    });
  });
};

const createPromoCode = async () => {
  const code = document.getElementById('newPromoCode').value.trim();
  const discountPercent = Number(document.getElementById('newPromoPercent').value);
  const active = document.getElementById('newPromoActive').checked;
  await fetchJson('/api/admin/promocodes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ code, discountPercent, active })
  });
  document.getElementById('newPromoCode').value = '';
  document.getElementById('newPromoPercent').value = '';
  document.getElementById('newPromoActive').checked = true;
  showMessage('Promo code created');
  await loadPromoCodes();
};

const loadBroadcasts = async () => {
  const broadcasts = await fetchJson('/api/admin/broadcasts', { credentials: 'include' });
  broadcastsGrid.innerHTML = broadcasts.map(b => `
    <div class="product-card">
      <div style="display:flex;justify-content:space-between;gap:1rem;flex-wrap:wrap;">
        <div style="font-weight:700;">${escapeHtml(b.subject)}</div>
        <div style="color:#94a3b8;font-size:.9rem;">${b.sentAt ? new Date(b.sentAt).toLocaleString() : 'Draft'}</div>
      </div>
      <div style="margin-top:.5rem;color:#94a3b8;font-size:.95rem;">Recipients: ${b.recipientCount ?? 0}</div>
    </div>
  `).join('') || '<div style="color:#94a3b8;">No broadcasts yet.</div>';
};

const exportAnalytics = format => {
  const selectedRange = analyticsRange?.value || 'today';
  window.location.href = `/api/admin/analytics/export.${format}?range=${encodeURIComponent(selectedRange)}`;
};

const formatSubscriberDate = value => {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-NG', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

const loadSubscribers = async () => {
  const subs = await fetchJson('/api/admin/subscribers', { credentials: 'include' });
  subscribersTotalCount.textContent = String(subs.length);
  subscribersBody.innerHTML = subs.map(sub => `
    <tr>
      <td>${escapeHtml(sub.name?.trim() || '—')}</td>
      <td>${escapeHtml(sub.email || '—')}</td>
      <td>${formatSubscriberDate(sub.createdAt)}</td>
    </tr>
  `).join('') || '<tr><td colspan="3" style="color:#94a3b8;">No subscribers yet.</td></tr>';
};

const updateSubscriberCount = async () => {
  try {
    const subs = await fetchJson('/api/admin/subscribers', { credentials: 'include' });
    subscriberCountLabel.textContent = `${subs.length} subscribers`;
    if (subscribersTotalCount) subscribersTotalCount.textContent = String(subs.length);
  } catch {
    subscriberCountLabel.textContent = '';
  }
};

const sendBroadcast = async () => {
  const subject = document.getElementById('broadcastSubject').value.trim();
  const body = document.getElementById('broadcastBody').value.trim();
  const res = await fetchJson('/api/admin/broadcasts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ subject, body })
  });
  showMessage(`Broadcast sent to ${res.recipientCount || 0}`);
  document.getElementById('broadcastSubject').value = '';
  document.getElementById('broadcastBody').value = '';
  await loadBroadcasts();
  await updateSubscriberCount();
  if (subscribersBody) await loadSubscribers();
};

const showMessage = msg => {
  const temp = document.createElement('div');
  temp.className = 'success-box';
  temp.textContent = msg;
  document.body.appendChild(temp);
  setTimeout(() => temp.remove(), 2200);
};

const logout = async () => {
  await fetch('/api/admin/logout', { method: 'POST' }).catch(() => {});
  window.location.href = '/admin/login';
};

statusFilter.addEventListener('change', loadOrders);
exportCsvBtn?.addEventListener('click', exportOrdersCsv);
deleteAllOrdersBtn?.addEventListener('click', () => deleteAllOrders().catch(err => showMessage(err.message)));
logoutBtn.addEventListener('click', logout);
tabs.forEach(tab => tab.addEventListener('click', () => switchTab(tab.dataset.tab)));
showAddProductBtn.addEventListener('click', () => productForm.classList.toggle('hidden'));
document.getElementById('createProductBtn').addEventListener('click', createProduct);
createPromoBtn?.addEventListener('click', () => createPromoCode().catch(err => showMessage(err.message)));
sendBroadcastBtn?.addEventListener('click', () => sendBroadcast().catch(err => showMessage(err.message)));
analyticsRange?.addEventListener('change', () => loadAnalytics().catch(err => showMessage(err.message)));
exportPdfBtn?.addEventListener('click', () => exportAnalytics('pdf'));
exportXlsxBtn?.addEventListener('click', () => exportAnalytics('xlsx'));
exportCsvBtnAnalytics?.addEventListener('click', () => exportAnalytics('csv'));

const init = async () => {
  try {
    await loadStats();
    await loadOrders();
    await loadInventory();
    await loadProducts();
    await loadPromoCodes();
    await loadBroadcasts();
    await updateSubscriberCount();
  } catch (err) {
    if (err.message.includes('Authentication')) {
      window.location.href = '/admin/login';
    } else {
      console.error(err);
      showMessage(err.message);
    }
  }
};

init();
