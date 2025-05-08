// Create a new file named server.js and add this code:

const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const app = express();
const path = require('path');
const port = 3000;

// Database configuration
const dbConfig = {
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'quitutes_ai'
};

// Enable CORS

app.use(cors({
    origin: 'http://localhost:3000', // ou seu domínio
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true // se necessário
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
    // Console logs para apoio na depuracao e para testes r
    //console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    //console.log('Headers:', req.headers);
    //console.log('Body:', req.body); // Agora deve mostrar o body corretamente
    next();
});


// Serve static files from the same directory as server.js
app.use(express.static(path.join(__dirname)));

// Serve dashboard as main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'dashboard.html'));
});

// Create database connection pool
const pool = mysql.createPool(dbConfig);

// API endpoints
app.get('/api/dashboard/summary', async (req, res) => {
    try {
        const connection = await pool.getConnection();

        // Get today's sales
        const [todaySales] = await connection.query(
            `SELECT IFNULL(SUM(total_amount), 0) as total 
             FROM orders 
             WHERE DATE(order_date) = CURDATE()`
        );

        // Get today's orders count
        const [todayOrders] = await connection.query(
            `SELECT COUNT(*) as count 
             FROM orders 
             WHERE DATE(order_date) = CURDATE()`
        );

        // Get low stock products count
        const [lowStock] = await connection.query(
            `SELECT COUNT(*) as count 
             FROM products 
             WHERE current_stock < minimum_stock`
        );

        // Get new customers this month
        const [newCustomers] = await connection.query(
            `SELECT COUNT(*) as count 
             FROM customers 
             WHERE MONTH(created_at) = MONTH(CURDATE()) 
             AND YEAR(created_at) = YEAR(CURDATE())`
        );

        connection.release();

        res.json({
            todaySales: parseFloat(todaySales[0].total) || 0,
            todayOrders: parseInt(todayOrders[0].count) || 0,
            lowStockProducts: parseInt(lowStock[0].count) || 0,
            newCustomers: parseInt(newCustomers[0].count) || 0
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Database error' });
    }
});

app.get('/api/dashboard/sales-data/:period', async (req, res) => {
    try {
        const { period } = req.params;
        const connection = await pool.getConnection();

        let query;

        if (period === 'week') {
            query = `
                SELECT DAYNAME(order_date) as day, IFNULL(SUM(total_amount), 0) as total
                FROM orders
                WHERE YEARWEEK(order_date, 1) = YEARWEEK(CURDATE(), 1)
                GROUP BY DAYOFWEEK(order_date), DAYNAME(order_date)
                ORDER BY DAYOFWEEK(order_date)`;
        } else if (period === 'month') {
            query = `
                SELECT DAY(order_date) as day, IFNULL(SUM(total_amount), 0) as total
                FROM orders
                WHERE MONTH(order_date) = MONTH(CURDATE())
                AND YEAR(order_date) = YEAR(CURDATE())
                GROUP BY DAY(order_date)
                ORDER BY DAY(order_date)`;
        } else { // year
            query = `
                SELECT MONTHNAME(order_date) as month, IFNULL(SUM(total_amount), 0) as total
                FROM orders
                WHERE YEAR(order_date) = YEAR(CURDATE())
                GROUP BY MONTH(order_date), MONTHNAME(order_date)
                ORDER BY MONTH(order_date)`;
        }

        const [results] = await connection.query(query);
        connection.release();

        res.json(results);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Database error' });
    }
});

app.get('/api/dashboard/top-products', async (req, res) => {
    try {
        const connection = await pool.getConnection();

        const [results] = await connection.query(`
            SELECT p.name, COUNT(oi.id) as sales_count
            FROM order_items oi
            JOIN products p ON oi.product_id = p.id
            JOIN orders o ON oi.order_id = o.id
            WHERE o.order_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
            GROUP BY p.name
            ORDER BY sales_count DESC
            LIMIT 5`);

        connection.release();
        res.json(results);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Database error' });
    }
});

app.get('/api/dashboard/recent-orders', async (req, res) => {
    try {
        const { page = 1, limit = 4 } = req.query;
        const offset = (page - 1) * limit;

        const connection = await pool.getConnection();

        // Get orders
        const [orders] = await connection.query(`
            SELECT o.id, o.order_number, c.name as customer_name, 
                   COUNT(oi.id) as items_count, 
                   CAST(o.total_amount AS DECIMAL(10,2)) as total_amount, 
                   o.status, DATE_FORMAT(o.order_date, '%d/%m/%Y') as formatted_date
            FROM orders o
            JOIN customers c ON o.customer_id = c.id
            LEFT JOIN order_items oi ON o.id = oi.order_id
            GROUP BY o.id
            ORDER BY o.order_date DESC
            LIMIT ? OFFSET ?`, [parseInt(limit), parseInt(offset)]);

        // Get total count for pagination
        const [countResult] = await connection.query(
            `SELECT COUNT(*) as total FROM orders`
        );

        connection.release();

        res.json({
            orders: orders.map(order => ({
                ...order,
                total_amount: parseFloat(order.total_amount) || 0
            })),
            total: countResult[0].total,
            page: parseInt(page),
            limit: parseInt(limit)
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Database error' });
    }
});

app.get('/api/dashboard/low-stock', async (req, res) => {
    try {
        const connection = await pool.getConnection();

        const [products] = await connection.query(`
            SELECT id, name, category, current_stock, minimum_stock, unit
            FROM products
            WHERE current_stock < minimum_stock
            ORDER BY (current_stock / minimum_stock) ASC
            LIMIT 5`);

        connection.release();
        res.json(products);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Database initialization
async function initializeDatabase() {
    try {
        const connection = await mysql.createConnection({
            host: dbConfig.host,
            user: dbConfig.user,
            password: dbConfig.password
        });

        // Create database if not exists
        await connection.query(`CREATE DATABASE IF NOT EXISTS ${dbConfig.database}`);
        await connection.query(`USE ${dbConfig.database}`);

        // Create tables
        await connection.query(`
            CREATE TABLE IF NOT EXISTS products (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                category VARCHAR(50) NOT NULL,
                description TEXT,
                current_stock INT NOT NULL DEFAULT 0,
                minimum_stock INT NOT NULL DEFAULT 5,
                unit VARCHAR(20) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )`);

        await connection.query(`
            CREATE TABLE IF NOT EXISTS customers (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                email VARCHAR(100),
                phone VARCHAR(20),
                address TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )`);

        await connection.query(`
            CREATE TABLE IF NOT EXISTS orders (
                id INT AUTO_INCREMENT PRIMARY KEY,
                order_number VARCHAR(20) NOT NULL,
                customer_id INT NOT NULL,
                total_amount DECIMAL(10,2) NOT NULL,
                status ENUM('pending', 'paid', 'preparing', 'on_delivery', 'delivered') DEFAULT 'pending',
                order_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (customer_id) REFERENCES customers(id)
            )`);

        await connection.query(`
            CREATE TABLE IF NOT EXISTS order_items (
                id INT AUTO_INCREMENT PRIMARY KEY,
                order_id INT NOT NULL,
                product_id INT NOT NULL,
                quantity INT NOT NULL,
                unit_price DECIMAL(10,2) NOT NULL,
                FOREIGN KEY (order_id) REFERENCES orders(id),
                FOREIGN KEY (product_id) REFERENCES products(id)
            )`);

        // Insert sample data if tables are empty
        const [productsCount] = await connection.query('SELECT COUNT(*) as count FROM products');
        if (productsCount[0].count === 0) {
            await connection.query(`
                INSERT INTO products (name, category, current_stock, minimum_stock, unit) VALUES
                ('Bolo de Chocolate', 'Bolos', 5, 15, 'unidade'),
                ('Pão de Mel', 'Doces', 3, 10, 'unidade'),
                ('Pudim', 'Sobremesas', 2, 8, 'porção'),
                ('Brigadeiro', 'Doces', 20, 30, 'unidade'),
                ('Beijinho', 'Doces', 18, 25, 'unidade'),
                ('Torta de Limão', 'Tortas', 6, 10, 'fatia'),
                ('Cookie', 'Biscoitos', 12, 20, 'unidade')`);
        }

        const [customersCount] = await connection.query('SELECT COUNT(*) as count FROM customers');
        if (customersCount[0].count === 0) {
            await connection.query(`
                INSERT INTO customers (name, email, phone) VALUES
                ('Ana Silva', 'ana@email.com', '(11) 99999-9999'),
                ('Carlos Oliveira', 'carlos@email.com', '(11) 98888-8888'),
                ('Mariana Costa', 'mariana@email.com', '(11) 97777-7777'),
                ('Roberto Santos', 'roberto@email.com', '(11) 96666-6666')`);
        }

        const [ordersCount] = await connection.query('SELECT COUNT(*) as count FROM orders');
        if (ordersCount[0].count === 0) {
            // Insert orders
            await connection.query(`
                INSERT INTO orders (order_number, customer_id, total_amount, status, order_date) VALUES
                ('QT-1024', 1, 87.50, 'delivered', '2023-06-10 14:30:00'),
                ('QT-1023', 2, 145.00, 'preparing', '2023-06-10 15:15:00'),
                ('QT-1022', 3, 52.00, 'on_delivery', '2023-06-09 10:45:00'),
                ('QT-1021', 4, 32.50, 'paid', '2023-06-09 16:20:00'),
                ('QT-1020', 1, 75.00, 'delivered', '2023-06-08 13:10:00'),
                ('QT-1019', 2, 120.00, 'delivered', '2023-06-07 17:30:00')`);

            // Insert order items
            await connection.query(`
                INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES
                (1, 1, 1, 45.00),
                (1, 4, 2, 21.25),
                (2, 1, 2, 45.00),
                (2, 3, 1, 25.00),
                (2, 5, 2, 15.00),
                (3, 6, 2, 26.00),
                (4, 7, 1, 32.50),
                (5, 2, 3, 25.00),
                (6, 1, 1, 45.00),
                (6, 3, 1, 25.00),
                (6, 7, 2, 25.00)`);
        }

        await connection.end();
        console.log('Database initialized successfully');
    } catch (error) {
        console.error('Error initializing database:', error);
    }
}

// ESTOQUE.HTML 
// Add these endpoints to your server.js file

/*
CREATE TABLE `customers` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL,
  `email` varchar(100) DEFAULT NULL,
  `phone` varchar(20) DEFAULT NULL,
  `address` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci;

CREATE TABLE `order_items` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `order_id` int(11) NOT NULL,
  `product_id` int(11) NOT NULL,
  `quantity` int(11) NOT NULL,
  `unit_price` decimal(10,2) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `order_id` (`order_id`),
  KEY `product_id` (`product_id`),
  CONSTRAINT `order_items_ibfk_1` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`),
  CONSTRAINT `order_items_ibfk_2` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=12 DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci;

CREATE TABLE `orders` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `order_number` varchar(20) NOT NULL,
  `customer_id` int(11) NOT NULL,
  `total_amount` decimal(10,2) NOT NULL,
  `status` enum('pending','paid','preparing','on_delivery','delivered') DEFAULT 'pending',
  `order_date` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `customer_id` (`customer_id`),
  CONSTRAINT `orders_ibfk_1` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=13 DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci;

CREATE TABLE `products` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL,
  `category` varchar(50) NOT NULL,
  `description` text DEFAULT NULL,
  `current_stock` int(11) NOT NULL DEFAULT 0,
  `minimum_stock` int(11) NOT NULL DEFAULT 5,
  `unit` varchar(20) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=9 DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci;
**/

// Get all products with pagination and filters
app.get('/api/products', async (req, res) => {
    try {
        const { page = 1, limit = 10, category = '', stock = '', search = '' } = req.query;
        const offset = (page - 1) * limit;

        const connection = await pool.getConnection();

        // Base query
        let query = `
                    SELECT p.id, p.name, p.category, p.current_stock, p.minimum_stock, p.unit, p.description,
                        CASE 
                            WHEN p.current_stock = 0 THEN 'out'
                            WHEN p.current_stock < p.minimum_stock THEN 'low'
                            ELSE 'normal'
                        END as stock_status
                    FROM products p
                    WHERE 1=1
                `;

        // Add filters
        const params = [];

        if (category) {
            query += ' AND p.category = ?';
            params.push(category);
        }

        if (stock === 'low') {
            query += ' AND p.current_stock < p.minimum_stock AND p.current_stock > 0';
        } else if (stock === 'out') {
            query += ' AND p.current_stock = 0';
        } else if (stock === 'normal') {
            query += ' AND p.current_stock >= p.minimum_stock';
        }

        if (search) {
            query += ' AND (p.name LIKE ? OR p.description LIKE ?)';
            params.push(`%${search}%`, `%${search}%`);
        }

        // Add pagination
        query += ' ORDER BY p.name ASC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));

        // Get products
        const [products] = await connection.query(query, params);

        // Get total count for pagination
        let countQuery = 'SELECT COUNT(*) as total FROM products p WHERE 1=1';
        const countParams = [];

        if (category) {
            countQuery += ' AND p.category = ?';
            countParams.push(category);
        }

        if (stock === 'low') {
            countQuery += ' AND p.current_stock < p.minimum_stock AND p.current_stock > 0';
        } else if (stock === 'out') {
            countQuery += ' AND p.current_stock = 0';
        } else if (stock === 'normal') {
            countQuery += ' AND p.current_stock >= p.minimum_stock';
        }

        if (search) {
            countQuery += ' AND (p.name LIKE ? OR p.description LIKE ?)';
            countParams.push(`%${search}%`, `%${search}%`);
        }

        const [countResult] = await connection.query(countQuery, countParams);

        // Get categories for filter dropdown
        const [categories] = await connection.query('SELECT DISTINCT category FROM products ORDER BY category');

        // Get stock counts for summary cards
        const [totalProducts] = await connection.query('SELECT COUNT(*) as total_count FROM products');
        const [lowStock] = await connection.query('SELECT COUNT(*) as low_count FROM products WHERE current_stock < minimum_stock AND current_stock > 0');
        const [outOfStock] = await connection.query('SELECT COUNT(*) as out_count FROM products WHERE current_stock = 0');

        connection.release();

        res.json({
            products,
            total: countResult[0].total,
            page: parseInt(page),
            limit: parseInt(limit),
            categories: categories.map(c => c.category),
            counts: {
                total: totalProducts[0].total_count,
                low: lowStock[0].low_count,
                out: outOfStock[0].out_count
            }
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Add new product
app.post('/api/products', async (req, res) => {
    try {
        const { name, category, current_stock, minimum_stock, unit, description } = req.body;

        const connection = await pool.getConnection();

        const [result] = await connection.query(
            'INSERT INTO products (name, category, current_stock, minimum_stock, unit, description) VALUES (?, ?, ?, ?, ?, ?)',
            [name, category, current_stock, minimum_stock, unit, description]
        );

        connection.release();

        res.json({
            success: true,
            productId: result.insertId
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Update product
app.put('/api/products/:id', async (req, res) => {
    try {
        const productId = req.params.id;
        const { name, category, current_stock, minimum_stock, unit, description } = req.body;

        const connection = await pool.getConnection();

        await connection.query(
            'UPDATE products SET name = ?, category = ?, current_stock = ?, minimum_stock = ?, unit = ?, description = ? WHERE id = ?',
            [name, category, current_stock, minimum_stock, unit, description, productId]
        );

        connection.release();

        res.json({ success: true });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Delete product
app.delete('/api/products/:id', async (req, res) => {
    try {
        const productId = req.params.id;

        const connection = await pool.getConnection();

        await connection.query('DELETE FROM products WHERE id = ?', [productId]);

        connection.release();

        res.json({ success: true });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Get product categories
app.get('/api/products/categories', async (req, res) => {
    try {
        const connection = await pool.getConnection();

        const [categories] = await connection.query('SELECT DISTINCT category FROM products ORDER BY category');

        connection.release();

        res.json(categories.map(c => c.category));
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Database error' });
    }
});









// RECEITAS.HTML
// Add these endpoints to your server.js file for recipes functionality

/*
CREATE TABLE `recipe_ingredients` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `recipe_id` int(11) NOT NULL,
  `product_id` int(11) NOT NULL,
  `quantity` decimal(10,2) NOT NULL,
  `unit` varchar(20) NOT NULL,
  `notes` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `recipe_id` (`recipe_id`),
  KEY `product_id` (`product_id`),
  CONSTRAINT `recipe_ingredients_ibfk_1` FOREIGN KEY (`recipe_id`) REFERENCES `recipes` (`id`) ON DELETE CASCADE,
  CONSTRAINT `recipe_ingredients_ibfk_2` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci;

CREATE TABLE `recipe_log` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `recipe_id` int(11) NOT NULL,
  `action` enum('viewed','prepared','printed') NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `recipe_id` (`recipe_id`),
  CONSTRAINT `recipe_log_ibfk_1` FOREIGN KEY (`recipe_id`) REFERENCES `recipes` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=16 DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci;

CREATE TABLE `recipes` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL,
  `category` varchar(50) NOT NULL,
  `prep_time` int(11) NOT NULL,
  `image_url` varchar(255) DEFAULT NULL,
  `instructions` text NOT NULL,
  `notes` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci;
 **/








// Get all recipes with pagination and filters
app.get('/api/recipes', async (req, res) => {
    try {
        const { page = 1, limit = 9, category = '', search = '' } = req.query;
        const offset = (page - 1) * limit;

        const connection = await pool.getConnection();

        // Base query
        let query = `
                    SELECT r.id, r.name, r.category, r.prep_time, r.image_url, 
                           COUNT(ri.id) as ingredients_count,
                           SUM(CASE WHEN p.current_stock = 0 THEN 1 ELSE 0 END) as missing_ingredients
                    FROM recipes r
                    LEFT JOIN recipe_ingredients ri ON r.id = ri.recipe_id
                    LEFT JOIN products p ON ri.product_id = p.id
                    WHERE 1=1
                `;

        // Add filters
        const params = [];

        if (category) {
            query += ' AND r.category = ?';
            params.push(category);
        }

        if (search) {
            query += ' AND (r.name LIKE ? OR r.description LIKE ?)';
            params.push(`%${search}%`, `%${search}%`);
        }

        // Group and pagination
        query += ' GROUP BY r.id ORDER BY r.name ASC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));

        // Get recipes
        const [recipes] = await connection.query(query, params);

        // Get total count for pagination
        let countQuery = 'SELECT COUNT(*) as total FROM recipes r WHERE 1=1';
        const countParams = [];

        if (category) {
            countQuery += ' AND r.category = ?';
            countParams.push(category);
        }

        if (search) {
            countQuery += ' AND (r.name LIKE ? OR r.description LIKE ?)';
            countParams.push(`%${search}%`, `%${search}%`);
        }

        const [countResult] = await connection.query(countQuery, countParams);

        // Get categories for filter dropdown
        const [categories] = await connection.query('SELECT DISTINCT category FROM recipes ORDER BY category');

        // Get recipe counts for summary cards
        const [totalRecipes] = await connection.query('SELECT COUNT(*) as total FROM recipes');
        const [popularRecipes] = await connection.query(`
                    SELECT COUNT(*) as popular 
                    FROM recipes r
                    JOIN recipe_log l ON r.id = l.recipe_id
                    WHERE l.action = 'prepared' 
                    AND l.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
                `);
        const [missingIngredients] = await connection.query(`
                    SELECT COUNT(DISTINCT r.id) as missing
                    FROM recipes r
                    JOIN recipe_ingredients ri ON r.id = ri.recipe_id
                    JOIN products p ON ri.product_id = p.id
                    WHERE p.current_stock = 0
                `);

        connection.release();

        res.json({
            recipes,
            total: countResult[0].total,
            page: parseInt(page),
            limit: parseInt(limit),
            categories,
            counts: {
                total: totalRecipes[0].total,
                popular: popularRecipes[0].popular,
                missing: missingIngredients[0].missing
            }
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Get recipe details by ID
app.get('/api/recipes/:id', async (req, res) => {
    try {
        const recipeId = req.params.id;
        const connection = await pool.getConnection();

        // Get basic recipe info
        const [recipe] = await connection.query('SELECT * FROM recipes WHERE id = ?', [recipeId]);

        if (recipe.length === 0) {
            connection.release();
            return res.status(404).json({ error: 'Recipe not found' });
        }

        // Get ingredients
        const [ingredients] = await connection.query(`
                    SELECT ri.id, p.name, ri.quantity, ri.unit, ri.notes, 
                           CASE WHEN p.current_stock = 0 THEN 1 ELSE 0 END as missing
                    FROM recipe_ingredients ri
                    JOIN products p ON ri.product_id = p.id
                    WHERE ri.recipe_id = ?
                `, [recipeId]);

        connection.release();

        res.json({
            ...recipe[0],
            ingredients
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Add new recipe
app.post('/api/recipes', async (req, res) => {
    try {
        const { name, category, prep_time, image_url, instructions, notes, ingredients } = req.body;
        const connection = await pool.getConnection();

        // Start transaction
        await connection.beginTransaction();

        // Insert recipe
        const [recipeResult] = await connection.query(
            'INSERT INTO recipes (name, category, prep_time, image_url, instructions, notes) VALUES (?, ?, ?, ?, ?, ?)',
            [name, category, prep_time, image_url, instructions, notes]
        );

        const recipeId = recipeResult.insertId;

        // Insert ingredients
        for (const ingredient of ingredients) {
            await connection.query(
                'INSERT INTO recipe_ingredients (recipe_id, product_id, quantity, unit, notes) VALUES (?, ?, ?, ?, ?)',
                [recipeId, ingredient.product_id, ingredient.quantity, ingredient.unit, ingredient.notes]
            );
        }

        // Commit transaction
        await connection.commit();
        connection.release();

        res.json({
            success: true,
            recipeId
        });
    } catch (error) {
        console.error(error);
        if (connection) {
            await connection.rollback();
            connection.release();
        }
        res.status(500).json({ error: 'Database error' });
    }
});

// Update recipe
app.put('/api/recipes/:id', async (req, res) => {
    try {
        const recipeId = req.params.id;
        const { name, category, prep_time, image_url, instructions, notes, ingredients } = req.body;
        const connection = await pool.getConnection();

        // Start transaction
        await connection.beginTransaction();

        // Update recipe
        await connection.query(
            'UPDATE recipes SET name = ?, category = ?, prep_time = ?, image_url = ?, instructions = ?, notes = ? WHERE id = ?',
            [name, category, prep_time, image_url, instructions, notes, recipeId]
        );

        // Delete existing ingredients
        await connection.query('DELETE FROM recipe_ingredients WHERE recipe_id = ?', [recipeId]);

        // Insert new ingredients
        for (const ingredient of ingredients) {
            await connection.query(
                'INSERT INTO recipe_ingredients (recipe_id, product_id, quantity, unit, notes) VALUES (?, ?, ?, ?, ?)',
                [recipeId, ingredient.product_id, ingredient.quantity, ingredient.unit, ingredient.notes]
            );
        }

        // Commit transaction
        await connection.commit();
        connection.release();

        res.json({ success: true });
    } catch (error) {
        console.error(error);
        if (connection) {
            await connection.rollback();
            connection.release();
        }
        res.status(500).json({ error: 'Database error' });
    }
});

// Delete recipe
app.delete('/api/recipes/:id', async (req, res) => {
    try {
        const recipeId = req.params.id;
        const connection = await pool.getConnection();

        // Start transaction
        await connection.beginTransaction();

        // Delete ingredients first
        await connection.query('DELETE FROM recipe_ingredients WHERE recipe_id = ?', [recipeId]);

        // Then delete recipe
        await connection.query('DELETE FROM recipes WHERE id = ?', [recipeId]);

        // Commit transaction
        await connection.commit();
        connection.release();

        res.json({ success: true });
    } catch (error) {
        console.error(error);
        if (connection) {
            await connection.rollback();
            connection.release();
        }
        res.status(500).json({ error: 'Database error' });
    }
});

// Get all products for ingredient selection
app.get('/api/products/select', async (req, res) => {
    try {
        const connection = await pool.getConnection();
        const [products] = await connection.query(
            'SELECT id, name, category, unit FROM products ORDER BY name'
        );
        connection.release();
        res.json(products);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Log recipe actions (prepared, viewed, etc.)
app.post('/api/recipes/:id/log', async (req, res) => {
    try {
        const recipeId = req.params.id;
        const { action } = req.body;
        const connection = await pool.getConnection();

        await connection.query(
            'INSERT INTO recipe_log (recipe_id, action) VALUES (?, ?)',
            [recipeId, action]
        );

        connection.release();
        res.json({ success: true });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Tables necessárias para essa tela
/*
CREATE TABLE IF NOT EXISTS recipes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    category VARCHAR(50) NOT NULL,
    prep_time INT NOT NULL,
    image_url VARCHAR(255),
    instructions TEXT NOT NULL,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS recipe_ingredients (
    id INT AUTO_INCREMENT PRIMARY KEY,
    recipe_id INT NOT NULL,
    product_id INT NOT NULL,
    quantity DECIMAL(10,2) NOT NULL,
    unit VARCHAR(20) NOT NULL,
    notes TEXT,
    FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS recipe_log (
    id INT AUTO_INCREMENT PRIMARY KEY,
    recipe_id INT NOT NULL,
    action ENUM('viewed', 'prepared', 'printed') NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE
);
*/


// SERVER.JS - TAREFAS.HTML ----------------------------------------------------------------------------------------------------------------------------------------
// Tables usadas para o tarefas.html
/*
CREATE TABLE IF NOT EXISTS task_categories (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(50) NOT NULL,
                color VARCHAR(20) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


CREATE TABLE IF NOT EXISTS tasks (
                id INT AUTO_INCREMENT PRIMARY KEY,
                title VARCHAR(255) NOT NULL,
                description TEXT,
                due_date DATETIME NOT NULL,
                priority ENUM('low', 'medium', 'high') NOT NULL DEFAULT 'medium',
                status ENUM('pending', 'in_progress', 'completed') NOT NULL DEFAULT 'pending',
                category_id INT,
                reminder_minutes INT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (category_id) REFERENCES task_categories(id) ON DELETE SET NULL
);



**/


// Add to your existing server.js

// Add these endpoints after your existing routes:

// Task Endpoints
app.get('/api/tasks', async (req, res) => {
    console.log('Query parameters:', req.query);
    try {
        const { search, filter, sort, page = 1, limit = 10 } = req.query;
        const offset = (page - 1) * limit;
        const connection = await pool.getConnection();

        let query = `
            SELECT t.*, tc.name AS category_name, tc.color AS category_color 
            FROM tasks t
            LEFT JOIN task_categories tc ON t.category_id = tc.id
            WHERE 1=1
        `;
        let params = [];
        let countQuery = 'SELECT COUNT(*) AS total FROM tasks t WHERE 1=1';
        let countParams = [];

        // Search filter
        if (search) {
            query += ' AND (t.title LIKE ? OR t.description LIKE ?)';
            params.push(`%${search}%`, `%${search}%`);
            countQuery += ' AND (t.title LIKE ? OR t.description LIKE ?)';
            countParams.push(`%${search}%`, `%${search}%`);
        }

        // Status filter
        if (filter && filter !== 'all') {
            if (filter === 'overdue') {
                query += ' AND t.due_date < NOW() AND t.status != "completed"';
                countQuery += ' AND t.due_date < NOW() AND t.status != "completed"';
            } else {
                query += ' AND t.status = ?';
                params.push(filter);
                countQuery += ' AND t.status = ?';
                countParams.push(filter);
            }
        }

        // Sorting
        switch (sort) {
            case 'due_date_asc':
                query += ' ORDER BY t.due_date ASC';
                break;
            case 'due_date_desc':
                query += ' ORDER BY t.due_date DESC';
                break;
            case 'priority_asc':
                query += ' ORDER BY FIELD(t.priority, "high", "medium", "low")';
                break;
            case 'priority_desc':
                query += ' ORDER BY FIELD(t.priority, "low", "medium", "high")';
                break;
            default:
                query += ' ORDER BY t.due_date ASC';
        }

        // Pagination
        query += ' LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));

        // Execute queries
        const [tasks] = await connection.query(query, params);
        const [countResult] = await connection.query(countQuery, countParams);
        // Formata as datas para ISO string
        const formattedTasks = tasks.map(task => ({
            ...task,
            due_date: task.due_date ? new Date(task.due_date).toISOString() : null
        }));

        connection.release();

        res.json({
            tasks: formattedTasks,
            total: countResult[0].total,
            page: parseInt(page),
            limit: parseInt(limit)
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Database error' });
    }
});

app.post('/api/tasks', async (req, res) => {
    console.log('Recebendo requisição POST /api/tasks');
    console.log('Headers:', req.headers)
    console.log('Corpo da requisição:', req.body);
    try {
        const { title, description, due_date, priority, status, category_id, reminder_minutes } = req.body;

        // Validação mais robusta
        if (!title || !due_date || !priority || !status) {
            console.log('Dados inválidos recebidos:', req.body);
            return res.status(400).json({
                success: false,
                error: "Dados incompletos",
                received: req.body
            });
        }
        const connection = await pool.getConnection();

        // Debug para crud create da task
        console.log('Inserindo no banco de dados:', {
            title, description, due_date, priority, status, 
            category_id, reminder_minutes
        });


        const [result] = await connection.query(
            `INSERT INTO tasks 
            (title, description, due_date, priority, status, category_id, reminder_minutes)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [title, description || null, due_date, priority, status, category_id || null, reminder_minutes || null]
        );

        // Debug para verificar o ID da tarefa inserida
        console.log('Tarefa inserida, ID:', result.insertId);
        

        // Recupera a tarefa com JOIN para incluir dados da categoria
        const [task] = await connection.query(`
            SELECT t.*, tc.name AS category_name, tc.color AS category_color 
            FROM tasks t
            LEFT JOIN task_categories tc ON t.category_id = tc.id
            WHERE t.id = ?
        `, [result.insertId]);

        connection.release();

        // Debug para verificar a tarefa recuperada
        console.log('Tarefa recuperada:', task[0]);

        res.json({
            success: true,
            task: task[0],  // Retorna a tarefa completa,
            message: "Tarefa criada com sucesso"
        });
    } catch (error) {
        console.error("Erro ao criar tarefa:", error);
        res.status(500).json({
            success: false,
            error: 'Erro ao criar tarefa',
            details: error.message,
            stack: error.stack
        });
    }
});

app.put('/api/tasks/:id', async (req, res) => {
    try {
        const taskId = req.params.id;
        const { title, description, due_date, priority, status, category_id, reminder_minutes } = req.body;
        const connection = await pool.getConnection();

        await connection.query(
            `UPDATE tasks SET
            title = ?, description = ?, due_date = ?, priority = ?,
            status = ?, category_id = ?, reminder_minutes = ?
            WHERE id = ?`,
            [title, description, due_date, priority, status,
                category_id || null, reminder_minutes, taskId]
        );

        connection.release();
        res.json({ success: true });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Database error' });
    }
});

app.delete('/api/tasks/:id', async (req, res) => {
    try {
        const taskId = req.params.id;
        const connection = await pool.getConnection();

        await connection.query('DELETE FROM tasks WHERE id = ?', [taskId]);
        connection.release();
        res.json({ success: true });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Task Categories Endpoints
app.get('/api/categories', async (req, res) => {
    try {
        const connection = await pool.getConnection();
        const [categories] = await connection.query('SELECT * FROM task_categories');
        connection.release();
        res.json(categories);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Erro ao buscar categorias' });
    }
});

app.post('/api/categories', async (req, res) => {
    try {
        const { name, color } = req.body;

        if (!name || !color) {
            return res.status(400).json({ error: "Nome e cor são obrigatórios" });
        }

        const connection = await pool.getConnection();

        const [result] = await connection.query(
            'INSERT INTO task_categories (name, color) VALUES (?, ?)',
            [name, color]
        );

        connection.release();
        res.json({
            success: true,
            categoryId: result.insertId,
            message: "Categoria criada com sucesso"
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Erro ao criar categoria' });
    }
});

// Task Statistics Endpoint
app.get('/api/tasks/summary', async (req, res) => {
    try {
        const connection = await pool.getConnection();

        const [total] = await connection.query('SELECT COUNT(*) AS total FROM tasks');
        const [completed] = await connection.query('SELECT COUNT(*) AS completed FROM tasks WHERE status = "completed"');
        const [pending] = await connection.query('SELECT COUNT(*) AS pending FROM tasks WHERE status != "completed"');
        const [overdue] = await connection.query('SELECT COUNT(*) AS overdue FROM tasks WHERE due_date < NOW() AND status != "completed"');

        connection.release();
        res.json({
            total: total[0].total,
            completed: completed[0].completed,
            pending: pending[0].pending,
            overdue: overdue[0].overdue
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Database error' });
    }
});



// END TAREFAS .HTML ----------------------------------------------------------------------------------------------------------------------------------------





// Initialize database and start server
initializeDatabase().then(() => {
    app.listen(port, () => {
        console.log(`Server running at http://localhost:${port}`);
    });
});

// To run this server:
// 1. Install dependencies: npm install express mysql2 cors
// 2. Run the server: node server.js