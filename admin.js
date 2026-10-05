"use strict";

const setupPanel = document.querySelector("#setup-panel");
const loginPanel = document.querySelector("#login-panel");
const dashboard = document.querySelector("#dashboard");
const ownerWorkspace = document.querySelector("#owner-workspace");
const productManager = document.querySelector("#product-manager");
const editorCard = document.querySelector("#editor-card");
const productImageInput = document.querySelector("#product-image");
const productImagePreview = document.querySelector("#product-image-preview");
const MAX_PRODUCT_IMAGE_BYTES = 5 * 1024 * 1024;
let currentUser = null;
let products = [];
let editingId = null;
let productImagePreviewUrl = null;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function setMessage(elementId, message = "", isError = false) {
  const element = document.querySelector(`#${elementId}`);
  element.textContent = message;
  element.classList.toggle("error", isError);
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error("The server returned an unreadable response. Please try again.");
  }
  if (!response.ok) throw new Error(payload.error || "The request could not be completed.");
  return payload;
}

function showWorkspace(user) {
  currentUser = user;
  setupPanel.hidden = true;
  loginPanel.hidden = true;
  dashboard.hidden = false;
  document.querySelector("#account-role").textContent = user.role === "owner" ? "owner" : "developer";
  document.querySelector("#account-identity").textContent = `Signed in as ${user.username} · ${user.role === "owner" ? "Website Owner" : "Dev"}`;
  ownerWorkspace.hidden = user.role !== "owner";
  document.querySelector("#dev-notice").hidden = user.role !== "dev";
  if (user.role === "owner") {
    loadProducts().catch((error) => setMessage("manager-message", error.message, true));
  }
}

function showDevTemporaryPassword(password) {
  document.querySelector("#dev-temporary-password").textContent = password;
  document.querySelector("#dev-credentials").hidden = false;
}

function showSignedOut(setupRequired) {
  currentUser = null;
  dashboard.hidden = true;
  setupPanel.hidden = !setupRequired;
  loginPanel.hidden = setupRequired;
  ownerWorkspace.hidden = true;
  document.querySelector("#dev-credentials").hidden = true;
  document.querySelector("#dev-temporary-password").textContent = "";
}

async function refreshStatus() {
  const status = await request("/api/status");
  if (status.user) showWorkspace(status.user);
  else showSignedOut(status.setupRequired);
}

async function loadProducts() {
  setMessage("manager-message");
  const [loadedProducts, categories] = await Promise.all([
    request("/api/products"),
    request("/api/categories"),
  ]);
  if (!Array.isArray(loadedProducts) || !Array.isArray(categories) || categories.some((category) => typeof category !== "string")) {
    throw new Error("The product catalog response was invalid.");
  }
  products = loadedProducts;
  const categorySelect = document.querySelector("#product-category");
  categorySelect.replaceChildren(...categories.map((category) => new Option(category, category)));
  renderProductManager();
}

function renderProductManager() {
  productManager.innerHTML = products.length
    ? products.map((product) => `
      <article class="managed-product">
        <img src="${escapeHtml(product.image)}" alt="" />
        <div class="managed-product-info">
          <h3>${escapeHtml(product.name)}</h3>
          <p>${escapeHtml(product.category)} · ${escapeHtml(product.id)}</p>
        </div>
        <strong class="managed-product-price">${new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(product.price)}</strong>
        <button class="text-link" type="button" data-edit="${escapeHtml(product.id)}" aria-label="Edit ${escapeHtml(product.name)}">Edit <span aria-hidden="true">↗</span></button>
      </article>`).join("")
    : '<p class="form-hint">There are no products yet. Add the first one above.</p>';
}

function openEditor(product = null) {
  editingId = product?.id ?? null;
  const form = document.querySelector("#product-form");
  form.reset();
  productImageInput.setCustomValidity("");
  productImageInput.required = !product;
  if (productImagePreviewUrl) URL.revokeObjectURL(productImagePreviewUrl);
  productImagePreviewUrl = null;
  productImagePreview.hidden = Boolean(!product);
  if (product) productImagePreview.src = product.image;
  else productImagePreview.removeAttribute("src");
  document.querySelector("#editor-eyebrow").textContent = product ? "A LITTLE REFRESH" : "NEW TO THE SHELF";
  document.querySelector("#editor-title").textContent = product ? "Update this product." : "Add a product.";
  document.querySelector("#save-product").innerHTML = product
    ? 'Save changes <span aria-hidden="true">↗</span>'
    : 'Save product <span aria-hidden="true">↗</span>';
  const idInput = document.querySelector("#product-id");
  idInput.disabled = Boolean(product);
  if (product) {
    form.elements.id.value = product.id;
    form.elements.name.value = product.name;
    form.elements.category.value = product.category;
    form.elements.detail.value = product.detail;
    form.elements.price.value = product.price;
    form.elements.badge.value = product.badge;
    form.elements.position.value = product.position;
  } else {
    form.elements.position.value = "center";
  }
  setMessage("product-message");
  editorCard.hidden = false;
  editorCard.scrollIntoView({ behavior: "smooth", block: "start" });
  form.elements.name.focus({ preventScroll: true });
}

function closeEditor() {
  editorCard.hidden = true;
  editingId = null;
  document.querySelector("#product-form").reset();
  productImageInput.setCustomValidity("");
  if (productImagePreviewUrl) URL.revokeObjectURL(productImagePreviewUrl);
  productImagePreviewUrl = null;
  productImagePreview.removeAttribute("src");
  productImagePreview.hidden = true;
}

productImageInput.addEventListener("change", () => {
  const file = productImageInput.files[0];
  productImageInput.setCustomValidity("");
  setMessage("product-message");
  if (productImagePreviewUrl) URL.revokeObjectURL(productImagePreviewUrl);
  productImagePreviewUrl = null;
  if (!file) {
    const product = products.find((entry) => entry.id === editingId);
    productImagePreview.hidden = !product;
    if (product) productImagePreview.src = product.image;
    else productImagePreview.removeAttribute("src");
    return;
  }
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    productImageInput.setCustomValidity("Choose a JPEG, PNG, or WebP picture.");
    setMessage("product-message", "Choose a JPEG, PNG, or WebP picture.", true);
    productImageInput.reportValidity();
    return;
  }
  if (file.size > MAX_PRODUCT_IMAGE_BYTES) {
    productImageInput.setCustomValidity("Product pictures must be 5 MB or smaller.");
    setMessage("product-message", "Product pictures must be 5 MB or smaller.", true);
    productImageInput.reportValidity();
    return;
  }
  productImagePreviewUrl = URL.createObjectURL(file);
  productImagePreview.src = productImagePreviewUrl;
  productImagePreview.hidden = false;
});

document.querySelector("#setup-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  setMessage("setup-message");
  try {
    const body = Object.fromEntries(new FormData(form));
    const result = await request("/api/setup", { method: "POST", body: JSON.stringify(body) });
    form.reset();
    showWorkspace(result.user);
    showDevTemporaryPassword(result.devTemporaryPassword);
  } catch (error) {
    setMessage("setup-message", error.message, true);
  }
});

document.querySelector("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  setMessage("login-message");
  try {
    const result = await request("/api/login", {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(new FormData(form))),
    });
    form.reset();
    showWorkspace(result.user);
  } catch (error) {
    setMessage("login-message", error.message, true);
  }
});

document.querySelector("#signout-button").addEventListener("click", async () => {
  try {
    const username = currentUser.username;
    await request("/api/logout", { method: "POST", body: "{}" });
    showSignedOut(false);
    document.querySelector("#username").value = username;
    document.querySelector("#login-password").value = "";
    document.querySelector("#login-password").focus();
  } catch (error) {
    setMessage("login-message", error.message, true);
  }
});

document.querySelector("#copy-dev-password").addEventListener("click", async () => {
  const password = document.querySelector("#dev-temporary-password").textContent;
  try {
    await navigator.clipboard.writeText(password);
    setMessage("dev-password-message", "Copied. Save this password before leaving or refreshing the page.");
  } catch {
    setMessage("dev-password-message", "Copy was blocked. Select the password above and copy it before leaving or refreshing the page.", true);
  }
});

document.querySelector("#password-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  setMessage("password-message");
  try {
    await request("/api/account/password", {
      method: "POST",
      body: JSON.stringify({
        currentPassword: document.querySelector("#current-password").value,
        newPassword: document.querySelector("#new-password").value,
      }),
    });
    form.reset();
    setMessage("password-message", "Your password has been updated.");
  } catch (error) {
    setMessage("password-message", error.message, true);
  }
});

document.querySelector("#product-manager").addEventListener("click", (event) => {
  const button = event.target.closest("[data-edit]");
  if (button) openEditor(products.find((product) => product.id === button.dataset.edit));
});
document.querySelector("#new-product-button").addEventListener("click", () => openEditor());
document.querySelector("#cancel-edit").addEventListener("click", closeEditor);
document.querySelector("#cancel-edit-text").addEventListener("click", closeEditor);

document.querySelector("#product-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const isEditing = editingId !== null;
  setMessage("product-message");
  const selectedImage = productImageInput.files[0];
  const product = products.find((entry) => entry.id === editingId);
  const body = {
    name: form.elements.name.value.trim(),
    category: form.elements.category.value,
    detail: form.elements.detail.value.trim(),
    price: form.elements.price.valueAsNumber,
    badge: form.elements.badge.value.trim(),
    image: product?.image ?? "",
    position: form.elements.position.value.trim(),
  };
  try {
    if (selectedImage) {
      setMessage("product-message", "Uploading product picture…");
      const upload = await request("/api/product-images", {
        method: "POST",
        body: selectedImage,
        headers: { "Content-Type": selectedImage.type },
      });
      body.image = upload.image;
    }
    const savedProduct = await request(isEditing ? `/api/products/${encodeURIComponent(editingId)}` : "/api/products", {
      method: isEditing ? "PUT" : "POST",
      body: JSON.stringify(body),
    });
    closeEditor();
    await loadProducts();
    setMessage("manager-message", isEditing ? "Product updated." : `Product added. Product ID: ${savedProduct.id}`);
  } catch (error) {
    setMessage("product-message", error.message, true);
  }
});

refreshStatus().catch((error) => {
  showSignedOut(false);
  setMessage("login-message", error.message, true);
});
