const CART_KEY = "kro_pk_cart";
const USER_KEY = "kro_pk_user";

let lastScrollY = window.scrollY;
let header = null;

function getCart() {
  try {
    return JSON.parse(localStorage.getItem(CART_KEY)) || [];
  } catch (err) {
    return [];
  }
}

function saveCart(cart) {
  try {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
  } catch (err) {
    showToast("Unable to save cart in this browser.");
    return;
  }
  window.KroAnalytics?.updateProfile({ cartItems: cart });
}

function trackEvent(type, payload = {}) {
  window.KroAnalytics?.track(type, payload);
}

function getUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY)) || null;
  } catch (err) {
    return null;
  }
}

function saveUser(user) {
  try {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch (err) {
    showToast("Unable to save account in this browser.");
  }
}

function logoutUser() {
  try {
    localStorage.removeItem(USER_KEY);
  } catch (err) {}
  updateHeader();
  showToast("Logged out successfully");
}

function formatPrice(value) {
  return "₦" + Number(value).toLocaleString("en-NG");
}

async function getProductBySlug(slug) {
  try {
    const response = await fetch(`/api/products/${encodeURIComponent(slug)}`, {
      cache: "no-store",
    });
    if (!response.ok) return null;
    return await response.json();
  } catch (err) {
    return null;
  }
}

function isSizeInStock(product, size) {
  if (!product || !product.active) return false;
  if (!product.sizes || typeof product.sizes !== "object") return false;
  return Number(product.sizes[size] || 0) > 0;
}

function setAddCartButtonState(isAvailable) {
  const button = document.querySelector(".add-cart-button");
  if (!button) return;
  button.disabled = !isAvailable;
  button.textContent = isAvailable ? "ADD TO CART" : "SOLD OUT";
  button.style.opacity = isAvailable ? "" : ".45";
  button.style.cursor = isAvailable ? "" : "not-allowed";
}

async function updateAddCartButtonState(slug, size) {
  const product = await getProductBySlug(slug);
  setAddCartButtonState(isSizeInStock(product, size));
}

function createToast() {
  let toast = document.getElementById("site-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "site-toast";
    toast.style.cssText =
      "position:fixed;right:1rem;bottom:1rem;z-index:9999;padding:1rem 1.5rem;border-radius:999px;background:rgba(15,23,42,0.96);color:#fff;font-family:Arial, sans-serif;font-size:0.95rem;box-shadow:0 16px 40px rgba(0,0,0,0.25);transform:translateX(120%);transition:transform 0.25s ease;";
    document.body.appendChild(toast);
  }
  return toast;
}

function showToast(message) {
  const toast = createToast();
  toast.textContent = message;
  toast.style.transform = "translateX(0)";
  clearTimeout(window._siteToastTimeout);
  window._siteToastTimeout = setTimeout(() => {
    toast.style.transform = "translateX(120%)";
  }, 1800);
}

function updateCartBadge() {
  const cart = getCart();
  const total = cart.reduce((sum, item) => sum + item.qty, 0);
  document.querySelectorAll(".cart-badge").forEach((el) => {
    el.textContent = total;
    el.style.display = total ? "inline-flex" : "none";
  });
}

async function addToCart(id, name, price, size = "L", img = "") {
  const product = await getProductBySlug(id);
  if (product && !isSizeInStock(product, size)) {
    showToast(`${product.name || "Product"} is out of stock in ${size}`);
    return;
  }

  const cart = getCart();
  const match = cart.find((item) => item.id === id && item.size === size);
  if (match) {
    match.qty += 1;
  } else {
    cart.push({ id, name, price: Number(price), size, qty: 1, img });
  }
  saveCart(cart);
  updateCartBadge();
  trackEvent("add_to_cart", {
    productSlug: id,
    productName: name,
    quantity: 1,
    cartCount: cart.reduce((sum, item) => sum + item.qty, 0),
  });
  showToast(`${name} added to cart.`);
}

function handleSubscribeForm(event) {
  const form = event.target;
  const email = form.querySelector('input[type="email"]')?.value?.trim();
  if (!email) {
    showToast("Please enter a valid email.");
    return;
  }
  showToast("Thanks! Check your inbox soon.");
}

function updateHeader() {
  const user = getUser();
  const actions = document.querySelector(".site-actions");
  if (!actions) return;

  const existingLogin = actions.querySelector(".login-link, .account-link");
  if (existingLogin) existingLogin.remove();

  if (user) {
    const accountLink = document.createElement("a");
    accountLink.className = "account-link";
    accountLink.href = "#";
    accountLink.textContent = `Hi ${user.name}`;
    accountLink.onclick = (e) => {
      e.preventDefault();
      showAccountMenu();
    };
    actions.appendChild(accountLink);
  } else {
    const loginLink = document.createElement("a");
    loginLink.className = "login-link";
    loginLink.href = "#";
    loginLink.textContent = "LOGIN";
    loginLink.onclick = (e) => {
      e.preventDefault();
      showLoginModal();
    };
    actions.appendChild(loginLink);
  }
}

function showLoginModal() {
  const modal = document.createElement("div");
  modal.style.cssText =
    "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.8);z-index:10000;display:flex;align-items:center;justify-content:center;";
  modal.innerHTML = `
        <div style="background:var(--navy);padding:2rem;border:3px solid var(--white);border-radius:12px;max-width:400px;width:90%;position:relative;">
            <button onclick="this.parentElement.parentElement.remove()" style="position:absolute;top:10px;right:10px;background:none;border:none;color:var(--white);font-size:1.5rem;cursor:pointer;">×</button>
            <h2 style="font-family:Bangers;color:var(--yellow);text-align:center;margin-bottom:1rem;">LOGIN / SIGN UP</h2>
            <form id="login-form" style="display:flex;flex-direction:column;gap:1rem;">
                <input type="text" id="user-name" placeholder="Name" style="padding:0.8rem;border:2px solid #334155;background:var(--navy);color:var(--white);font-family:Comic Neue;">
                <input type="email" id="user-email" placeholder="Email" style="padding:0.8rem;border:2px solid #334155;background:var(--navy);color:var(--white);font-family:Comic Neue;">
                <input type="password" id="user-password" placeholder="Password" style="padding:0.8rem;border:2px solid #334155;background:var(--navy);color:var(--white);font-family:Comic Neue;">
                <button type="submit" style="background:var(--red);color:var(--white);border:2px solid var(--white);padding:1rem;font-family:Bangers;cursor:pointer;">LOGIN / SIGN UP</button>
            </form>
        </div>
    `;
  document.body.appendChild(modal);

  document.getElementById("login-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = document.getElementById("user-name").value.trim();
    const email = document.getElementById("user-email").value.trim();
    const password = document.getElementById("user-password").value.trim();

    if (!name || !email || !password) {
      showToast("Fill all fields");
      return;
    }

    // Never store a password — only persist display name and email
    const user = { name, email };
    saveUser(user);
    modal.remove();
    updateHeader();
    showToast(`Welcome ${name}!`);
  });
}

function showAccountMenu() {
  const accountLink = document.querySelector(".account-link");
  if (!accountLink) return;

  // Toggle: close the menu if it is already open
  const existingMenu = accountLink.querySelector("div[data-account-menu]");
  if (existingMenu) {
    existingMenu.remove();
    return;
  }

  const menu = document.createElement("div");
  menu.dataset.accountMenu = "1";
  menu.style.cssText =
    "position:absolute;top:100%;right:0;background:var(--navy);border:2px solid var(--white);border-radius:8px;padding:1rem;z-index:10001;min-width:150px;";
  menu.innerHTML = `
        <div style="margin-bottom:0.5rem;font-family:Comic Neue;color:var(--white);">Account</div>
        <button onclick="logoutUser(); this.parentElement.remove();" style="background:none;border:none;color:var(--yellow);cursor:pointer;font-family:Comic Neue;width:100%;text-align:left;">Logout</button>
    `;
  accountLink.appendChild(menu);

  setTimeout(() => {
    document.addEventListener("click", function removeMenu(e) {
      if (!menu.contains(e.target)) {
        menu.remove();
        document.removeEventListener("click", removeMenu);
      }
    });
  }, 10);
}

function handleScroll() {
  if (!header) header = document.querySelector(".site-header");
  if (!header) return;

  const currentScrollY = window.scrollY;
  if (currentScrollY > lastScrollY && currentScrollY > 100) {
    header.classList.add("hidden");
  } else {
    header.classList.remove("hidden");
  }
  lastScrollY = currentScrollY;
}

document.addEventListener("DOMContentLoaded", () => {
  updateCartBadge();
  if (!document.body.classList.contains("product-page")) {
    updateHeader();
  }
  document.querySelectorAll("form[data-subscribe-form]").forEach((form) => {
    form.addEventListener("submit", handleSubscribeForm);
  });

  window.addEventListener("scroll", handleScroll);
});
