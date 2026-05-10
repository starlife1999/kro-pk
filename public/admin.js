const orderBody = document.getElementById('ordersBody');
const orderDetail = document.getElementById('orderDetail');
const orderSummary = document.getElementById('orderSummary');
const statusFilter = document.getElementById('orderStatusFilter');
const tabs = document.querySelectorAll('.tab');
const ordersPanel = document.getElementById('ordersPanel');
const inventoryPanel = document.getElementById('inventoryPanel');
const inventoryGrid = document.getElementById('inventoryGrid');
const productsPanel = document.getElementById('productsPanel');
const productsGrid = document.getElementById('productsGrid');
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
  const res = await fetch(url, options);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || 'Request failed');
  }
  return res.json();
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

const showOrderDetails = async id => {
  selectedOrder = await fetchJson(`/api/admin/orders/${id}`);
  const itemsHtml = selectedOrder.items.map(item => `<li>${item.name} / ${item.size} × ${item.qty} = ${formatPrice(item.price)}</li>`).join('');
  orderDetail.classList.remove('hidden');
  orderSummary.innerHTML = `
    <div><strong>Order</strong>: ${selectedOrder.orderNumber}</div>
    <div><strong>Status</strong>: <span class="badge ${selectedOrder.status}">${selectedOrder.status}</span></div>
    <div><strong>Customer</strong>: ${selectedOrder.customer.name}</div>
    <div><strong>Phone</strong>: ${selectedOrder.customer.phone}</div>
    <div><strong>Delivery</strong>: ${selectedOrder.customer.address}, ${selectedOrder.customer.city}, ${selectedOrder.customer.state}</div>
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
    </div>
  `;
  document.getElementById('statusSelect').value = selectedOrder.status;
  document.getElementById('saveStatusBtn').addEventListener('click', saveOrderStatus);
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

  document.querySelectorAll('.save-product').forEach(btn => {
    btn.addEventListener('click', async event => {
      const card = event.target.closest('.product-card');
      const slug = card.dataset.slug;
      const sizes = {};
      card.querySelectorAll('.stock-input').forEach(input => {
        if (input.dataset.size) sizes[input.dataset.size] = Number(input.value || 0);
      });
      const active = card.querySelector('input[type="checkbox"]').checked;
      await fetchJson(`/api/admin/products/${slug}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ sizes, active })
      });
      showMessage('Product stock updated');
      await loadInventory();
    });
  });
};

const loadProducts = async () => {
  products = await fetchJson('/api/products/all', { credentials: 'include' });
  productsGrid.innerHTML = products.map(product => `
    <div class="product-card" data-slug="${product.slug}">
      <div class="product-row">
        <div>
          <label style="font-size:.8rem;color:#94a3b8;">Name</label>
          <input class="stock-input product-name" value="${escapeHtml(product.name || '')}">
        </div>
        <div style="text-align:right;color:#94a3b8;font-size:.95rem;">Slug: ${escapeHtml(product.slug || '')}</div>
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
          <label style="font-size:.8rem;color:#94a3b8;">Image</label>
          <input class="stock-input product-image" value="${escapeHtml(product.image || '')}">
        </div>
      </div>
      <div style="margin-top:1rem;">
        <label style="font-size:.8rem;color:#94a3b8;">Description</label>
        <textarea class="stock-input product-desc" style="height:5rem;">${escapeHtml(product.description || '')}</textarea>
      </div>
      <div class="product-actions">
        <label><input type="checkbox" class="product-active" ${product.active ? 'checked' : ''}> Active</label>
        <button class="save-product btn-small">Save</button>
      </div>
    </div>
  `).join('');

  document.querySelectorAll('.save-product').forEach(btn => {
    btn.addEventListener('click', async event => {
      const card = event.target.closest('.product-card');
      const slug = card.dataset.slug;
      const payload = {
        name: card.querySelector('.product-name').value.trim(),
        price: Number(card.querySelector('.product-price').value),
        description: card.querySelector('.product-desc').value.trim(),
        tag: card.querySelector('.product-tag').value.trim(),
        image: card.querySelector('.product-image').value.trim(),
        active: card.querySelector('.product-active').checked
      };
      await fetchJson(`/api/admin/products/${slug}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload)
      });
      showMessage('Product updated');
      await loadProducts();
      await loadInventory();
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
logoutBtn.addEventListener('click', logout);
tabs.forEach(tab => tab.addEventListener('click', () => switchTab(tab.dataset.tab)));
showAddProductBtn.addEventListener('click', () => productForm.classList.toggle('hidden'));
document.getElementById('createProductBtn').addEventListener('click', createProduct);

const init = async () => {
  try {
    await loadStats();
    await loadOrders();
    await loadInventory();
    await loadProducts();
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
