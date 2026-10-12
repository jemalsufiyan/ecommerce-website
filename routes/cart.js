const express = require('express');
const db = require('../db');
const router = express.Router();

// 1. Get User Cart Items
router.get('/:user_id', async (req, res) => {
  const { user_id } = req.params;
  try {
    const result = await db.query(
      `SELECT c.cart_item_id, c.quantity, p.product_id, p.name, p.price, p.stock_quantity 
       FROM cart_items c 
       JOIN products p ON c.product_id = p.product_id 
       WHERE c.user_id = $1`,
      [user_id]
    );

    const formattedRows = result.rows.map(row => ({
      cart_id: row.cart_item_id,
      quantity: row.quantity,
      product_id: row.product_id,
      name: row.name,
      price: row.price,
      stock_quantity: row.stock_quantity
    }));

    res.json({ status: 'success', data: formattedRows });
  } catch (err) {
    console.error('Fetch cart error:', err.message);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// 2. Add Item to Cart (Strict Stock Validation)
router.post('/', async (req, res) => {
  const { user_id, product_id, quantity } = req.body;
  const addQty = quantity || 1;

  try {
    // 1. Check live stock of product
    const productRes = await db.query(
      'SELECT stock_quantity, name FROM products WHERE product_id = $1',
      [product_id]
    );

    if (productRes.rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Product not found' });
    }

    const availableStock = productRes.rows[0].stock_quantity || 0;

    if (availableStock <= 0) {
      return res.status(400).json({ status: 'error', message: 'ይህ እቃ ስቶክ አልቋል (Out of stock)' });
    }

    // 2. Check existing cart quantity
    const existing = await db.query(
      'SELECT cart_item_id, quantity FROM cart_items WHERE user_id = $1 AND product_id = $2',
      [user_id, product_id]
    );

    if (existing.rows.length > 0) {
      const currentCartQty = existing.rows[0].quantity;
      const newTotalQty = currentCartQty + addQty;

      if (newTotalQty > availableStock) {
        return res.status(400).json({ 
          status: 'error', 
          message: `የቀረው ስቶክ ${availableStock} ብቻ ስለሆነ ከዚህ በላይ መጨመር አይችሉም።` 
        });
      }

      const updated = await db.query(
        'UPDATE cart_items SET quantity = $1 WHERE cart_item_id = $2 RETURNING *',
        [newTotalQty, existing.rows[0].cart_item_id]
      );
      return res.json({ status: 'success', data: updated.rows[0] });
    }

    if (addQty > availableStock) {
      return res.status(400).json({ 
        status: 'error', 
        message: `የቀረው ስቶክ ${availableStock} ብቻ ነው።` 
      });
    }

    const result = await db.query(
      'INSERT INTO cart_items (user_id, product_id, quantity) VALUES ($1, $2, $3) RETURNING *',
      [user_id, product_id, addQty]
    );
    res.json({ status: 'success', data: result.rows[0] });

  } catch (err) {
    console.error('Add to cart error:', err.message);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// 3. Remove Item from Cart
router.delete('/:cart_id', async (req, res) => {
  const { cart_id } = req.params;
  try {
    await db.query('DELETE FROM cart_items WHERE cart_item_id = $1', [cart_id]);
    res.json({ status: 'success', message: 'Item removed from cart' });
  } catch (err) {
    console.error('Remove cart item error:', err.message);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

module.exports = router;