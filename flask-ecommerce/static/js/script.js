/**
 * ShopHub — script.js  (fixed + enhanced)
 *
 * KEY FIXES vs original:
 *  1. Cart is owned entirely by JS sessionStorage — no Flask session cart.
 *     addToCart sends current_cart_qty so the server can validate stock.
 *  2. handleCheckout sends the full cart object in the POST body,
 *     so checkout works even after a server restart (session no longer needed).
 *  3. Currency: products.json prices are in USD → display in INR via × 83.
 *     Order totals from server are also USD → × 83 for display. Consistent.
 *  4. initCartPage awaits loadProducts before displaying cart (was a race condition).
 *  5. initCheckoutPage same fix.
 *  6. clearSearch now re-displays all products correctly.
 *  7. Orders page: reversed chronologically, shows correct INR totals.
 */

let allProducts = [];
let cart        = {};
let currentPage = 'home';

// ── CURRENCY ────────────────────────────────────────────────────────────────
const INR_RATE = 83; // 1 USD → INR (adjust if needed)

function usdToInr(usd) { return usd * INR_RATE; }

function formatINR(amount) {
    return '₹' + Number(amount).toLocaleString('en-IN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

// ── INIT ────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    detectCurrentPage();
    initializePage();
    updateCartCount();
    initNavbarScroll();
    initSmoothScroll();
});

function detectCurrentPage() {
    const path = window.location.pathname;
    if      (path.includes('products'))  currentPage = 'products';
    else if (path.includes('cart'))      currentPage = 'cart';
    else if (path.includes('checkout')) currentPage = 'checkout';
    else if (path.includes('orders'))   currentPage = 'orders';
    else                                currentPage = 'home';
}

function initializePage() {
    switch (currentPage) {
        case 'products': initProductsPage(); break;
        case 'cart':     initCartPage();     break;
        case 'checkout': initCheckoutPage(); break;
        case 'orders':   initOrdersPage();   break;
        case 'home':     initHomePage();     break;
    }
}

// ── NAVBAR ──────────────────────────────────────────────────────────────────
function initNavbarScroll() {
    const nav = document.querySelector('.navbar');
    if (nav) window.addEventListener('scroll', () =>
        nav.classList.toggle('scrolled', window.scrollY > 50));
}

function initSmoothScroll() {
    document.querySelectorAll('a[href^="#"]').forEach(a =>
        a.addEventListener('click', function (e) {
            const href = this.getAttribute('href');
            if (href && href !== '#') {
                e.preventDefault();
                document.querySelector(href)?.scrollIntoView({ behavior: 'smooth' });
            }
        })
    );
}

// ── CART STORAGE ────────────────────────────────────────────────────────────
function loadCart() {
    try { cart = JSON.parse(sessionStorage.getItem('shophub_cart') || '{}'); }
    catch { cart = {}; }
    return cart;
}

function saveCart() {
    sessionStorage.setItem('shophub_cart', JSON.stringify(cart));
}

function updateCartCount() {
    loadCart();
    const count = Object.values(cart).reduce((s, q) => s + q, 0);
    document.querySelectorAll('#cart-count').forEach(el => el.textContent = count);
}

// ── ADD TO CART ──────────────────────────────────────────────────────────────
async function addToCart(productId, productName) {
    loadCart();
    const currentQty = cart[productId] || 0;

    try {
        const res = await fetch('/api/cart/add', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                product_id:       productId,
                quantity:         1,
                current_cart_qty: currentQty   // FIX: let server validate total-vs-stock
            })
        });
        const data = await res.json();

        if (res.ok) {
            cart[productId] = currentQty + 1;
            saveCart();
            updateCartCount();
            showNotification(`"${productName}" added to cart!`, 'success');

            const btn = document.querySelector(`[data-pid="${productId}"]`);
            if (btn) {
                const orig = btn.innerHTML;
                btn.innerHTML = '<i class="fas fa-check me-2"></i>Added!';
                btn.disabled  = true;
                setTimeout(() => { btn.innerHTML = orig; btn.disabled = false; }, 1500);
            }
        } else {
            showNotification(data.error || 'Failed to add to cart', 'danger');
        }
    } catch {
        showNotification('Cannot reach server. Is Flask running on port 5000?', 'danger');
    }
}

function updateQuantity(productId, newQty) {
    if (newQty <= 0) { removeFromCart(productId); return; }
    const product = allProducts.find(p => p.id == productId);
    if (product && newQty > product.stock) {
        showNotification(`Only ${product.stock} in stock`, 'warning');
        return;
    }
    loadCart();
    cart[productId] = newQty;
    saveCart();
    updateCartCount();
    if (currentPage === 'cart') displayCart();
}

function removeFromCart(productId) {
    loadCart();
    const product = allProducts.find(p => p.id == productId);
    delete cart[productId];
    saveCart();
    updateCartCount();
    if (currentPage === 'cart') displayCart();
    showNotification(`${product ? product.name : 'Item'} removed from cart`, 'info');
}

function clearCart() {
    cart = {};
    saveCart();
    updateCartCount();
    if (currentPage === 'cart') displayCart();
}

// ── HOME ─────────────────────────────────────────────────────────────────────
function initHomePage() {
    const statNums = document.querySelectorAll('.stat-number');
    if (!statNums.length) return;
    const obs = new IntersectionObserver(entries => {
        entries.forEach(e => {
            if (!e.isIntersecting) return;
            const el     = e.target;
            const raw    = el.textContent.replace(/\D/g, '');
            const num    = parseInt(raw);
            const suffix = el.textContent.includes('%') ? '%' : '+';
            if (num) animateValue(el, 0, num, 1800, suffix);
            obs.unobserve(el);
        });
    }, { threshold: 0.5 });
    statNums.forEach(s => obs.observe(s));
}

function animateValue(el, start, end, duration, suffix = '+') {
    const step = (end - start) / (duration / 16);
    let cur = start;
    const t = setInterval(() => {
        cur += step;
        if (cur >= end) { el.textContent = end.toLocaleString('en-IN') + suffix; clearInterval(t); }
        else            el.textContent = Math.floor(cur).toLocaleString('en-IN') + suffix;
    }, 16);
}

// ── PRODUCTS ─────────────────────────────────────────────────────────────────
function initProductsPage() {
    loadProducts();
    const inp = document.getElementById('searchInput');
    if (!inp) return;
    inp.addEventListener('keypress', e => { if (e.key === 'Enter') searchProducts(); });
    let timer;
    inp.addEventListener('input', function () {
        clearTimeout(timer);
        timer = setTimeout(() => {
            if (this.value.length > 2 || !this.value) searchProducts();
        }, 400);
    });
}

async function loadProducts() {
    try {
        const res = await fetch('/api/products');
        if (!res.ok) throw new Error('fetch failed');
        allProducts = await res.json();
        displayProducts(allProducts);
    } catch {
        showProductsError();
    }
    return allProducts;
}

function displayProducts(products) {
    const container = document.getElementById('products-container');
    const countEl   = document.getElementById('product-count');
    if (!container) return;

    if (!products.length) {
        container.innerHTML = `
            <div class="col-12">
                <div class="no-products">
                    <i class="fas fa-box-open fa-4x mb-4"></i>
                    <h3>No products found</h3>
                    <p style="color:var(--muted)">Try a different search term</p>
                    <button class="btn btn-primary mt-3" onclick="clearSearch()">
                        <i class="fas fa-redo me-2"></i>Show All
                    </button>
                </div>
            </div>`;
        if (countEl) countEl.textContent = '0 products found';
        return;
    }

    if (countEl) countEl.textContent = `${products.length} product${products.length !== 1 ? 's' : ''} found`;

    container.innerHTML = products.map(p => {
        const priceINR = usdToInr(p.price);
        return `
        <div class="col-md-6 col-lg-4 col-xl-3 fade-in">
            <div class="product-card">
                <div style="overflow:hidden;">
                    <img src="${escHtml(p.image || '')}"
                         alt="${escHtml(p.name)}"
                         class="product-image"
                         onerror="this.onerror=null;this.src='https://placehold.co/400x300/16213e/e94560?text=${encodeURIComponent(p.name.slice(0,10))}'">
                </div>
                <div class="product-body">
                    <span style="font-size:.7rem;color:var(--muted);text-transform:uppercase;letter-spacing:1px;">
                        ${escHtml(p.category || 'general')}
                    </span>
                    <h5 class="product-title mt-1">${escHtml(p.name)}</h5>
                    <p class="product-description">${escHtml(p.description)}</p>
                    <div class="product-footer">
                        <div class="d-flex justify-content-between align-items-center mb-3">
                            <span class="product-price">${formatINR(priceINR)}</span>
                            <span class="badge ${stockClass(p.stock)} stock-badge">${stockText(p.stock)}</span>
                        </div>
                        <button class="btn btn-add-cart"
                                data-pid="${p.id}"
                                onclick="addToCart(${p.id}, '${escHtml(p.name).replace(/'/g, "\\'")}')"
                                ${p.stock === 0 ? 'disabled' : ''}>
                            <i class="fas fa-bag-shopping me-2"></i>${p.stock === 0 ? 'Out of Stock' : 'Add to Cart'}
                        </button>
                    </div>
                </div>
            </div>
        </div>`;
    }).join('');
}

function stockClass(s) { return s === 0 ? 'bg-danger' : s <= 5 ? 'bg-warning' : 'bg-success'; }
function stockText(s)  { return s === 0 ? 'Out of stock' : s <= 5 ? `Only ${s} left` : `${s} in stock`; }

async function searchProducts() {
    const inp = document.getElementById('searchInput');
    if (!inp) return;
    const q = inp.value.trim();

    // FIX: if query is empty, show all instead of calling API with empty q
    if (!q) { displayProducts(allProducts); return; }

    try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        if (!res.ok) throw new Error();
        displayProducts(await res.json());
    } catch {
        showNotification('Search failed', 'danger');
    }
}

function clearSearch() {
    const inp = document.getElementById('searchInput');
    if (inp) inp.value = '';
    displayProducts(allProducts);  // FIX: was calling displayProducts(allProducts) — correct, but only works if allProducts is loaded
}

function showProductsError() {
    const c = document.getElementById('products-container');
    if (c) c.innerHTML = `
        <div class="col-12 text-center py-5">
            <i class="fas fa-exclamation-triangle fa-4x mb-4" style="color:var(--accent)"></i>
            <h3 style="font-family:'Playfair Display',serif">Could not load products</h3>
            <p style="color:var(--muted)">Make sure Flask is running: <code>python app.py</code></p>
            <button class="btn btn-primary mt-3" onclick="loadProducts()">
                <i class="fas fa-redo me-2"></i>Retry
            </button>
        </div>`;
}

// ── CART PAGE ─────────────────────────────────────────────────────────────────
// FIX: was calling loadProducts().then(() => displayCart()) — correct pattern,
// but the original had a race condition where allProducts could be empty if
// loadProducts threw synchronously. Using async/await is cleaner.
async function initCartPage() {
    await loadProducts();
    displayCart();
}

function displayCart() {
    const container   = document.getElementById('cart-items-container');
    const checkoutBtn = document.getElementById('checkout-btn');
    if (!container) return;
    loadCart();

    if (!Object.keys(cart).length) {
        container.innerHTML = `
            <div class="text-center py-5">
                <i class="fas fa-shopping-cart fa-4x mb-4" style="color:var(--muted);opacity:.4"></i>
                <h3 style="font-family:'Playfair Display',serif">Your cart is empty</h3>
                <p style="color:var(--muted)" class="mb-4">Add some products to get started!</p>
                <a href="/products" class="btn btn-primary btn-lg">
                    <i class="fas fa-shopping-bag me-2"></i>Browse Products
                </a>
            </div>`;
        if (checkoutBtn) checkoutBtn.style.display = 'none';
        setCartSummary(0);
        return;
    }

    if (checkoutBtn) checkoutBtn.style.display = 'block';

    let html = '', subtotal = 0;

    Object.entries(cart).forEach(([pid, qty]) => {
        const p = allProducts.find(x => x.id == pid);
        if (!p) return;
        const priceINR = usdToInr(p.price);
        const lineINR  = priceINR * qty;
        subtotal += lineINR;

        html += `
            <div class="cart-item">
                <img src="${escHtml(p.image || '')}"
                     alt="${escHtml(p.name)}"
                     class="cart-item-image"
                     onerror="this.onerror=null;this.src='https://placehold.co/90x90/16213e/e94560?text=${encodeURIComponent(p.name.slice(0,2))}'">
                <div class="cart-item-details">
                    <div class="cart-item-title">${escHtml(p.name)}</div>
                    <div class="small mb-1" style="color:var(--muted)">${escHtml(p.description)}</div>
                    <div class="cart-item-price">${formatINR(priceINR)} each</div>
                </div>
                <div class="quantity-control">
                    <button class="quantity-btn" onclick="updateQuantity(${pid}, ${qty - 1})">
                        <i class="fas fa-minus"></i>
                    </button>
                    <span class="quantity-display">${qty}</span>
                    <button class="quantity-btn" onclick="updateQuantity(${pid}, ${qty + 1})"
                            ${qty >= p.stock ? 'disabled' : ''}>
                        <i class="fas fa-plus"></i>
                    </button>
                </div>
                <div style="min-width:100px;text-align:right;">
                    <strong style="font-family:'Playfair Display',serif;font-size:1.1rem;color:var(--white)">
                        ${formatINR(lineINR)}
                    </strong>
                </div>
                <div>
                    <span class="remove-btn" onclick="removeFromCart(${pid})" title="Remove">
                        <i class="fas fa-trash-alt"></i>
                    </span>
                </div>
            </div>`;
    });

    container.innerHTML = html;
    setCartSummary(subtotal);
}

function setCartSummary(sub) {
    const tax   = sub * 0.18; // GST 18%
    const total = sub + tax;
    const set   = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = formatINR(v); };
    set('subtotal', sub);
    set('tax',      tax);
    set('total',    total);
}

// ── CHECKOUT ──────────────────────────────────────────────────────────────────
async function initCheckoutPage() {
    await loadProducts();
    loadCart();

    // FIX: redirect if cart truly empty in sessionStorage
    if (!Object.keys(cart).length) {
        window.location.href = '/cart';
        return;
    }
    displayOrderSummary();
    initCheckoutForm();
}

function displayOrderSummary() {
    const box = document.getElementById('order-items');
    if (!box) return;
    let sub = 0, html = '';

    Object.entries(cart).forEach(([pid, qty]) => {
        const p = allProducts.find(x => x.id == pid);
        if (!p) return;
        const priceINR = usdToInr(p.price);
        const lineINR  = priceINR * qty;
        sub += lineINR;
        html += `
            <div class="order-item">
                <div class="order-item-name">
                    ${escHtml(p.name)} <span style="color:var(--accent)">×${qty}</span>
                </div>
                <div style="color:var(--white);font-weight:600">${formatINR(lineINR)}</div>
            </div>`;
    });

    box.innerHTML = html;
    const tax   = sub * 0.18;
    const total = sub + tax;
    const set   = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = formatINR(v); };
    set('summary-subtotal', sub);
    set('summary-tax',      tax);
    set('summary-total',    total);
}

function initCheckoutForm() {
    const form = document.getElementById('orderForm');
    if (!form) return;
    form.addEventListener('submit', handleCheckout);
    form.querySelectorAll('input').forEach(inp =>
        inp.addEventListener('blur', () => validateField(inp)));
}

function validateField(f) {
    const ok = !(f.required && !f.value.trim());
    f.classList.toggle('is-invalid', !ok);
    f.classList.toggle('is-valid',   ok);
    return ok;
}

async function handleCheckout(e) {
    e.preventDefault();
    const form = e.target;
    const btn  = form.querySelector('button[type="submit"]');

    // Validate all required fields
    let valid = true;
    form.querySelectorAll('input[required]').forEach(i => { if (!validateField(i)) valid = false; });
    if (!valid) { showNotification('Please fill in all required fields', 'warning'); return; }

    const orig = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Processing...';

    try {
        // FIX: send full cart in body so server doesn't need Flask session
        const res = await fetch('/api/checkout', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name:    `${document.getElementById('firstName').value.trim()} ${document.getElementById('lastName').value.trim()}`,
                address: `${document.getElementById('address').value.trim()}, ${document.getElementById('city').value.trim()}, ${document.getElementById('state').value.trim()} ${document.getElementById('zip').value.trim()}`,
                phone:   document.getElementById('phone').value.trim(),
                cart:    cart   // ← THE FIX: was missing before
            })
        });
        const data = await res.json();

        if (res.ok) {
            clearCart();
            document.getElementById('checkout-form').style.display    = 'none';
            document.getElementById('success-message').style.display  = 'block';
            document.getElementById('order-id').textContent           = `#${data.order.order_id}`;
            // FIX: server stores USD total → convert to INR for display
            document.getElementById('order-total').textContent        = formatINR(usdToInr(data.order.total));
            window.scrollTo({ top: 0, behavior: 'smooth' });
            showConfetti();
        } else {
            btn.disabled  = false;
            btn.innerHTML = orig;
            showNotification(data.error || 'Checkout failed', 'danger');
        }
    } catch {
        btn.disabled  = false;
        btn.innerHTML = orig;
        showNotification('Cannot reach server. Is Flask running?', 'danger');
    }
}

function selectPayment(el) {
    document.querySelectorAll('.payment-method').forEach(m => m.classList.remove('selected'));
    el.classList.add('selected');
    el.querySelector('input[type="radio"]').checked = true;
}

function showConfetti() {
    ['🎉','🎊','✨','🎈','🎁'].forEach((ch, i) => {
        for (let j = 0; j < 8; j++) {
            setTimeout(() => {
                const c = document.createElement('div');
                c.textContent   = ch;
                c.style.cssText = `position:fixed;top:-40px;left:${Math.random()*100}%;font-size:${20+Math.random()*20}px;z-index:9999;pointer-events:none;animation:fall ${2+Math.random()*3}s linear forwards`;
                document.body.appendChild(c);
                setTimeout(() => c.remove(), 5000);
            }, (i * 8 + j) * 80);
        }
    });
}

// ── ORDERS PAGE ───────────────────────────────────────────────────────────────
async function initOrdersPage() {
    const box = document.getElementById('orders-container');
    if (!box) return;

    box.innerHTML = `
        <div class="text-center py-5">
            <div class="spinner-border" style="width:3rem;height:3rem;"></div>
            <p class="mt-3" style="color:var(--muted)">Loading orders...</p>
        </div>`;

    try {
        const res    = await fetch('/api/orders');
        if (!res.ok) throw new Error('fetch failed');
        const orders = await res.json();

        if (!orders.length) {
            box.innerHTML = `
                <div class="text-center py-5">
                    <i class="fas fa-box-open fa-4x mb-4" style="color:var(--muted);opacity:.4"></i>
                    <h3 style="font-family:'Playfair Display',serif">No orders yet</h3>
                    <p style="color:var(--muted)" class="mb-4">You haven't placed any orders yet.</p>
                    <a href="/products" class="btn btn-primary btn-lg">
                        <i class="fas fa-shopping-bag me-2"></i>Start Shopping
                    </a>
                </div>`;
            return;
        }

        // FIX: server stores totals in USD → multiply by INR_RATE for display
        box.innerHTML = [...orders].reverse().map(o => `
            <div class="order-card">
                <div class="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
                    <h5 class="mb-0 fw-bold" style="font-family:'Playfair Display',serif">
                        <i class="fas fa-receipt me-2" style="color:var(--accent)"></i>Order #${o.order_id}
                    </h5>
                    <span class="badge ${orderBadge(o.status)}">${o.status.toUpperCase()}</span>
                </div>
                <div class="row mb-3">
                    <div class="col-md-6">
                        <p class="mb-1" style="color:var(--muted);font-size:.9rem">
                            <i class="fas fa-user me-2"></i>
                            <strong style="color:var(--white)">${escHtml(o.customer.name)}</strong>
                        </p>
                        <p class="mb-1" style="color:var(--muted);font-size:.9rem">
                            <i class="fas fa-map-marker-alt me-2"></i>${escHtml(o.customer.address)}
                        </p>
                        <p class="mb-0" style="color:var(--muted);font-size:.9rem">
                            <i class="fas fa-phone me-2"></i>${escHtml(o.customer.phone)}
                        </p>
                    </div>
                    <div class="col-md-6 text-md-end mt-3 mt-md-0">
                        <p class="mb-1" style="color:var(--muted);font-size:.85rem">
                            <i class="fas fa-calendar me-2"></i>
                            ${new Date(o.created_at).toLocaleDateString('en-IN',{year:'numeric',month:'long',day:'numeric'})}
                        </p>
                        <p class="mb-0" style="font-family:'Playfair Display',serif;font-size:1.5rem;color:var(--accent);font-weight:700">
                            ${formatINR(usdToInr(o.total))}
                        </p>
                    </div>
                </div>
                <div style="border-top:1px solid var(--border);padding-top:1rem;">
                    <div class="row g-2">
                        ${o.items.map(item => `
                            <div class="col-md-6">
                                <div class="d-flex justify-content-between align-items-center px-3 py-2"
                                     style="background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:8px;">
                                    <span style="color:var(--muted);font-size:.9rem">
                                        ${escHtml(item.name)}
                                        <span style="color:var(--accent)">×${item.quantity}</span>
                                    </span>
                                    <strong style="color:var(--white)">${formatINR(usdToInr(item.subtotal))}</strong>
                                </div>
                            </div>`).join('')}
                    </div>
                </div>
            </div>`).join('');

    } catch (err) {
        console.error('Orders fetch error:', err);
        box.innerHTML = `
            <div class="text-center py-5">
                <i class="fas fa-exclamation-triangle fa-4x mb-3" style="color:var(--accent)"></i>
                <h3 style="font-family:'Playfair Display',serif">Could not load orders</h3>
                <p style="color:var(--muted)">Make sure Flask is running: <code>python app.py</code></p>
                <button class="btn btn-primary mt-3" onclick="initOrdersPage()">
                    <i class="fas fa-redo me-2"></i>Retry
                </button>
            </div>`;
    }
}

function orderBadge(s) {
    return {
        pending:    'bg-warning',
        completed:  'bg-success',
        shipped:    'bg-success',
        delivered:  'bg-success',
        cancelled:  'bg-danger',
        processing: 'bg-info'
    }[s] || 'bg-secondary';
}

// ── NOTIFICATIONS ─────────────────────────────────────────────────────────────
function showNotification(msg, type = 'info') {
    document.querySelectorAll('.shophub-toast').forEach(n => n.remove());
    const icons = {
        success: 'fa-check-circle',
        danger:  'fa-exclamation-circle',
        warning: 'fa-exclamation-triangle',
        info:    'fa-info-circle'
    };
    const n = document.createElement('div');
    n.className  = `alert alert-${type} alert-dismissible fade show shophub-toast shadow`;
    n.style.cssText = 'position:fixed;top:85px;right:20px;z-index:9999;min-width:300px;max-width:420px;';
    n.innerHTML  = `<i class="fas ${icons[type]||'fa-info-circle'} me-2"></i>${escHtml(msg)}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>`;
    document.body.appendChild(n);
    setTimeout(() => { n.classList.remove('show'); setTimeout(() => n.remove(), 300); }, 4000);
}

// ── UTILS ─────────────────────────────────────────────────────────────────────
function escHtml(t) {
    if (t == null) return '';
    const d = document.createElement('div');
    d.textContent = String(t);
    return d.innerHTML;
}

// Confetti animation keyframe
const cs = document.createElement('style');
cs.textContent = '@keyframes fall{to{transform:translateY(110vh) rotate(720deg);opacity:0}}';
document.head.appendChild(cs);

// Global API for debugging
window.shopHub = { addToCart, removeFromCart, clearCart, loadProducts, showNotification, cart: () => cart };
console.log('ShopHub ready 🚀');
