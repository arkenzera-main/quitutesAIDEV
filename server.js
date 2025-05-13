const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const app = express();
const path = require('path');
const port = 3000;

// Configuração do banco de dados
const dbConfig = {
    host: '127.0.0.1',
    user: 'root',
    password: '',
    database: 'quitutes_ai'
};

// Habilita o CORS para permitir requisições de outros domínios

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


// Database initialization
async function initializeDatabase() {
    try {
        const connection = await mysql.createConnection({
            host: dbConfig.host,
            user: dbConfig.user,
            password: dbConfig.password
        });

        await connection.query(`USE ${dbConfig.database}`);

        await connection.end();
        console.log('Database initialized successfully');
    } catch (error) {
        console.error('Error initializing database:', error);
    }
}





// DASHBOARD.HTML --------------------------------------------------------------------
// API endpoints
app.get('/api/dashboard/summary', async (req, res) => {
    try {
        const connection = await pool.getConnection();

        // 1. Vendas de hoje
        const [todaySales] = await connection.query(
            `SELECT IFNULL(SUM(total_amount), 0) as total 
             FROM orders 
             WHERE DATE(order_date) = CURDATE()`
        );

        // 2. Vendas de ontem (para cálculo da variação)
        const [yesterdaySales] = await connection.query(
            `SELECT IFNULL(SUM(total_amount), 0) as total 
             FROM orders 
             WHERE DATE(order_date) = DATE_SUB(CURDATE(), INTERVAL 1 DAY)`
        );

        // 3. Pedidos de hoje
        const [todayOrders] = await connection.query(
            `SELECT COUNT(*) as count 
             FROM orders 
             WHERE DATE(order_date) = CURDATE()`
        );

        // 4. Pedidos de ontem (para cálculo da variação)
        const [yesterdayOrders] = await connection.query(
            `SELECT COUNT(*) as count 
             FROM orders 
             WHERE DATE(order_date) = DATE_SUB(CURDATE(), INTERVAL 1 DAY)`
        );

        // 5. Produtos com estoque baixo
        const [lowStock] = await connection.query(
            `SELECT COUNT(*) as count 
             FROM products 
             WHERE current_stock < minimum_stock`
        );

        // 6. Novos clientes este mês
        const [newCustomers] = await connection.query(
            `SELECT COUNT(*) as count 
             FROM customers 
             WHERE MONTH(created_at) = MONTH(CURDATE()) 
             AND YEAR(created_at) = YEAR(CURDATE())`
        );

        connection.release();

        // Cálculo das variações percentuais
        const todaySalesValue = parseFloat(todaySales[0].total) || 0;
        const yesterdaySalesValue = parseFloat(yesterdaySales[0].total) || 0;
        const salesChange = yesterdaySalesValue > 0 ?
            ((todaySalesValue - yesterdaySalesValue) / yesterdaySalesValue * 100) : 0;

        const todayOrdersValue = parseInt(todayOrders[0].count) || 0;
        const yesterdayOrdersValue = parseInt(yesterdayOrders[0].count) || 0;
        const ordersChange = yesterdayOrdersValue > 0 ?
            ((todayOrdersValue - yesterdayOrdersValue) / yesterdayOrdersValue * 100) : 0;

        res.json({
            today_sales: todaySalesValue,
            sales_change: parseFloat(salesChange.toFixed(1)), // Arredonda para 1 decimal
            today_orders: todayOrdersValue,
            orders_change: parseFloat(ordersChange.toFixed(1)),
            low_stock_count: parseInt(lowStock[0].count) || 0,
            new_customers: parseInt(newCustomers[0].count) || 0
        });

    } catch (error) {
        console.error('Error in /api/dashboard/summary:', error);
        res.status(500).json({
            error: 'Database error',
            details: error.message
        });
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

// FIM ROTAS DASHBOARD.HTML


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





// ROTA QUE FAZ PARTA DA TELA RECEITAS.HTML POREM PRECISA VIR ANTES DE /api/products/:id
// Get all products for ingredient selection
app.get('/api/products/select', async (req, res) => {
    try {
        const connection = await pool.getConnection();
        const [products] = await connection.query(
            'SELECT id, name, category, unit FROM products ORDER BY name'
        );
        connection.release();

        if (products.length === 0) {
            return res.status(200).json([]); // Array vazio
        }

        res.json(products);

    } catch (error) {
        console.error(error);
        res.status(500).json({
            success: false,
            error: 'Erro ao carregar produtos'
        });
    }
});

// [1] Rota GET para listar produtos com paginação e filtros (refatorada)
// Rota para estoque.html com paginação e filtros
app.get('/api/products/paginated', async (req, res) => {
    try {
        const { page = 1, limit = 10, category, stock, search } = req.query;
        const offset = (parseInt(page) - 1) * parseInt(limit);
        const params = [];
        const filters = [];

        if (category) {
            filters.push('category = ?');
            params.push(category);
        }

        if (stock === 'low') {
            filters.push('current_stock < minimum_stock AND current_stock > 0');
        } else if (stock === 'out') {
            filters.push('current_stock = 0');
        } else if (stock === 'normal') {
            filters.push('current_stock >= minimum_stock');
        }

        if (search) {
            filters.push('(name LIKE ? OR description LIKE ?)');
            const searchTerm = `%${search}%`;
            params.push(searchTerm, searchTerm);
        }

        const whereClause = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';

        const [products] = await pool.query(`
            SELECT *, 
                CASE 
                    WHEN current_stock = 0 THEN 'out'
                    WHEN current_stock < minimum_stock THEN 'low' 
                    ELSE 'normal'
                END AS stock_status
            FROM products
            ${whereClause}
            ORDER BY name
            LIMIT ? OFFSET ?
        `, [...params, parseInt(limit), offset]);

        const [countResult] = await pool.query(`
            SELECT COUNT(*) AS total
            FROM products
            ${whereClause}
        `, params);

        const [stats] = await pool.query(`
            SELECT 
                COUNT(*) AS total,
                SUM(CASE WHEN current_stock = 0 THEN 1 ELSE 0 END) AS out_of_stock,
                SUM(CASE WHEN current_stock < minimum_stock AND current_stock > 0 THEN 1 ELSE 0 END) AS low_stock
            FROM products
        `);

        res.json({
            success: true,
            products,
            total: countResult[0].total,
            counts: {
                total: stats[0].total,
                low: stats[0].low_stock,
                out: stats[0].out_of_stock
            }
        });

    } catch (error) {
        console.error('Erro GET /api/products/paginated:', error);
        res.status(500).json({ success: false, error: 'Erro no servidor' });
    }
});













// [3] Rota POST para criar novo produto
app.post('/api/products', async (req, res) => {
    try {
        const { name, category, current_stock, minimum_stock, unit, description } = req.body;

        // Validação básica
        if (!name || !category || current_stock === undefined || !minimum_stock || !unit) {
            return res.status(400).json({
                success: false,
                error: 'Campos obrigatórios faltando'
            });
        }

        const [result] = await pool.query(
            `INSERT INTO products 
            (name, category, current_stock, minimum_stock, unit, description)
            VALUES (?, ?, ?, ?, ?, ?)`,
            [name, category, current_stock, minimum_stock, unit, description]
        );

        res.json({
            success: true,
            productId: result.insertId,
            message: 'Produto criado com sucesso'
        });

    } catch (error) {
        console.error('Erro POST /api/products:', error);
        res.status(500).json({ success: false, error: 'Erro ao criar produto' });
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




// Adicione esta rota ANTES da rota /api/recipes
app.get('/api/recipes/categories', async (req, res) => {
    try {
        const connection = await pool.getConnection();
        const [categories] = await connection.query('SELECT DISTINCT category FROM products ORDER BY category');
        connection.release();

        const categoryList = categories.map(c => c.category);
        res.json(categoryList);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Database error' });
    }
});



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
        query += ' GROUP BY r.id, r.name, r.category, r.prep_time, r.image_url ORDER BY r.name ASC LIMIT ? OFFSET ?';
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

        // Modifique a obtenção dos contadores para:
        const [totalRecipes] = await connection.query('SELECT COUNT(*) as total FROM recipes');
        const [popularRecipes] = await connection.query(`
    SELECT COUNT(DISTINCT r.id) as popular 
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
            categories: categories.map(c => c.category), // Envia array de categorias
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

// Rota para filtro de próximas tarefas
app.get('/api/tasks/upcoming', async (req, res) => {
    try {
        const { start, end } = req.query;
        const connection = await pool.getConnection();
        const query = `
            SELECT t.*, tc.name AS category_name, tc.color AS category_color 
            FROM tasks t
            LEFT JOIN task_categories tc ON t.category_id = tc.id
            WHERE t.due_date BETWEEN ? AND ?
            AND t.status != 'completed'
            ORDER BY t.due_date ASC
        `;
        const [tasksFromDb] = await connection.query(query, [start, end]);
        connection.release();

        const formattedTasks = tasksFromDb.map(task => {
            let isoDueDate = null;
            try {
                if (task.due_date) {
                    let year, month, day, hours, minutes, seconds;
                    if (task.due_date instanceof Date && !isNaN(task.due_date.getTime())) {
                        const dt = task.due_date;
                        year = dt.getFullYear();
                        month = dt.getMonth();
                        day = dt.getDate();
                        hours = dt.getHours();
                        minutes = dt.getMinutes();
                        seconds = dt.getSeconds();
                    } else {
                        const dateStr = String(task.due_date);
                        const parts = dateStr.match(/^(\\d{4})-(\\d{2})-(\\d{2}) (\\d{2}):(\\d{2}):(\\d{2})/);
                        if (parts) {
                            year = parseInt(parts[1], 10);
                            month = parseInt(parts[2], 10) - 1;
                            day = parseInt(parts[3], 10);
                            hours = parseInt(parts[4], 10);
                            minutes = parseInt(parts[5], 10);
                            seconds = parseInt(parts[6], 10);
                        } else {
                            console.error(`[UPCOMING_TASK_DATE_PARSE_ERROR] Formato de data inesperado para task ID ${task.id}: ${dateStr}`);
                        }
                    }
                    if (year !== undefined) {
                        isoDueDate = new Date(Date.UTC(year, month, day, hours, minutes, seconds)).toISOString();
                    }
                }
            } catch (e) {
                console.error(`[UPCOMING_TASK_DATE_CONVERT_ERROR] Erro processando data para task ID ${task.id}, due_date: '${task.due_date}':`, e);
            }
            return {
                ...task,
                due_date: isoDueDate
            };
        });

        res.json({ tasks: formattedTasks });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Database error' });
    }
});










// Rotas para tarefas.html
app.get('/api/tasks', async (req, res) => {
    console.log('Query parameters:', req.query);
    try {
        const { search, filter, sort, page = 1, limit = 10 } = req.query;
        const offset = (page - 1) * limit;
        const connection = await pool.getConnection();

        // Modificar a query para converter timezone
        let query = `
            SELECT 
                t.id,
                t.title,
                t.description,
                t.due_date,
                t.priority,
                t.status,
                t.category_id,
                t.reminder_minutes,
                tc.name AS category_name,
                tc.color AS category_color
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

        const formattedTasks = tasks.map(task => {
            let isoDueDate = null;
            try {
                if (task.due_date) {
                    let year, month, day, hours, minutes, seconds;
                    if (task.due_date instanceof Date && !isNaN(task.due_date.getTime())) {
                        const dt = task.due_date;
                        year = dt.getFullYear();
                        month = dt.getMonth();
                        day = dt.getDate();
                        hours = dt.getHours();
                        minutes = dt.getMinutes();
                        seconds = dt.getSeconds();
                    } else {
                        const dateStr = String(task.due_date);
                        const parts = dateStr.match(/^(\\d{4})-(\\d{2})-(\\d{2}) (\\d{2}):(\\d{2}):(\\d{2})/);
                        if (parts) {
                            year = parseInt(parts[1], 10);
                            month = parseInt(parts[2], 10) - 1;
                            day = parseInt(parts[3], 10);
                            hours = parseInt(parts[4], 10);
                            minutes = parseInt(parts[5], 10);
                            seconds = parseInt(parts[6], 10);
                        } else {
                            console.error(`[TASK_DATE_PARSE_ERROR] Formato de data inesperado para task ID ${task.id}: ${dateStr}`);
                        }
                    }
                    if (year !== undefined) {
                        isoDueDate = new Date(Date.UTC(year, month, day, hours, minutes, seconds)).toISOString();
                    }
                }
            } catch (e) {
                console.error(`[TASK_DATE_CONVERT_ERROR] Erro processando data para task ID ${task.id}, due_date: '${task.due_date}':`, e);
            }
            return {
                ...task,
                due_date: isoDueDate
            };
        });

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

// DELETE para categorias
app.delete('/api/categories/:id', async (req, res) => {
    try {
        const categoryId = req.params.id;
        const connection = await pool.getConnection();

        await connection.query('DELETE FROM task_categories WHERE id = ?', [categoryId]);
        connection.release();

        res.json({ success: true });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Erro ao excluir categoria' });
    }
});

// Adicione no server.js a rota para marcar lembrete
app.put('/api/tasks/:id/reminder', async (req, res) => {
    try {
        const taskId = req.params.id;
        const connection = await pool.getConnection();

        await connection.query(
            'UPDATE tasks SET reminder_sent = 1 WHERE id = ?',
            [taskId]
        );

        connection.release();
        res.json({ success: true });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Database error' });
    }
});



// END TAREFAS .HTML ----------------------------------------------------------------------------------------------------------------------------------------


// SERVER.JS - FINANCAS.HTML --------------------------------------------------------------------------------------------------------------------------------

// Rotas para Transações Financeiras
app.get('/api/transactions', async (req, res) => {
    try {
        const {
            start_date,
            end_date,
            type,
            category,
            order
        } = req.query;

        let query = `
            SELECT id, description, amount, type, category, 
                   DATE_FORMAT(transaction_date, '%Y-%m-%d') as date
            FROM financial_transactions
            WHERE 1=1
        `;

        const params = [];

        if (start_date && end_date) {
            query += ' AND transaction_date BETWEEN ? AND ?';
            params.push(start_date, end_date);
        } else {
            // Adicione validação para datas inválidas
            if (start_date) params.push(start_date);
            if (end_date) params.push(end_date);
        }

        if (type) {
            query += ' AND type = ?';
            params.push(type);
        }

        if (category) {
            query += ' AND category = ?';
            params.push(category);
        }

        // Ordenação
        const orderBy = {
            'data-asc': 'transaction_date ASC',
            'data-desc': 'transaction_date DESC',
            'valor-asc': 'amount ASC',
            'valor-desc': 'amount DESC'
        };

        query += ' ORDER BY ' + (orderBy[order] || 'transaction_date DESC');

        const [transactions] = await pool.query(query, params);

        res.json(transactions.map(t => ({
            ...t,
            amount: parseFloat(t.amount)  // Corrigido o parêntese faltante
        }))); // Fechamento corrigido aqui

    } catch (error) {
        console.error('Erro em /api/transactions:', error);
        res.status(500).json({ error: 'Erro ao buscar transações' });
    }
});

app.get('/api/finances/summary', async (req, res) => {
    try {
        const { start_date, end_date } = req.query;

        let query = `
            SELECT 
                SUM(CASE WHEN type = 'entrada' THEN amount ELSE 0 END) as total_income,
                SUM(CASE WHEN type = 'saida' THEN amount ELSE 0 END) as total_expenses,
                (SUM(CASE WHEN type = 'entrada' THEN amount ELSE 0 END) - 
                 SUM(CASE WHEN type = 'saida' THEN amount ELSE 0 END)) as balance
            FROM financial_transactions
            WHERE 1=1
        `;

        const params = [];

        if (start_date && end_date) {
            query += ' AND transaction_date BETWEEN ? AND ?';
            params.push(start_date, end_date);
        }

        const [result] = await pool.query(query, params);

        res.json({
            total_income: result[0].total_income || 0,
            total_expenses: result[0].total_expenses || 0,
            balance: result[0].balance || 0
        });

    } catch (error) {
        console.error('Erro em /api/finances/summary:', error);
        res.status(500).json({ error: 'Erro ao calcular resumo' });
    }
});

app.post('/api/transactions', async (req, res) => {
    try {
        const { description, amount, date, type, category } = req.body;

        const [result] = await pool.query(
            `INSERT INTO financial_transactions 
            (description, amount, transaction_date, type, category)
            VALUES (?, ?, ?, ?, ?)`,
            [description, amount, date, type, category]
        );

        res.json({
            id: result.insertId,
            message: 'Transação cadastrada com sucesso!'
        });

    } catch (error) {
        console.error('Erro ao criar transação:', error);
        res.status(500).json({ error: 'Erro ao salvar transação' });
    }
});

app.put('/api/transactions/:id', async (req, res) => {
    try {
        const { description, amount, date, type, category } = req.body;

        await pool.query(
            `UPDATE financial_transactions SET
                description = ?,
                amount = ?,
                transaction_date = ?,
                type = ?,
                category = ?
            WHERE id = ?`,
            [description, amount, date, type, category, req.params.id]
        );

        res.json({ message: 'Transação atualizada com sucesso!' });

    } catch (error) {
        console.error('Erro ao atualizar transação:', error);
        res.status(500).json({ error: 'Erro ao atualizar transação' });
    }
});

app.delete('/api/transactions/:id', async (req, res) => {
    try {
        await pool.query(
            'DELETE FROM financial_transactions WHERE id = ?',
            [req.params.id]
        );

        res.json({ message: 'Transação excluída com sucesso!' });

    } catch (error) {
        console.error('Erro ao excluir transação:', error);
        res.status(500).json({ error: 'Erro ao excluir transação' });
    }
});



// END FINANCAS.HTML --------------------------------------------------------------------------------------------------------------------------------



/// SERVER.JS - VENDAS.HTML --------------------------------------------------------------------------------------------------------
// CRUD READ
app.get('/api/sales', async (req, res) => {
    try {
        const connection = await pool.getConnection();

        const [orders] = await connection.query(`
            SELECT 
                o.id,
                o.order_number,
                o.status,
                o.total_amount,
                o.order_date,
                o.channel,
                c.name AS customer_name,
                o.ifood_order
            FROM orders o
            LEFT JOIN customers c ON o.customer_id = c.id 
            ORDER BY o.order_date DESC
        `);

        const [items] = await connection.query(`
            SELECT oi.order_id, p.name as product, oi.quantity, oi.unit_price
            FROM order_items oi
            JOIN products p ON oi.product_id = p.id
        `);

        connection.release();

        const sales = orders.map(order => {
            let isoOrderDate = null;
            try {
                if (order.order_date) {
                    let year, month, day, hours, minutes, seconds;
                    if (order.order_date instanceof Date && !isNaN(order.order_date.getTime())) {
                        const dt = order.order_date;
                        year = dt.getFullYear();
                        month = dt.getMonth(); 
                        day = dt.getDate();
                        hours = dt.getHours();
                        minutes = dt.getMinutes();
                        seconds = dt.getSeconds();
                    } else { 
                        const dateStr = String(order.order_date);
                        const parts = dateStr.match(/^(\\d{4})-(\\d{2})-(\\d{2}) (\\d{2}):(\\d{2}):(\\d{2})/);
                        if (parts) {
                            year = parseInt(parts[1], 10);
                            month = parseInt(parts[2], 10) - 1; 
                            day = parseInt(parts[3], 10);
                            hours = parseInt(parts[4], 10);
                            minutes = parseInt(parts[5], 10);
                            seconds = parseInt(parts[6], 10);
                        } else {
                            console.error(`[SALES_GET_DATE_PARSE_ERROR] Formato de order_date inesperado para order ID ${order.id}: ${dateStr}`);
                        }
                    }
                    if (year !== undefined) {
                        isoOrderDate = new Date(Date.UTC(year, month, day, hours, minutes, seconds)).toISOString();
                    }
                }
            } catch (e) {
                console.error(`[SALES_GET_DATE_CONVERT_ERROR] Erro processando order_date para order ID ${order.id}, data: '${order.order_date}':`, e);
            }

            return {
                ...order,
                items: items.filter(item => item.order_id === order.id).map(item => ({
                    product: item.product,
                    quantity: item.quantity,
                    valor: item.unit_price
                })),
                order_date: isoOrderDate
            };
        });

        res.json(sales);

    } catch (error) {
        console.error('Erro em /api/sales:', error);
        res.status(500).json({
            error: 'Database error',
            details: error.message
        });
    }
});



// Rota GET para listar todos os produtos (CORRIGIDA)
// Rota simplificada para vendas.html
app.get('/api/products', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM products');
        res.json(rows);
    } catch (error) {
        console.error('Erro GET /api/products:', error);
        res.status(500).json([]);
    }
});

// [2] Rota GET para buscar um produto específico
app.get('/api/products/:id', async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT * FROM products WHERE id = ?',
            [req.params.id]
        );

        if (rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Produto não encontrado' });
        }

        res.json({ success: true, product: rows[0] });
    } catch (error) {
        console.error('Erro GET /api/products/:id:', error);
        res.status(500).json({ success: false, error: 'Erro no servidor' });
    }
});

// [4] Rota PUT para atualizar produto
app.put('/api/products/:id', async (req, res) => {
    try {
        const productId = req.params.id;
        const { name, category, current_stock, minimum_stock, unit, description } = req.body;

        // Verifica se o produto existe
        const [check] = await pool.query(
            'SELECT id FROM products WHERE id = ?',
            [productId]
        );

        if (check.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Produto não encontrado'
            });
        }

        // Atualização
        await pool.query(
            `UPDATE products SET
                name = ?,
                category = ?,
                current_stock = ?,
                minimum_stock = ?,
                unit = ?,
                description = ?
            WHERE id = ?`,
            [name, category, current_stock, minimum_stock, unit, description, productId]
        );

        res.json({
            success: true,
            message: 'Produto atualizado com sucesso'
        });

    } catch (error) {
        console.error('Erro PUT /api/products/:id:', error);
        res.status(500).json({ success: false, error: 'Erro ao atualizar produto' });
    }
});

// [5] Rota DELETE para remover produto
app.delete('/api/products/:id', async (req, res) => {
    try {
        const [result] = await pool.query(
            'DELETE FROM products WHERE id = ?',
            [req.params.id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                error: 'Produto não encontrado'
            });
        }

        res.json({
            success: true,
            message: 'Produto excluído com sucesso'
        });

    } catch (error) {
        console.error('Erro DELETE /api/products/:id:', error);
        res.status(500).json({ success: false, error: 'Erro ao excluir produto' });
    }
});


// CRUD READ - Detalhes da venda
app.get('/api/sales/summary', async (req, res) => {
    try {
        const connection = await pool.getConnection();

        const [today] = await connection.query(`
            SELECT IFNULL(SUM(total_amount), 0) as total
            FROM orders
            WHERE DATE(order_date) = CURDATE()
        `);

        const [week] = await connection.query(`
            SELECT IFNULL(SUM(total_amount), 0) as total
            FROM orders
            WHERE YEARWEEK(order_date) = YEARWEEK(CURDATE())
        `);

        const [month] = await connection.query(`
            SELECT IFNULL(SUM(total_amount), 0) as total
            FROM orders
            WHERE MONTH(order_date) = MONTH(CURDATE())
            AND YEAR(order_date) = YEAR(CURDATE())
        `);

        const [pending] = await connection.query(`
            SELECT COUNT(*) as count
            FROM orders
            WHERE status IN ('pending', 'preparing')
        `);

        connection.release();

        // Garante que os valores sejam números
        res.json({
            today: parseFloat(today[0].total) || 0,
            week: parseFloat(week[0].total) || 0,
            month: parseFloat(month[0].total) || 0,
            pending: parseInt(pending[0].count) || 0
        });
    } catch (error) {
        console.error(error);
        // Retorna valores padrão em caso de erro
        res.json({
            today: 0,
            week: 0,
            month: 0,
            pending: 0
        });
    }
});

// CRUD CREATE - Rota corrigida
app.post('/api/sales', async (req, res) => {
    let connection;
    try {
        console.log('---------- NOVA REQUISIÇÃO POST /api/sales ----------');
        console.log('Body recebido:', JSON.stringify(req.body, null, 2));
        const { 
            customer, 
            channel, 
            items, 
            status, 
            observations, 
            order_date: orderDateString, // String do input datetime-local
            channelData 
        } = req.body;

        // Validação básica
        if (!items || !Array.isArray(items) || items.length === 0) {
            console.error('Erro: Items array inválido');
            return res.status(400).json({ error: "Lista de itens inválida" });
        }
        if (!status) return res.status(400).json({ error: "Status é obrigatório." });
        if (!orderDateString) return res.status(400).json({ error: "Data do pedido é obrigatória." });


        // Converter orderDateString (local do cliente) para UTC para o banco
        const orderDateObject = new Date(orderDateString); // Interpreta como local
        const order_date_utc = orderDateObject.toISOString().slice(0, 19).replace('T', ' ');


        connection = await pool.getConnection();
        await connection.beginTransaction();

        // 1. Verificar estoque para todos os itens
        console.log('Iniciando verificação de estoque...');
        const stockErrors = [];
        const productsToUpdate = [];

        for (const [index, item] of items.entries()) {
            console.log(`Processando item ${index + 1}:`, item);

            if (!item.product_id || !item.quantity) {
                throw new Error(`Item ${index + 1} está incompleto`);
            }

            const [product] = await connection.query(
                `SELECT id, name, current_stock 
                 FROM products 
                 WHERE id = ? 
                 LIMIT 1`,
                [parseInt(item.product_id)]
            );

            console.log(`Resultado da consulta do produto ${item.product_id}:`, product[0]);

            if (!product.length) {
                throw new Error(`Produto ID ${item.product_id} não encontrado`);
            }

            if (product[0].current_stock < item.quantity) {
                console.warn(`Estoque insuficiente para ${product[0].name}`);
                stockErrors.push({
                    product: product[0].name,
                    available: product[0].current_stock,
                    requested: item.quantity
                });
            } else {
                console.log(`Estoque suficiente para ${product[0].name}`);
                productsToUpdate.push({
                    id: product[0].id,
                    quantity: item.quantity
                });
            }
        }

        if (stockErrors.length > 0) {
            console.error('Erros de estoque:', stockErrors);
            await connection.rollback();
            return res.status(400).json({
                error: "Estoque insuficiente",
                details: stockErrors
            });
        }

        // 2. Criar order_number
        const [counter] = await connection.query(
            `SELECT MAX(CAST(SUBSTRING_INDEX(order_number, '-', -1) AS UNSIGNED)) AS last_seq 
             FROM orders 
             WHERE order_number LIKE ?`,
            [`${new Date().getFullYear()}%`]
        );
        const sequence = (counter[0].last_seq || 0) + 1;
        const orderNumber = `${new Date().getFullYear()}-${sequence.toString().padStart(4, '0')}`;

        // 3. Criar ou buscar cliente
        const [customerResult] = await connection.query(
            `INSERT INTO customers (name) VALUES (?) 
             ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)`,
            [customer]
        );
        const customer_id = customerResult.insertId || (await connection.query('SELECT id FROM customers WHERE name = ?', [customer]))[0][0].id;


        // 4. Inserir a ordem principal
        const [orderResult] = await connection.query(
            `INSERT INTO orders (
                order_number,
                customer_id, 
                total_amount, 
                status, 
                observations,
                channel,
                order_date,
                whatsapp_number,
                ifood_order,
                attendant
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                orderNumber,
                customer_id,
                0, // Placeholder para total_amount, será atualizado
                status,
                observations || null,
                channel,
                order_date_utc, // Data UTC
                channelData?.whatsapp || null,
                channelData?.ifood || null,
                channelData?.attendant || null
            ]
        );
        const orderId = orderResult.insertId;

        // 5. Inserir itens do pedido e calcular total_amount
        let calculatedTotalAmount = 0;
        for (const item of items) {
            const itemTotal = parseFloat(item.quantity) * parseFloat(item.unit_price);
            calculatedTotalAmount += itemTotal;
            await connection.query(
                `INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES (?, ?, ?, ?)`,
                [orderId, item.product_id, item.quantity, item.unit_price || item.valor]
            );
        }

        // Atualizar o total_amount na ordem criada
        await connection.query('UPDATE orders SET total_amount = ? WHERE id = ?', [calculatedTotalAmount, orderId]);


        // 6. Atualizar estoques
        for (const product of productsToUpdate) {
            await connection.query(
                `UPDATE products 
                 SET current_stock = current_stock - ? 
                 WHERE id = ?`,
                [product.quantity, product.id]
            );
        }

        await connection.commit();
        res.json({ success: true, message: 'Venda registrada com sucesso!' });

    } catch (error) {
        console.error('Erro durante o processamento:', error.message);
        console.error(error.stack);
        if (connection) await connection.rollback();
        res.status(500).json({
            error: error.message || "Erro interno no servidor",
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    } finally {
        if (connection) {
            console.log('Liberando conexão...');
            connection.release();
        }
    }
});

// CRUD READ Rota para buscar uma venda específica
app.get('/api/sales/:id', async (req, res) => {
    try {
        const connection = await pool.getConnection();

        const [order] = await connection.query(`
            SELECT 
                o.*, 
                c.name as customer_name,
                o.customer_id
            FROM orders o
            LEFT JOIN customers c ON o.customer_id = c.id
            WHERE o.id = ?
        `, [req.params.id]);

        if (!order.length) {
            connection.release();
            return res.status(404).json({ error: 'Venda não encontrada' });
        }

        const [items] = await connection.query(`
            SELECT 
                product_id as product,  -- Garantir o alias correto
                quantity,
                unit_price as valor
            FROM order_items
            WHERE order_id = ?
        `, [req.params.id]);

        connection.release();

        res.json({
            ...order[0],
            items: items, // Estrutura simplificada
            customer: order[0].customer_id // ID do cliente para o formulário
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Erro no banco de dados' });
    }
});


app.put('/api/sales/:id', async (req, res) => {
    let connection;
    try {
        const { id } = req.params; // ID da venda a ser atualizada

        console.log('[DEBUG] Body recebido para PUT /api/sales/' + id, req.body);

        const {
            status = null,
            observations = '',
            customer: customerName = null,
            order_date: orderDateString, // String do input datetime-local
            items: updatedItems = [] 
            // total_amount é omitido, será recalculado
        } = req.body;

        console.log(`[DEBUG] Status recebido do cliente para venda ID ${id}: ${status}`);

        const statusMap = {
            'pending': 'pending', 
            'paid': 'paid', 
            'preparing': 'preparing',
            'on_delivery': 'on_delivery',
            'delivered': 'delivered'
        };
        const dbStatus = statusMap[status] || 'pending';
        console.log(`[DEBUG] Status a ser salvo no BD para venda ID ${id} (dbStatus): ${dbStatus}`);

        // Mover a declaração para cá
        let customerIdToUpdate = null; 

        if (!status) {
            return res.status(400).json({ error: 'Status é obrigatório' });
        }

        let order_date_utc_for_update = null;
        if (orderDateString) {
            const orderDateObject = new Date(orderDateString); 
            order_date_utc_for_update = orderDateObject.toISOString().slice(0, 19).replace('T', ' ');
        }

        connection = await pool.getConnection();
        await connection.beginTransaction();

        if (customerName) {
            // Tenta inserir ou atualizar o nome (ON DUPLICATE KEY UPDATE não faz nada se o nome for o mesmo)
            // O principal objetivo aqui é garantir que o cliente exista.
            await connection.query(
                `INSERT INTO customers (name) VALUES (?) ON DUPLICATE KEY UPDATE name = VALUES(name)`,
                [customerName]
            );
            // Após garantir que o cliente existe, seleciona seu ID.
            const [customerRows] = await connection.query('SELECT id FROM customers WHERE name = ?', [customerName]);
            if (customerRows.length > 0) {
                customerIdToUpdate = customerRows[0].id;
            } else {
                // Isso não deveria acontecer se o INSERT/UPDATE acima funcionou
                await connection.rollback();
                return res.status(500).json({ error: 'Não foi possível encontrar o ID do cliente após inserção/atualização.' });
            }
            console.log(`[DEBUG] customerIdToUpdate para '${customerName}' é: ${customerIdToUpdate}`);
        }

        // 1. Deletar itens antigos do pedido
        await connection.query('DELETE FROM order_items WHERE order_id = ?', [id]);

        // 2. Recalcular o novo total_amount e inserir novos itens
        let newTotalAmount = 0;
        if (Array.isArray(updatedItems) && updatedItems.length > 0) {
            for (const item of updatedItems) {
                if (!item.product_id || isNaN(parseFloat(item.quantity)) || isNaN(parseFloat(item.unit_price))) {
                    await connection.rollback();
                    return res.status(400).json({ error: 'Dados de item inválidos.', item_recebido: item });
                }
                const itemTotal = parseFloat(item.quantity) * parseFloat(item.unit_price);
                newTotalAmount += itemTotal;

                await connection.query(
                    'INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES (?, ?, ?, ?)',
                    [id, item.product_id, item.quantity, item.unit_price]
                );
            }
        } else {
             // Se não houver itens, o total é 0, ou você pode optar por não permitir vendas sem itens
            console.warn(`[WARN] Venda ID ${id} está sendo atualizada sem itens. Total será 0.`);
        }


        // 3. Atualizar a tabela 'orders'
        let updateOrderQuery = 'UPDATE orders SET status = ?, observations = ?, total_amount = ?';
        const orderQueryParams = [dbStatus, observations, newTotalAmount];

        if (order_date_utc_for_update) { // Usa a data UTC convertida
            updateOrderQuery += ', order_date = ?';
            orderQueryParams.push(order_date_utc_for_update);
        }
        if (customerIdToUpdate) {
            updateOrderQuery += ', customer_id = ?';
            orderQueryParams.push(customerIdToUpdate);
        }
        
        updateOrderQuery += ' WHERE id = ?';
        orderQueryParams.push(id);

        console.log('[DEBUG] Final Update Order Query:', updateOrderQuery);
        console.log('[DEBUG] Final Order Query Params:', orderQueryParams);

        const [result] = await connection.query(updateOrderQuery, orderQueryParams);

        if (result.affectedRows === 0 && result.changedRows === 0) {
            // Nenhum erro, mas nada mudou. Pode ser que os dados enviados fossem idênticos.
            // Ou o ID da venda não foi encontrado (embora o delete de itens teria falhado antes).
            // Considerar se isso deve ser um erro ou apenas uma indicação.
            // Por ora, se não houve erro na query, consideramos sucesso.
            console.log(`[INFO] Update para venda ID ${id} não resultou em linhas afetadas ou alteradas.`)
        }

        await connection.commit();
        res.json({
            success: true,
            message: 'Venda atualizada com sucesso!',
            updated_fields: { 
                status: dbStatus, 
                observations, 
                total_amount: newTotalAmount, 
                customerId: customerIdToUpdate, 
                order_date: order_date_utc_for_update, // Usar a variável correta
                items_count: updatedItems.length 
            }
        });

    } catch (error) {
        // Rollback seguro
        if (connection && connection.rollback) {
            console.log('[ROLLBACK] Executando rollback...');
            await connection.rollback();
        }

        // Log detalhado do erro
        console.error('[ERROR] Erro na rota PUT /api/sales:', {
            message: error.message,
            stack: error.stack,
            params: req.params,
            body: req.body
        });

        res.status(500).json({
            error: 'Erro interno no servidor',
            debug: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    } finally {
        // Liberação segura da conexão
        if (connection && connection.release) {
            connection.release();
        }
    }
});

// Rota para deletar uma venda
app.delete('/api/sales/:id', async (req, res) => {
    try {
        const connection = await pool.getConnection();
        await connection.beginTransaction();

        await connection.query('DELETE FROM order_items WHERE order_id = ?', [req.params.id]);
        await connection.query('DELETE FROM orders WHERE id = ?', [req.params.id]);

        await connection.commit();
        connection.release();

        res.json({ success: true });
    } catch (error) {
        await connection.rollback();
        connection.release();
        console.error(error);
        res.status(500).json({ error: 'Database error' });
    }
});

// END VENDAS .HTML ------------------------------------------------------------------------------------------



// SERVER.JS - SUSTENTABILIDADE.HTML ----------------------------------------------------------------------------------------------------------------------------------------
// Rotas para Sustentabilidade
app.get('/api/sustainability/stats', async (req, res) => {
    try {
        const connection = await pool.getConnection();

        // Total de óleo reciclado
        const [oilResult] = await connection.query(
            'SELECT SUM(amount) AS total FROM oil_disposals WHERE MONTH(disposal_date) = MONTH(CURRENT_DATE())'
        );

        // Cálculos ambientais
        const totalOil = parseFloat(oilResult[0].total) || 0;
        const co2Saved = totalOil * 1.5; // 1.5kg por litro
        const waterSaved = totalOil * 25000; // 25.000 litros por litro

        connection.release();

        res.json({
            totalOil,
            co2Saved,
            waterSaved
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Database error' });
    }
});

app.get('/api/sustainability/disposals', async (req, res) => {
    try {
        const connection = await pool.getConnection();
        const [disposals] = await connection.query(
            'SELECT id, product, amount, disposal_date, notes ' + // Removi o responsible
            'FROM oil_disposals ' +
            'ORDER BY disposal_date DESC ' +
            'LIMIT 10'
        );
        connection.release();

        res.json(disposals);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Database error' });
    }
});

app.post('/api/sustainability/disposals', async (req, res) => {
    try {
        const { product, amount, date, notes } = req.body;
        const connection = await pool.getConnection();

        const [result] = await connection.query(
            'INSERT INTO oil_disposals (product, amount, disposal_date, notes) ' + // Removi o responsible
            'VALUES (?, ?, ?, ?)', // Ajuste o número de parâmetros
            [product, amount, date, notes] // Removi o último valor
        );

        connection.release();
        res.json({ success: true, id: result.insertId });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Database error' });
    }
});

app.delete('/api/sustainability/disposals/:id', async (req, res) => {
    try {
        const connection = await pool.getConnection();
        await connection.query(
            'DELETE FROM oil_disposals WHERE id = ?',
            [req.params.id]
        );
        connection.release();
        res.json({ success: true });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Database error' });
    }
});

// END SUSTENTABILIDADE.HTML ----------------------------------------------------------------------------------------------------------------------------------------




// INICIALIZAÇÃO DO BANCO DE DADOS E INICIO DO SERVIDOR -- DEVE FICAR POR ÚLTIMO 
initializeDatabase().then(() => {
    app.listen(port, () => {
        console.log(`Server running at http://localhost:${port}`);
    });
});

// Para rodar o servidor:
// 1. Instale as dependências: npm install 
// 2. Rodar o servidor: node server.js
