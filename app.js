let products = [];
const productGrid = document.querySelector("#product-grid");
const cartDrawer = document.querySelector(".cart-drawer");
const overlay = document.querySelector(".overlay");
const toast = document.querySelector(".toast");
const cartItems = document.querySelector(".cart-items");
let activeCategory = "All";
let cart = readCart();
let toastTimer;
const FREE_SHIPPING_THRESHOLD = 1000;

function readCart() {
  try {
    const currentCart = localStorage.getItem("bongonari-cart");
    const legacyCart = currentCart === null ? localStorage.getItem("sunday-supply-cart") : null;
    const saved = JSON.parse(currentCart ?? legacyCart ?? "[]");
    if (legacyCart !== null) {
      localStorage.setItem("bongonari-cart", legacyCart);
      localStorage.removeItem("sunday-supply-cart");
    }
    return Array.isArray(saved)
      ? saved.filter((item) => typeof item.id === "string" && Number.isInteger(item.quantity) && item.quantity > 0)
      : [];
  } catch (error) {
    console.warn("Could not restore the saved Bongonari shopping bag.", error);
    return [];
  }
}

function saveCart() {
  try {
    localStorage.setItem("bongonari-cart", JSON.stringify(cart));
  } catch (error) {
    console.warn("Could not save the Bongonari shopping bag.", error);
  }
}

function formatPrice(price) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(price);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

async function loadProducts() {
  try {
    const [productsResponse, categoriesResponse] = await Promise.all([
      fetch("/api/products"),
      fetch("/api/categories"),
    ]);
    if (!productsResponse.ok) throw new Error(`Store products could not be loaded (HTTP ${productsResponse.status}).`);
    if (!categoriesResponse.ok) throw new Error(`Product categories could not be loaded (HTTP ${categoriesResponse.status}).`);
    const result = await productsResponse.json();
    const categories = await categoriesResponse.json();
    if (!Array.isArray(result) || !Array.isArray(categories) || categories.some((category) => typeof category !== "string")) {
      throw new Error("The product catalog response was invalid.");
    }
    renderCategoryButtons(categories);
    products = result;
    cart = cart.filter((item) => products.some((product) => product.id === item.id));
    saveCart();
    renderProducts();
    renderCart();
  } catch (error) {
    console.error("Could not load the product catalog.", error);
    productGrid.innerHTML = '<p class="empty-results">We couldn’t load the collection. Please refresh the page to try again.</p>';
  }
}

function renderCategoryButtons(categories) {
  const tabs = document.querySelector(".category-tabs");
  const buttons = ["All", ...categories].map((category) => {
    const button = document.createElement("button");
    button.className = `category-button${category === activeCategory ? " selected" : ""}`;
    button.dataset.category = category;
    button.textContent = category === "All" ? "All things" : category;
    return button;
  });
  tabs.replaceChildren(...buttons);
}

function renderProducts() {
  const sortBy = document.querySelector("#sort-select").value;
  const query = document.querySelector("#product-search").value.trim().toLowerCase();
  let visibleProducts = products.filter((product) => {
    const matchesCategory = activeCategory === "All" || product.category === activeCategory;
    const matchesSearch = !query || `${product.name} ${product.category} ${product.detail}`.toLowerCase().includes(query);
    return matchesCategory && matchesSearch;
  });
  if (sortBy === "price-low") visibleProducts.sort((a, b) => a.price - b.price);
  if (sortBy === "price-high") visibleProducts.sort((a, b) => b.price - a.price);
  if (sortBy === "name") visibleProducts.sort((a, b) => a.name.localeCompare(b.name));
  productGrid.innerHTML = visibleProducts.length
    ? visibleProducts.map((product) => `
      <article class="product-card">
        <div class="product-image-wrap">
          <img class="product-image" src="${escapeHtml(product.image)}" alt="${escapeHtml(product.name)}" loading="lazy" style="object-position:${escapeHtml(product.position)}" />
          ${product.badge ? `<span class="product-badge">${escapeHtml(product.badge)}</span>` : ""}
          <button class="quick-add" data-add="${escapeHtml(product.id)}" aria-label="Add ${escapeHtml(product.name)} to bag">Add to bag <span aria-hidden="true">+</span></button>
        </div>
        <div class="product-info">
          <p class="product-category">${escapeHtml(product.category)}</p>
          <div class="product-name-row"><h3 class="product-name">${escapeHtml(product.name)}</h3><span class="product-price">${formatPrice(product.price)}</span></div>
          <p class="product-detail">${escapeHtml(product.detail)}</p>
        </div>
      </article>`).join("")
    : '<p class="empty-results">Nothing here just yet. Try another category.</p>';
}

function renderCart() {
  const count = cart.reduce((sum, item) => sum + item.quantity, 0);
  const subtotal = cart.reduce((sum, item) => {
    const product = products.find((entry) => entry.id === item.id);
    return sum + (product?.price ?? 0) * item.quantity;
  }, 0);
  document.querySelector(".cart-count").textContent = count;
  document.querySelector(".drawer-count").textContent = `(${count})`;
  document.querySelector(".cart-subtotal").textContent = formatPrice(subtotal);
  cartDrawer.classList.toggle("is-empty", cart.length === 0);
  cartItems.innerHTML = cart.map((item) => {
    const product = products.find((entry) => entry.id === item.id);
    if (!product) return "";
    return `<article class="cart-line">
      <img src="${escapeHtml(product.image)}" alt="" />
      <div class="cart-line-info"><strong>${escapeHtml(product.name)}</strong><small>${formatPrice(product.price)}</small>
        <div class="quantity-control" aria-label="Quantity for ${escapeHtml(product.name)}">
          <button data-quantity="${escapeHtml(product.id)}" data-change="-1" aria-label="Remove one ${escapeHtml(product.name)}">−</button>
          <span>${item.quantity}</span>
          <button data-quantity="${escapeHtml(product.id)}" data-change="1" aria-label="Add one ${escapeHtml(product.name)}">+</button>
        </div>
      </div>
      <div class="cart-line-end"><strong>${formatPrice(product.price * item.quantity)}</strong><button class="remove-item" data-remove="${escapeHtml(product.id)}">Remove</button></div>
    </article>`;
  }).join("");
  const shippingProgress = Math.min((subtotal / FREE_SHIPPING_THRESHOLD) * 100, 100);
  document.querySelector(".progress-track span").style.width = `${shippingProgress}%`;
  document.querySelector(".shipping-message").textContent = subtotal >= FREE_SHIPPING_THRESHOLD
    ? "You've unlocked complimentary shipping!"
    : `Add ${formatPrice(FREE_SHIPPING_THRESHOLD - subtotal)} more for complimentary shipping.`;
}

function updateCart(id, change = 1) {
  const item = cart.find((entry) => entry.id === id);
  if (item) {
    item.quantity += change;
    if (item.quantity <= 0) cart = cart.filter((entry) => entry.id !== id);
  } else if (change > 0) {
    if (!products.some((product) => product.id === id)) return;
    cart.push({ id, quantity: change });
  }
  saveCart();
  renderCart();
}

function setCartOpen(open) {
  cartDrawer.classList.toggle("open", open);
  cartDrawer.setAttribute("aria-hidden", String(!open));
  overlay.hidden = !open;
  document.body.classList.toggle("cart-open", open);
  if (open) requestAnimationFrame(() => overlay.classList.add("visible"));
  else overlay.classList.remove("visible");
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("show"), 2300);
}

productGrid.addEventListener("click", (event) => {
  const button = event.target.closest("[data-add]");
  if (!button) return;
  const product = products.find((item) => item.id === button.dataset.add);
  if (!product) return;
  updateCart(product.id);
  showToast(`${product.name} added to your bag`);
});

cartItems.addEventListener("click", (event) => {
  const quantityButton = event.target.closest("[data-quantity]");
  const removeButton = event.target.closest("[data-remove]");
  if (quantityButton) updateCart(quantityButton.dataset.quantity, Number(quantityButton.dataset.change));
  if (removeButton) updateCart(removeButton.dataset.remove, -cart.find((item) => item.id === removeButton.dataset.remove).quantity);
});

document.querySelector(".category-tabs").addEventListener("click", (event) => {
  const button = event.target.closest("[data-category]");
  if (!button) return;
  activeCategory = button.dataset.category;
  document.querySelectorAll(".category-button").forEach((tab) => tab.classList.toggle("selected", tab === button));
  document.querySelectorAll(".nav-link").forEach((link) => link.classList.toggle("active", link.dataset.categoryLink === activeCategory));
  renderProducts();
});
document.querySelector("#sort-select").addEventListener("change", renderProducts);
document.querySelectorAll("[data-category-link]").forEach((link) => {
  link.addEventListener("click", () => {
    activeCategory = link.dataset.categoryLink;
    document.querySelectorAll(".category-button").forEach((tab) => tab.classList.toggle("selected", tab.dataset.category === activeCategory));
    document.querySelectorAll(".nav-link").forEach((navLink) => navLink.classList.toggle("active", navLink === link));
    renderProducts();
  });
});
document.querySelector(".cart-trigger").addEventListener("click", () => setCartOpen(true));
document.querySelector(".close-cart").addEventListener("click", () => setCartOpen(false));
overlay.addEventListener("click", () => setCartOpen(false));
document.querySelector(".continue-shopping").addEventListener("click", () => setCartOpen(false));
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") setCartOpen(false);
});

const menuToggle = document.querySelector(".menu-toggle");
menuToggle.addEventListener("click", () => {
  const isOpen = document.querySelector(".main-nav").classList.toggle("open");
  menuToggle.setAttribute("aria-expanded", String(isOpen));
});
document.querySelectorAll(".main-nav a").forEach((link) => link.addEventListener("click", () => {
  document.querySelector(".main-nav").classList.remove("open");
  menuToggle.setAttribute("aria-expanded", "false");
}));

document.querySelector("#product-search").addEventListener("input", renderProducts);
document.querySelector(".search-toggle").addEventListener("click", () => {
  document.querySelector("#shop").scrollIntoView({ behavior: "smooth" });
  document.querySelector("#product-search").focus({ preventScroll: true });
});

document.querySelector(".newsletter-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const emailInput = document.querySelector("#newsletter-email");
  document.querySelector(".newsletter-message").textContent = `You're on the list. Keep an eye on ${emailInput.value}.`;
  emailInput.value = "";
});
document.querySelector(".checkout-button").addEventListener("click", () => showToast("Checkout is coming soon. Your bag is saved."));

loadProducts();
