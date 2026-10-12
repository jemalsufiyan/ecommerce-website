const express = require('express');
const db = require('../db');
const router = express.Router();

// 1. Get All Orders for Admin (ከነ እቃዎች ዝርዝር)
router.get('/', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT o.order_id, o.total_amount, o.payment_method, o.transaction_ref, o.status, o.created_at,
              u.username, u.email,
              COALESCE(
                JSON_AGG(
                  JSON_BUILD_OBJECT('name', p.name, 'quantity', oi.quantity, 'price', oi.unit_price)
                ) FILTER (WHERE oi.order_item_id IS NOT NULL), '[]'
              ) AS items
       FROM orders o
       JOIN users u ON o.user_id = u.user_id
       LEFT JOIN order_items oi ON o.order_id = oi.order_id
       LEFT JOIN products p ON oi.product_id = p.product_id
       GROUP BY o.order_id, u.username, u.email
       ORDER BY o.order_id DESC`
    );
    res.json({ status: 'success', data: result.rows });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// 2. Get User Orders for Customer (ለደንበኛው - ከነ እቃዎች ዝርዝር)
router.get('/user/:userId', async (req, res) => {
  const { userId } = req.params;
  try {
    const result = await db.query(
      `SELECT o.order_id, o.total_amount, o.payment_method, o.transaction_ref, o.status, o.created_at,
              COALESCE(
                JSON_AGG(
                  JSON_BUILD_OBJECT('name', p.name, 'quantity', oi.quantity, 'price', oi.unit_price)
                ) FILTER (WHERE oi.order_item_id IS NOT NULL), '[]'
              ) AS items
       FROM orders o
       LEFT JOIN order_items oi ON o.order_id = oi.order_id
       LEFT JOIN products p ON oi.product_id = p.product_id
       WHERE o.user_id = $1
       GROUP BY o.order_id
       ORDER BY o.order_id DESC`,
      [userId]
    );
    res.json({ status: 'success', data: result.rows });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// 3. Create New Order (ለደንበኛው - Cart ውስጥ ያሉትን እቃዎች ወደ Order_Items የሚመዘግብ)
router.post('/', async (req, res) => {
  const { user_id, payment_method, transaction_ref } = req.body;

  if (!transaction_ref || transaction_ref.trim().length < 4) {
    return res.status(400).json({ status: 'error', message: 'ትክክለኛ የትራንዛክሽን ማረጋገጫ ቁጥር ያስገቡ!' });
  }

  try {
    await db.query('BEGIN');

    // የካርት እቃዎችን ማምጣት
    const cartItems = await db.query(
      `SELECT c.product_id, c.quantity, p.price, p.stock_quantity, p.name 
       FROM cart_items c 
       JOIN products p ON c.product_id = p.product_id 
       WHERE c.user_id = $1`,
      [user_id]
    );

    if (cartItems.rows.length === 0) {
      await db.query('ROLLBACK');
      return res.status(400).json({ status: 'error', message: 'ካርትዎ ባዶ ነው!' });
    }

    let totalAmount = 0;
    for (let item of cartItems.rows) {
      if (item.stock_quantity < item.quantity) {
        await db.query('ROLLBACK');
        return res.status(400).json({ status: 'error', message: `የ ${item.name} የስቶክ መጠን አልበቃም!` });
      }
      totalAmount += parseFloat(item.price) * item.quantity;
    }

    // አዲስ ኦርደር መመዝገብ
    const orderResult = await db.query(
      `INSERT INTO orders (user_id, total_amount, payment_method, transaction_ref, status) 
       VALUES ($1, $2, $3, $4, 'Pending') RETURNING *`,
      [user_id, totalAmount, payment_method, transaction_ref.trim()]
    );

    const orderId = orderResult.rows[0].order_id;

    // እያንዳንዱን እቃ ወደ order_items ማስገባት
    for (let item of cartItems.rows) {
      await db.query(
        `INSERT INTO order_items (order_id, product_id, quantity, unit_price)
         VALUES ($1, $2, $3, $4)`,
        [orderId, item.product_id, item.quantity, item.price]
      );
    }

    // ካርቱን ማጽዳት
    await db.query('DELETE FROM cart_items WHERE user_id = $1', [user_id]);
    await db.query('COMMIT');
    
    res.json({ status: 'success', message: 'ኦርደርዎ ተመዝግቧል!', data: orderResult.rows[0] });

  } catch (err) {
    await db.query('ROLLBACK');
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// 4. Update Order Status (Approve / Reject)
router.put('/:id/status', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  try {
    await db.query('BEGIN');

    const orderRes = await db.query('SELECT * FROM orders WHERE order_id = $1', [id]);
    if (orderRes.rows.length === 0) {
      await db.query('ROLLBACK');
      return res.status(404).json({ status: 'error', message: 'Order not found' });
    }

    const currentOrder = orderRes.rows[0];

    if (currentOrder.status !== 'Approved' && status === 'Approved') {
      const items = await db.query('SELECT product_id, quantity FROM order_items WHERE order_id = $1', [id]);
      for (let item of items.rows) {
        await db.query(
          'UPDATE products SET stock_quantity = stock_quantity - $1 WHERE product_id = $2',
          [item.quantity, item.product_id]
        );
      }
    }

    if (currentOrder.status === 'Approved' && status === 'Rejected') {
      const items = await db.query('SELECT product_id, quantity FROM order_items WHERE order_id = $1', [id]);
      for (let item of items.rows) {
        await db.query(
          'UPDATE products SET stock_quantity = stock_quantity + $1 WHERE product_id = $2',
          [item.quantity, item.product_id]
        );
      }
    }

    const updatedOrder = await db.query(
      'UPDATE orders SET status = $1 WHERE order_id = $2 RETURNING *',
      [status, id]
    );

    await db.query('COMMIT');
    res.json({ status: 'success', message: `Status updated to ${status}`, data: updatedOrder.rows[0] });

  } catch (err) {
    await db.query('ROLLBACK');
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// 5. Product Sales Analytics
router.get('/analytics/products', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT p.product_id, p.name, p.price, p.stock_quantity, p.is_deleted,
              COALESCE(SUM(oi.quantity), 0) AS total_sold,
              COALESCE(SUM(oi.quantity * oi.unit_price), 0) AS total_revenue
       FROM products p
       LEFT JOIN order_items oi ON p.product_id = oi.product_id
       LEFT JOIN orders o ON oi.order_id = o.order_id AND o.status = 'Approved'
       GROUP BY p.product_id, p.name, p.price, p.stock_quantity, p.is_deleted
       ORDER BY total_sold DESC`
    );
    res.json({ status: 'success', data: result.rows });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

module.exports = router;