from flask import Flask, request, jsonify, render_template
import os
import json
from datetime import datetime
import secrets

app = Flask(__name__)
app.secret_key = secrets.token_hex(16)

PRODUCTS_FILE = "products.json"
ORDERS_FILE   = "orders.json"

# ─────────────────────────────────────────────
#  Utility helpers
# ─────────────────────────────────────────────

def read_json(path):
    if not os.path.exists(path):
        with open(path, "w") as f:
            json.dump([], f)
    with open(path, "r") as f:
        return json.load(f)

def write_json(path, data):
    with open(path, "w") as f:
        json.dump(data, f, indent=4, default=str)

def get_product_by_id(product_id):
    for p in read_json(PRODUCTS_FILE):
        if p["id"] == int(product_id):
            return p
    return None

# ─────────────────────────────────────────────
#  HTML page routes
# ─────────────────────────────────────────────

@app.route("/")
def home():
    return render_template("home.html")

@app.route("/products")
def products_page():
    return render_template("products.html")

@app.route("/cart")
def cart_page():
    return render_template("cart.html")

@app.route("/checkout")
def checkout_page():
    # FIX: removed server-side session cart check — cart lives in JS sessionStorage.
    # The old code redirected to cart.html when Flask session cart was empty,
    # which broke checkout after a server restart (session lost, but JS cart intact).
    return render_template("checkout.html")

@app.route("/orders")
def orders_page():
    return render_template("orders.html")

# ─────────────────────────────────────────────
#  Products API
# ─────────────────────────────────────────────

@app.route("/api/products", methods=["GET"])
def api_get_products():
    return jsonify(read_json(PRODUCTS_FILE))

@app.route("/api/product/<int:product_id>", methods=["GET"])
def api_product_detail(product_id):
    product = get_product_by_id(product_id)
    if not product:
        return jsonify({"error": "Product not found"}), 404
    return jsonify(product)

@app.route("/api/search", methods=["GET"])
def api_search_products():
    q = request.args.get("q", "").lower().strip()
    products = read_json(PRODUCTS_FILE)
    if not q:
        return jsonify(products)
    results = [
        p for p in products
        if q in p["name"].lower()
        or q in p.get("description", "").lower()
        or q in p.get("category", "").lower()
    ]
    return jsonify(results)

# ─────────────────────────────────────────────
#  Cart API  (thin — cart state is owned by JS sessionStorage)
# ─────────────────────────────────────────────

@app.route("/api/cart/add", methods=["POST"])
def api_add_to_cart():
    """
    FIX: Previously used Flask session as the cart store, but the JS also
    maintained its own sessionStorage cart. They drifted on server restarts.
    This endpoint now only validates stock and returns success/error.
    The JS is the single source of truth for cart contents.
    """
    data = request.get_json(force=True) or {}
    product_id = data.get("product_id")
    quantity   = int(data.get("quantity", 1))

    if not product_id:
        return jsonify({"error": "product_id required"}), 400

    product = get_product_by_id(product_id)
    if not product:
        return jsonify({"error": "Product not found"}), 404
    if quantity <= 0:
        return jsonify({"error": "Invalid quantity"}), 400

    # Pass current cart quantity so we can check total-against-stock
    current_in_cart = int(data.get("current_cart_qty", 0))
    if product["stock"] < (current_in_cart + quantity):
        return jsonify({"error": f"Only {product['stock']} in stock"}), 400

    return jsonify({
        "message": "Product added to cart",
        "product": product
    })

# ─────────────────────────────────────────────
#  Checkout API
# ─────────────────────────────────────────────

@app.route("/api/checkout", methods=["POST"])
def api_checkout():
    """
    FIX: Old code read cart from Flask session, which was empty after
    server restarts. Now the JS sends the full cart in the request body,
    so checkout works regardless of server state.
    """
    data = request.get_json(force=True) or {}

    name    = (data.get("name")    or "").strip()
    address = (data.get("address") or "").strip()
    phone   = (data.get("phone")   or "").strip()
    # JS sends the cart: { "cart": { "1": 2, "5": 1 } }
    cart    = data.get("cart", {})

    if not name or not address or not phone:
        return jsonify({"error": "Missing customer details"}), 400
    if not cart:
        return jsonify({"error": "Cart is empty"}), 400

    products   = read_json(PRODUCTS_FILE)
    orders     = read_json(ORDERS_FILE)
    order_items = []
    total       = 0.0

    # Map products by id for quick lookup
    prod_map = {str(p["id"]): p for p in products}

    for pid_str, qty in cart.items():
        qty = int(qty)
        product = prod_map.get(str(pid_str))
        if not product:
            return jsonify({"error": f"Product {pid_str} not found"}), 404
        if qty > product["stock"]:
            return jsonify({"error": f"Not enough stock for {product['name']}"}), 400

        subtotal = round(product["price"] * qty, 2)
        total   += subtotal
        product["stock"] -= qty

        order_items.append({
            "product_id": product["id"],
            "name":       product["name"],
            "quantity":   qty,
            "price":      product["price"],
            "subtotal":   subtotal
        })

    total = round(total, 2)

    write_json(PRODUCTS_FILE, products)

    order = {
        "order_id":   len(orders) + 1,
        "customer":   {"name": name, "address": address, "phone": phone},
        "items":      order_items,
        "total":      total,
        "status":     "pending",
        "created_at": datetime.now().isoformat()
    }
    orders.append(order)
    write_json(ORDERS_FILE, orders)

    return jsonify({"message": "Order placed successfully", "order": order})

# ─────────────────────────────────────────────
#  Orders API
# ─────────────────────────────────────────────

@app.route("/api/orders", methods=["GET"])
def api_get_orders():
    return jsonify(read_json(ORDERS_FILE))

@app.route("/api/orders/<int:order_id>", methods=["GET"])
def api_get_order(order_id):
    for o in read_json(ORDERS_FILE):
        if o["order_id"] == order_id:
            return jsonify(o)
    return jsonify({"error": "Order not found"}), 404

@app.route("/api/orders/<int:order_id>/status", methods=["PUT"])
def api_update_order_status(order_id):
    orders     = read_json(ORDERS_FILE)
    new_status = (request.get_json(force=True) or {}).get("status")
    if not new_status:
        return jsonify({"error": "status required"}), 400
    for o in orders:
        if o["order_id"] == order_id:
            o["status"]     = new_status
            o["updated_at"] = datetime.now().isoformat()
            write_json(ORDERS_FILE, orders)
            return jsonify({"message": "Status updated", "order": o})
    return jsonify({"error": "Order not found"}), 404

# ─────────────────────────────────────────────
#  Admin / utility API
# ─────────────────────────────────────────────

@app.route("/api/health", methods=["GET"])
def health_check():
    return jsonify({
        "status":    "healthy",
        "service":   "ShopHub E-Commerce API",
        "version":   "2.1",
        "timestamp": datetime.now().isoformat()
    })

@app.route("/api/stats", methods=["GET"])
def get_stats():
    products       = read_json(PRODUCTS_FILE)
    orders         = read_json(ORDERS_FILE)
    total_revenue  = sum(o.get("total", 0) for o in orders)
    total_orders   = len(orders)
    return jsonify({
        "total_products":      len(products),
        "total_orders":        total_orders,
        "total_revenue":       total_revenue,
        "out_of_stock":        len([p for p in products if p.get("stock", 0) == 0]),
        "average_order_value": round(total_revenue / total_orders, 2) if total_orders else 0
    })

@app.route("/api/admin/products/add", methods=["POST"])
def api_add_product():
    data = request.get_json(force=True) or {}
    for f in ["name", "price", "description", "stock"]:
        if f not in data:
            return jsonify({"error": f"{f} is required"}), 400
    products = read_json(PRODUCTS_FILE)
    product  = {
        "id":          max((p["id"] for p in products), default=0) + 1,
        "name":        data["name"],
        "price":       float(data["price"]),
        "description": data["description"],
        "stock":       int(data["stock"]),
        "image":       data.get("image", ""),
        "category":    data.get("category", "general"),
        "created_at":  datetime.now().isoformat()
    }
    products.append(product)
    write_json(PRODUCTS_FILE, products)
    return jsonify({"message": "Product added", "product": product}), 201

# ─────────────────────────────────────────────
#  Error handlers
# ─────────────────────────────────────────────

@app.errorhandler(404)
def not_found(e):
    return jsonify({"error": "Not found"}), 404

@app.errorhandler(500)
def internal_error(e):
    return jsonify({"error": "Internal server error"}), 500

# ─────────────────────────────────────────────
#  Entry point
# ─────────────────────────────────────────────

if __name__ == "__main__":
    for f in [PRODUCTS_FILE, ORDERS_FILE]:
        if not os.path.exists(f):
            write_json(f, [])

    print("=" * 52)
    print("  ShopHub E-Commerce  ·  http://localhost:5000")
    print("=" * 52)
    app.run(host="0.0.0.0", port=5000, debug=True)
