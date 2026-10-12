const express = require('express');
const db = require('../db');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const router = express.Router();

// uploads ፎልደር ፋይል ሆኖ ከተፈጠረ በራስሰር አስተካክሎ ፎልደር ማድረግ
const uploadDir = path.join(__dirname, '../public/uploads');
if (fs.existsSync(uploadDir)) {
  const stats = fs.lstatSync(uploadDir);
  if (!stats.isDirectory()) {
    fs.unlinkSync(uploadDir);
  }
}
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer Storage ማዘጋጀት
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ storage: storage });

// 1. Get All Active Products
router.get('/', async (req, res) => {
  try {
    const result = await db.query(
      'SELECT * FROM products WHERE COALESCE(is_deleted, FALSE) = FALSE ORDER BY product_id DESC'
    );
    res.json({ status: 'success', data: result.rows });
  } catch (err) {
    console.error('Fetch products error:', err.message);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// 2. Add New Product
router.post('/', upload.single('image_file'), async (req, res) => {
  try {
    const { name, price, stock_quantity, description, image_url } = req.body;
    
    let finalImageUrl = image_url || '';
    if (req.file) {
      finalImageUrl = `/uploads/${req.file.filename}`;
    }

    const result = await db.query(
      'INSERT INTO products (name, price, stock_quantity, description, image_url, is_deleted) VALUES ($1, $2, $3, $4, $5, FALSE) RETURNING *',
      [name, parseFloat(price), parseInt(stock_quantity) || 0, description || '', finalImageUrl]
    );
    res.json({ status: 'success', data: result.rows[0] });
  } catch (err) {
    console.error('Add product error:', err.message);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// 3. Update Product Details
router.put('/:id', upload.single('image_file'), async (req, res) => {
  try {
    const { id } = req.params;
    const { price, stock_quantity, image_url } = req.body;

    let finalImageUrl = image_url;
    if (req.file) {
      finalImageUrl = `/uploads/${req.file.filename}`;
    }

    const result = await db.query(
      `UPDATE products 
       SET price = $1, stock_quantity = $2, 
           image_url = CASE WHEN $3::text IS NOT NULL AND $3::text != '' THEN $3::text ELSE image_url END 
       WHERE product_id = $4 AND COALESCE(is_deleted, FALSE) = FALSE 
       RETURNING *`,
      [parseFloat(price), parseInt(stock_quantity), finalImageUrl || null, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Product not found or deleted' });
    }

    res.json({ status: 'success', message: 'Product updated successfully', data: result.rows[0] });
  } catch (err) {
    console.error('Update product error:', err.message);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// 4. Delete Product (Soft Delete)
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query(
      'UPDATE products SET is_deleted = TRUE WHERE product_id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Product not found' });
    }

    await db.query('DELETE FROM cart_items WHERE product_id = $1', [id]);

    res.json({ status: 'success', message: 'Product deleted successfully' });
  } catch (err) {
    console.error('Soft delete error:', err.message);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

module.exports = router;