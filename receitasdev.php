<!DOCTYPE html>
<html lang="pt-br">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Receitas - Quitutes</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <style>
        .sidebar {
            transition: all 0.3s;
        }

        .sidebar.collapsed {
            width: 80px;
        }

        .sidebar.collapsed .nav-text {
            display: none;
        }

        .sidebar.collapsed .logo-text {
            display: none;
        }

        .sidebar.collapsed .nav-item {
            justify-content: center;
        }

        .main-content {
            transition: all 0.3s;
        }

        .sidebar.collapsed+.main-content {
            margin-left: 80px;
        }

        .popup {
            animation: fadeIn 0.3s ease-out;
        }

        @keyframes fadeIn {
            from {
                opacity: 0;
                transform: translate(-50%, -45%);
            }
            to {
                opacity: 1;
                transform: translate(-50%, -50%);
            }
        }

        .overlay {
            background-color: rgba(0, 0, 0, 0.5);
            backdrop-filter: blur(4px);
        }

        .card-hover:hover {
            transform: translateY(-5px);
            box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
        }

        .recipe-card:hover .recipe-image {
            transform: scale(1.05);
        }

        .recipe-image {
            transition: transform 0.3s ease;
        }

        .truncate-2-lines {
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
            overflow: hidden;
        }

        .ingredient-input-group {
            display: flex;
            gap: 8px;
            margin-bottom: 8px;
        }

        .ingredient-input {
            flex: 1;
        }

        .preview-image {
            max-height: 200px;
            object-fit: cover;
            border-radius: 8px;
            margin-top: 10px;
        }
    </style>
</head>

<body class="bg-gray-50">
    <?php
    // Configurações do banco de dados
    $servername = "localhost";
    $username = "root";
    $password = "";
    $dbname = "quitutes_ai";

    // Criar conexão
    $conn = new mysqli($servername, $username, $password, $dbname);

    // Verificar conexão
    if ($conn->connect_error) {
        die("Connection failed: " . $conn->connect_error);
    }

    // Criar tabela receitas se não existir
    $sql = "CREATE TABLE IF NOT EXISTS receitas (
        id INT(6) UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        titulo VARCHAR(100) NOT NULL,
        categoria VARCHAR(50) NOT NULL,
        ingredientes TEXT NOT NULL,
        modo_preparo TEXT,
        tempo_preparo INT(6),
        rendimento VARCHAR(50),
        imagem VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )";
    $conn->query($sql);

    // Sistema de autenticação
    session_start();

    // Verificar se o usuário está logado
    $logged_in = isset($_SESSION['user_id']);
    $user_name = $logged_in ? $_SESSION['user_name'] : '';

    // Se não estiver logado, redirecionar para login
    if (!$logged_in) {
        header("Location: dashboard.php");
        exit();
    }

    // Diretório para upload de imagens
    $upload_dir = 'uploads/';
    if (!file_exists($upload_dir)) {
        mkdir($upload_dir, 0777, true);
    }

    // Processar adição de receita
    if ($_SERVER['REQUEST_METHOD'] == 'POST' && isset($_POST['adicionar_receita'])) {
        $titulo = $conn->real_escape_string($_POST['titulo']);
        $categoria = $conn->real_escape_string($_POST['categoria']);
        $ingredientes = $conn->real_escape_string($_POST['ingredientes']);
        $modo_preparo = $conn->real_escape_string($_POST['modo_preparo']);
        $tempo_preparo = (int)$_POST['tempo_preparo'];
        $rendimento = $conn->real_escape_string($_POST['rendimento']);
        $imagem = '';

        // Processar upload de imagem
        if (isset($_FILES['imagem']) && $_FILES['imagem']['error'] == UPLOAD_ERR_OK) {
            $file_name = basename($_FILES['imagem']['name']);
            $file_ext = strtolower(pathinfo($file_name, PATHINFO_EXTENSION));
            $allowed_ext = ['jpg', 'jpeg', 'png', 'gif'];
            
            if (in_array($file_ext, $allowed_ext)) {
                if ($_FILES['imagem']['size'] <= 2 * 1024 * 1024) { // 2MB max
                    $new_file_name = uniqid('recipe_', true) . '.' . $file_ext;
                    $upload_path = $upload_dir . $new_file_name;
                    
                    if (move_uploaded_file($_FILES['imagem']['tmp_name'], $upload_path)) {
                        $imagem = $new_file_name;
                    } else {
                        $_SESSION['error_message'] = "Erro ao fazer upload da imagem.";
                    }
                } else {
                    $_SESSION['error_message'] = "A imagem deve ter no máximo 2MB.";
                    error_log("Image Size Error: " . $_FILES['imagem']['size']);
                }
            } else {
                $_SESSION['error_message'] = "Apenas imagens JPG, JPEG, PNG e GIF são permitidas.";
                error_log("Invalid Image Extension: " . $file_ext);
            }
        }

        if (!isset($_SESSION['error_message'])) {
            $stmt = $conn->prepare("INSERT INTO receitas (titulo, categoria, ingredientes, modo_preparo, tempo_preparo, rendimento, imagem) VALUES (?, ?, ?, ?, ?, ?, ?)");
            $stmt->bind_param("ssssiss", $titulo, $categoria, $ingredientes, $modo_preparo, $tempo_preparo, $rendimento, $imagem);
            
            if ($stmt->execute()) {
                $_SESSION['success_message'] = "Receita adicionada com sucesso!";
                header("Location: receitasdev.php");
                exit();
            } else {
                $_SESSION['error_message'] = "Erro ao adicionar receita: " . $stmt->error;
                error_log("Recipe Insert Error: " . $stmt->error);
            }
            $stmt->close();
        }
    }

    // Processar atualização de receita
    if ($_SERVER['REQUEST_METHOD'] == 'POST' && isset($_POST['atualizar_receita'])) {
        $id = (int)$_POST['id'];
        $titulo = $conn->real_escape_string($_POST['titulo']);
        $categoria = $conn->real_escape_string($_POST['categoria']);
        $ingredientes = $conn->real_escape_string($_POST['ingredientes']);
        $modo_preparo = $conn->real_escape_string($_POST['modo_preparo']);
        $tempo_preparo = (int)$_POST['tempo_preparo'];
        $rendimento = $conn->real_escape_string($_POST['rendimento']);
        $imagem_atual = $conn->real_escape_string($_POST['imagem_atual']);
        $imagem = $imagem_atual;

        // Processar upload de nova imagem
        if (isset($_FILES['imagem']) && $_FILES['imagem']['error'] == UPLOAD_ERR_OK) {
            $file_name = basename($_FILES['imagem']['name']);
            $file_ext = strtolower(pathinfo($file_name, PATHINFO_EXTENSION));
            $allowed_ext = ['jpg', 'jpeg', 'png', 'gif'];
            
            if (in_array($file_ext, $allowed_ext)) {
                if ($_FILES['imagem']['size'] <= 2 * 1024 * 1024) { // 2MB max
                    $new_file_name = uniqid('recipe_', true) . '.' . $file_ext;
                    $upload_path = $upload_dir . $new_file_name;
                    
                    if (move_uploaded_file($_FILES['imagem']['tmp_name'], $upload_path)) {
                        // Remover imagem antiga se existir
                        if ($imagem_atual && file_exists($upload_dir . $imagem_atual)) {
                            unlink($upload_dir . $imagem_atual);
                        }
                        $imagem = $new_file_name;
                    } else {
                        $_SESSION['error_message'] = "Erro ao fazer upload da imagem.";
                    }
                } else {
                    $_SESSION['error_message'] = "A imagem deve ter no máximo 2MB.";
                }
            } else {
                $_SESSION['error_message'] = "Apenas imagens JPG, JPEG, PNG e GIF são permitidas.";
            }
        }

        if (!isset($_SESSION['error_message'])) {
            $stmt = $conn->prepare("UPDATE receitas SET titulo = ?, categoria = ?, ingredientes = ?, modo_preparo = ?, tempo_preparo = ?, rendimento = ?, imagem = ? WHERE id = ?");
            $stmt->bind_param("ssssissi", $titulo, $categoria, $ingredientes, $modo_preparo, $tempo_preparo, $rendimento, $imagem, $id);
            $stmt->execute();
            
            $_SESSION['success_message'] = "Receita atualizada com sucesso!";
            header("Location: receitas.php");
            exit();
        }
    }

    // Processar remoção de receita
    if (isset($_GET['remover_receita'])) {
        $id = (int)$_GET['remover_receita'];
        
        // Obter nome da imagem para remover
        $sql = "SELECT imagem FROM receitas WHERE id = $id";
        $result = $conn->query($sql);
        if ($result->num_rows > 0) {
            $row = $result->fetch_assoc();
            if ($row['imagem'] && file_exists($upload_dir . $row['imagem'])) {
                unlink($upload_dir . $row['imagem']);
            }
        }
        
        $stmt = $conn->prepare("DELETE FROM receitas WHERE id = ?");
        $stmt->bind_param("i", $id);
        $stmt->execute();
        
        $_SESSION['success_message'] = "Receita removida com sucesso!";
        header("Location: receitas.php");
        exit();
    }

    // Obter lista de receitas
    $receitas = [];
    $sql = "SELECT * FROM receitas ORDER BY created_at DESC";
    $result = $conn->query($sql);
    if ($result->num_rows > 0) {
        while ($row = $result->fetch_assoc()) {
            $receitas[] = $row;
        }
    }

    // Obter categorias de receitas
    $categorias = [];
    $sql = "SELECT DISTINCT categoria FROM receitas ORDER BY categoria ASC";
    $result = $conn->query($sql);
    if ($result->num_rows > 0) {
        while ($row = $result->fetch_assoc()) {
            $categorias[] = $row['categoria'];
        }
    }

    // Gerar token CSRF
    if (empty($_SESSION['csrf_token'])) {
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
    }
    $csrf_token = $_SESSION['csrf_token'];
    ?>

    <div class="flex h-screen">
        <!-- Sidebar -->
        <div class="sidebar bg-indigo-700 text-white w-64 flex flex-col fixed h-full">
            <a href="dashboard.php">
                <div class="p-4 flex items-center space-x-3 border-b border-indigo-600">
                    <div class="bg-white p-2 rounded-lg">
                        <i class="fas fa-cookie-bite text-indigo-700 text-xl"></i>
                    </div>
                    <span class="logo-text font-bold text-xl">Quitutes</span>
                </div>
            </a>

            <div class="p-4 flex-1 overflow-y-auto">
                <nav>
                    <ul class="space-y-2">
                        <li>
                            <a href="dashboard.php" class="nav-item flex items-center p-3 rounded-lg hover:bg-indigo-800 transition">
                                <i class="fas fa-tachometer-alt mr-3"></i>
                                <span class="nav-text">Dashboard</span>
                            </a>
                        </li>
                        <li>
                            <a href="estoque.php" class="nav-item flex items-center p-3 rounded-lg hover:bg-indigo-800 transition">
                                <i class="fas fa-box-open mr-3"></i>
                                <span class="nav-text">Estoque</span>
                            </a>
                        </li>
                        <li>
                            <a href="receitas.php" class="nav-item flex items-center p-3 rounded-lg bg-indigo-800">
                                <i class="fas fa-utensils mr-3"></i>
                                <span class="nav-text">Receitas</span>
                            </a>
                        </li>
                        <li>
                            <a href="tarefas.php" class="nav-item flex items-center p-3 rounded-lg hover:bg-indigo-800 transition">
                                <i class="fas fa-tasks mr-3"></i>
                                <span class="nav-text">Tarefas</span>
                            </a>
                        </li>
                        <li>
                            <a href="financas.php" class="nav-item flex items-center p-3 rounded-lg hover:bg-indigo-800 transition">
                                <i class="fas fa-money-bill-wave mr-3"></i>
                                <span class="nav-text">Finanças</span>
                            </a>
                        </li>
                        <li>
                            <a href="vendas.php" class="nav-item flex items-center p-3 rounded-lg hover:bg-indigo-800 transition">
                                <i class="fas fa-shopping-cart mr-3"></i>
                                <span class="nav-text">Vendas</span>
                            </a>
                        </li>
                        <li>
                            <a href="relatorios.php" class="nav-item flex items-center p-3 rounded-lg hover:bg-indigo-800 transition">
                                <i class="fas fa-chart-bar mr-3"></i>
                                <span class="nav-text">Relatórios</span>
                            </a>
                        </li>
                        <li>
                            <a href="sustentabilidade.php" class="nav-item flex items-center p-3 rounded-lg hover:bg-indigo-800 transition">
                                <i class="fas fa-leaf mr-3"></i>
                                <span class="nav-text">Sustentabilidade</span>
                            </a>
                        </li>
                        <li>
                            <a href="config.php" class="nav-item flex items-center p-3 rounded-lg hover:bg-indigo-800 transition">
                                <i class="fas fa-cog mr-3"></i>
                                <span class="nav-text">Configurações</span>
                            </a>
                        </li>
                    </ul>
                </nav>
            </div>

            <div class="p-4 border-t border-indigo-600">
                <button id="toggle-sidebar" class="flex items-center justify-center w-full p-2 rounded-lg hover:bg-indigo-800 transition">
                    <i class="fas fa-chevron-left"></i>
                    <span class="nav-text ml-3">Recolher</span>
                </button>
                <div class="mt-4 pt-4 border-t border-indigo-600">
                    <a href="?logout=1" class="flex items-center p-2 rounded-lg hover:bg-indigo-800 transition">
                        <i class="fas fa-sign-out-alt mr-3"></i>
                        <span class="nav-text">Sair</span>
                    </a>
                </div>
            </div>
        </div>

        <!-- Main Content -->
        <div class="main-content ml-64 flex-1 overflow-y-auto">
            <!-- Header -->
            <header class="bg-white shadow-sm p-4 flex justify-between items-center sticky top-0 z-10">
                <h1 class="text-2xl font-bold text-gray-800">
                    <i class="fas fa-utensils text-indigo-600 mr-2"></i>
                    Receitas
                </h1>

                <div class="flex items-center space-x-4">
                    <div class="relative">
                        <i class="fas fa-search absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400"></i>
                        <input type="text" placeholder="Pesquisar receitas..." id="search-input"
                            class="pl-10 pr-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500">
                    </div>

                    <div class="flex items-center space-x-2">
                        <div class="relative">
                            <i class="fas fa-bell text-gray-600 text-xl cursor-pointer hover:text-indigo-600"></i>
                            <span class="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center">3</span>
                        </div>

                        <div class="flex items-center space-x-2">
                            <div class="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center cursor-pointer">
                                <i class="fas fa-user text-indigo-600"></i>
                            </div>
                            <span class="text-sm font-medium"><?php echo htmlspecialchars($user_name); ?></span>
                        </div>
                    </div>
                </div>
            </header>

            <!-- Content -->
            <main class="p-6">
                <?php if (isset($_SESSION['success_message'])): ?>
                <div class="bg-green-100 border-l-4 border-green-500 text-green-700 p-4 mb-6 rounded">
                    <div class="flex items-center">
                        <i class="fas fa-check-circle mr-2"></i>
                        <p><?php echo $_SESSION['success_message']; ?></p>
                    </div>
                    <?php unset($_SESSION['success_message']); ?>
                </div>
                <?php endif; ?>

                <?php if (isset($_SESSION['error_message'])): ?>
                <div class="bg-red-100 border-l-4 border-red-500 text-red-700 p-4 mb-6 rounded">
                    <div class="flex items-center">
                        <i class="fas fa-exclamation-circle mr-2"></i>
                        <p><?php echo $_SESSION['error_message']; ?></p>
                    </div>
                    <?php unset($_SESSION['error_message']); ?>
                </div>
                <?php endif; ?>

                <!-- Add Recipe Button -->
                <div class="flex justify-between items-center mb-6">
                    <h2 class="text-lg font-semibold text-gray-800">
                        <i class="fas fa-book-open text-indigo-600 mr-2"></i>
                        Minhas Receitas
                    </h2>
                    <button onclick="openAddPopup()" class="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg transition flex items-center">
                        <i class="fas fa-plus mr-2"></i>
                        Nova Receita
                    </button>
                </div>

                <!-- Filter Controls -->
                <div class="bg-white rounded-xl shadow-sm p-4 mb-6">
                    <div class="flex flex-wrap items-center gap-4">
                        <div class="flex-1 min-w-[200px]">
                            <label for="filter-category" class="block text-sm font-medium text-gray-700 mb-1">Filtrar por Categoria</label>
                            <select id="filter-category" class="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500">
                                <option value="">Todas as categorias</option>
                                <?php foreach ($categorias as $cat): ?>
                                <option value="<?php echo htmlspecialchars($cat); ?>"><?php echo htmlspecialchars($cat); ?></option>
                                <?php endforeach; ?>
                            </select>
                        </div>
                        <div class="flex-1 min-w-[200px]">
                            <label for="filter-sort" class="block text-sm font-medium text-gray-700 mb-1">Ordenar por</label>
                            <select id="filter-sort" class="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500">
                                <option value="newest">Mais recentes</option>
                                <option value="oldest">Mais antigas</option>
                                <option value="title">Título (A-Z)</option>
                            </select>
                        </div>
                    </div>
                </div>

                <!-- Recipes Grid -->
                <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-6" id="recipes-container">
                    <?php foreach ($receitas as $receita): ?>
                    <div class="bg-white rounded-xl shadow-sm overflow-hidden recipe-card transition">
                        <div class="h-48 overflow-hidden">
                            <?php if ($receita['imagem']): ?>
                            <img src="<?php echo $upload_dir . $receita['imagem']; ?>" alt="<?php echo htmlspecialchars($receita['titulo']); ?>" class="w-full h-full object-cover recipe-image">
                            <?php else: ?>
                            <div class="w-full h-full bg-gray-200 flex items-center justify-center recipe-image">
                                <i class="fas fa-utensils text-gray-400 text-4xl"></i>
                            </div>
                            <?php endif; ?>
                        </div>
                        <div class="p-4">
                            <div class="flex justify-between items-start mb-2">
                                <h3 class="text-lg font-semibold text-gray-800"><?php echo htmlspecialchars($receita['titulo']); ?></h3>
                                <span class="px-2 py-1 text-xs rounded-full bg-indigo-100 text-indigo-800">
                                    <?php echo htmlspecialchars($receita['categoria']); ?>
                                </span>
                            </div>
                            <div class="text-sm text-gray-600 mb-3 truncate-2-lines">
                                <?php echo nl2br(htmlspecialchars($receita['modo_preparo'])); ?>
                            </div>
                            <div class="flex justify-between items-center text-sm text-gray-500">
                                <div>
                                    <i class="fas fa-clock mr-1"></i>
                                    <?php echo $receita['tempo_preparo'] ? $receita['tempo_preparo'] . ' min' : '--'; ?>
                                </div>
                                <div>
                                    <i class="fas fa-utensils mr-1"></i>
                                    <?php echo $receita['rendimento'] ? htmlspecialchars($receita['rendimento']) : '--'; ?>
                                </div>
                            </div>
                        </div>
                        <div class="px-4 py-3 border-t flex justify-end space-x-2">
                            <button onclick="openEditPopup(
                                <?php echo $receita['id']; ?>,
                                '<?php echo addslashes($receita['titulo']); ?>',
                                '<?php echo addslashes($receita['categoria']); ?>',
                                `<?php echo addslashes($receita['ingredientes']); ?>`,
                                `<?php echo addslashes($receita['modo_preparo']); ?>`,
                                <?php echo $receita['tempo_preparo']; ?>,
                                '<?php echo addslashes($receita['rendimento']); ?>',
                                '<?php echo $receita['imagem']; ?>'
                            )" class="text-indigo-600 hover:text-indigo-900 px-3 py-1 rounded-lg hover:bg-indigo-50 transition">
                                <i class="fas fa-edit"></i>
                            </button>
                            <a href="receitas.php?remover_receita=<?php echo $receita['id']; ?>" onclick="return confirm('Tem certeza que deseja remover esta receita?')" class="text-red-600 hover:text-red-900 px-3 py-1 rounded-lg hover:bg-red-50 transition">
                                <i class="fas fa-trash-alt"></i>
                            </a>
                        </div>
                    </div>
                    <?php endforeach; ?>
                    
                    <?php if (empty($receitas)): ?>
                    <div class="col-span-full text-center py-10">
                        <i class="fas fa-utensils text-gray-300 text-5xl mb-4"></i>
                        <h3 class="text-lg font-medium text-gray-500">Nenhuma receita cadastrada</h3>
                        <p class="text-gray-400 mt-1">Comece adicionando sua primeira receita</p>
                        <button onclick="openAddPopup()" class="mt-4 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg transition flex items-center mx-auto">
                            <i class="fas fa-plus mr-2"></i>
                            Adicionar Receita
                        </button>
                    </div>
                    <?php endif; ?>
                </div>
            </main>
        </div>
    </div>

    <!-- Add Recipe Popup -->
    <div id="add-popup-overlay" class="fixed inset-0 overlay z-50 hidden"></div>
    <div id="add-popup" class="hidden fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-white rounded-xl shadow-xl z-50 w-full max-w-2xl popup">
        <div class="p-6 max-h-[90vh] overflow-y-auto">
            <div class="flex justify-between items-center mb-4">
                <h3 class="text-xl font-bold text-gray-800">
                    <i class="fas fa-plus-circle text-indigo-600 mr-2"></i>
                    Adicionar Nova Receita
                </h3>
                <button id="close-add-popup" class="text-gray-400 hover:text-gray-600">
                    <i class="fas fa-times"></i>
                </button>
            </div>

            <form id="add-form" method="POST" enctype="multipart/form-data" class="space-y-4">
                <input type="hidden" name="adicionar_receita" value="1">
                <input type="hidden" name="csrf_token" value="<?php echo $csrf_token; ?>">

                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label for="add-titulo" class="block text-sm font-medium text-gray-700 mb-1">Título*</label>
                        <input type="text" id="add-titulo" name="titulo" required
                            class="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500">
                    </div>

                    <div>
                        <label for="add-categoria" class="block text-sm font-medium text-gray-700 mb-1">Categoria*</label>
                        <input type="text" id="add-categoria" name="categoria" list="categorias-list" required
                            class="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500">
                        <datalist id="categorias-list">
                            <?php foreach ($categorias as $cat): ?>
                            <option value="<?php echo htmlspecialchars($cat); ?>">
                            <?php endforeach; ?>
                        </datalist>
                    </div>
                </div>

                <div>
                    <label for="add-ingredientes" class="block text-sm font-medium text-gray-700 mb-1">Ingredientes*</label>
                    <p class="text-xs text-gray-500 mb-2">Formato: ingrediente:quantidade:unidade (ex: Farinha de trigo:2:xícaras)</p>
                    <textarea id="add-ingredientes" name="ingredientes" rows="4" required
                        class="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"></textarea>
                    <button type="button" onclick="addIngredientRow()" class="mt-2 text-sm text-indigo-600 hover:text-indigo-800 flex items-center">
                        <i class="fas fa-plus-circle mr-1"></i>
                        Adicionar ingrediente
                    </button>
                </div>

                <div>
                    <label for="add-modo-preparo" class="block text-sm font-medium text-gray-700 mb-1">Modo de Preparo</label>
                    <textarea id="add-modo-preparo" name="modo_preparo" rows="4"
                        class="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"></textarea>
                </div>

                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label for="add-tempo-preparo" class="block text-sm font-medium text-gray-700 mb-1">Tempo de Preparo (min)</label>
                        <input type="number" id="add-tempo-preparo" name="tempo_preparo" min="0"
                            class="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500">
                    </div>

                    <div>
                        <label for="add-rendimento" class="block text-sm font-medium text-gray-700 mb-1">Rendimento</label>
                        <input type="text" id="add-rendimento" name="rendimento"
                            class="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500">
                    </div>
                </div>

                <div>
                    <label for="add-imagem" class="block text-sm font-medium text-gray-700 mb-1">Imagem da Receita</label>
                    <input type="file" id="add-imagem" name="imagem" accept="image/*"
                        class="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                        onchange="previewImage(this, 'add-preview')">
                    <div class="text-xs text-gray-500 mt-1">Formatos: JPG, PNG, GIF (Máx. 2MB)</div>
                    <img id="add-preview" class="preview-image hidden">
                </div>

                <div class="flex justify-end space-x-3 pt-4">
                    <button type="button" onclick="closeAddPopup()"
                        class="px-6 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 rounded-lg transition">
                        Cancelar
                    </button>
                    <button type="submit"
                        class="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition flex items-center">
                        <i class="fas fa-save mr-2"></i>
                        Salvar Receita
                    </button>
                </div>
            </form>
        </div>
    </div>

    <!-- Edit Recipe Popup -->
    <div id="edit-popup-overlay" class="fixed inset-0 overlay z-50 hidden"></div>
    <div id="edit-popup" class="hidden fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-white rounded-xl shadow-xl z-50 w-full max-w-2xl popup">
        <div class="p-6 max-h-[90vh] overflow-y-auto">
            <div class="flex justify-between items-center mb-4">
                <h3 class="text-xl font-bold text-gray-800">
                    <i class="fas fa-edit text-indigo-600 mr-2"></i>
                    Editar Receita
                </h3>
                <button id="close-edit-popup" class="text-gray-400 hover:text-gray-600">
                    <i class="fas fa-times"></i>
                </button>
            </div>

            <form id="edit-form" method="POST" enctype="multipart/form-data" class="space-y-4">
                <input type="hidden" name="atualizar_receita" value="1">
                <input type="hidden" name="csrf_token" value="<?php echo $csrf_token; ?>">
                <input type="hidden" id="edit-id" name="id">
                <input type="hidden" id="edit-imagem-atual" name="imagem_atual">

                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label for="edit-titulo" class="block text-sm font-medium text-gray-700 mb-1">Título*</label>
                        <input type="text" id="edit-titulo" name="titulo" required
                            class="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500">
                    </div>

                    <div>
                        <label for="edit-categoria" class="block text-sm font-medium text-gray-700 mb-1">Categoria*</label>
                        <input type="text" id="edit-categoria" name="categoria" list="categorias-list" required
                            class="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500">
                    </div>
                </div>

                <div>
                    <label for="edit-ingredientes" class="block text-sm font-medium text-gray-700 mb-1">Ingredientes*</label>
                    <p class="text-xs text-gray-500 mb-2">Formato: ingrediente:quantidade:unidade (ex: Farinha de trigo:2:xícaras)</p>
                    <textarea id="edit-ingredientes" name="ingredientes" rows="4" required
                        class="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"></textarea>
                    <button type="button" onclick="addIngredientRow('edit')" class="mt-2 text-sm text-indigo-600 hover:text-indigo-800 flex items-center">
                        <i class="fas fa-plus-circle mr-1"></i>
                        Adicionar ingrediente
                    </button>
                </div>

                <div>
                    <label for="edit-modo-preparo" class="block text-sm font-medium text-gray-700 mb-1">Modo de Preparo</label>
                    <textarea id="edit-modo-preparo" name="modo_preparo" rows="4"
                        class="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"></textarea>
                </div>

                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label for="edit-tempo-preparo" class="block text-sm font-medium text-gray-700 mb-1">Tempo de Preparo (min)</label>
                        <input type="number" id="edit-tempo-preparo" name="tempo_preparo" min="0"
                            class="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500">
                    </div>

                    <div>
                        <label for="edit-rendimento" class="block text-sm font-medium text-gray-700 mb-1">Rendimento</label>
                        <input type="text" id="edit-rendimento" name="rendimento"
                            class="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500">
                    </div>
                </div>

                <div>
                    <label for="edit-imagem" class="block text-sm font-medium text-gray-700 mb-1">Imagem da Receita</label>
                    <input type="file" id="edit-imagem" name="imagem" accept="image/*"
                        class="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                        onchange="previewImage(this, 'edit-preview')">
                    <div class="text-xs text-gray-500 mt-1">Formatos: JPG, PNG, GIF (Máx. 2MB)</div>
                    <img id="edit-preview" class="preview-image hidden">
                    <div id="current-image-container" class="mt-2">
                        <span class="text-sm text-gray-600">Imagem atual:</span>
                        <img id="current-image" class="preview-image">
                    </div>
                </div>

                <div class="flex justify-end space-x-3 pt-4">
                    <button type="button" onclick="closeEditPopup()"
                        class="px-6 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 rounded-lg transition">
                        Cancelar
                    </button>
                    <button type="submit"
                        class="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition flex items-center">
                        <i class="fas fa-save mr-2"></i>
                        Salvar Alterações
                    </button>
                </div>
            </form>
        </div>
    </div>

    <script>
        // Toggle sidebar
        document.getElementById('toggle-sidebar').addEventListener('click', function () {
            document.querySelector('.sidebar').classList.toggle('collapsed');
            document.querySelector('.main-content').classList.toggle('ml-64');
            document.querySelector('.main-content').classList.toggle('ml-20');

            const icon = this.querySelector('i');
            if (document.querySelector('.sidebar').classList.contains('collapsed')) {
                icon.classList.remove('fa-chevron-left');
                icon.classList.add('fa-chevron-right');
            } else {
                icon.classList.remove('fa-chevron-right');
                icon.classList.add('fa-chevron-left');
            }
        });

        // Add recipe popup functions
        function openAddPopup() {
            document.getElementById('add-popup-overlay').classList.remove('hidden');
            document.getElementById('add-popup').classList.remove('hidden');
        }

        function closeAddPopup() {
            document.getElementById('add-popup-overlay').classList.add('hidden');
            document.getElementById('add-popup').classList.add('hidden');
            document.getElementById('add-preview').classList.add('hidden');
            document.getElementById('add-form').reset();
        }

        document.getElementById('close-add-popup').addEventListener('click', closeAddPopup);
        document.getElementById('add-popup-overlay').addEventListener('click', closeAddPopup);

        // Edit recipe popup functions
        function openEditPopup(id, titulo, categoria, ingredientes, modo_preparo, tempo_preparo, rendimento, imagem) {
            document.getElementById('edit-id').value = id;
            document.getElementById('edit-titulo').value = titulo;
            document.getElementById('edit-categoria').value = categoria;
            document.getElementById('edit-ingredientes').value = ingredientes;
            document.getElementById('edit-modo-preparo').value = modo_preparo;
            document.getElementById('edit-tempo-preparo').value = tempo_preparo;
            document.getElementById('edit-rendimento').value = rendimento;
            document.getElementById('edit-imagem-atual').value = imagem;

            // Handle image preview
            const currentImageContainer = document.getElementById('current-image-container');
            const currentImage = document.getElementById('current-image');
            const editPreview = document.getElementById('edit-preview');
            
            editPreview.classList.add('hidden');
            
            if (imagem) {
                currentImage.src = '<?php echo $upload_dir; ?>' + imagem;
                currentImageContainer.classList.remove('hidden');
            } else {
                currentImageContainer.classList.add('hidden');
            }

            document.getElementById('edit-popup-overlay').classList.remove('hidden');
            document.getElementById('edit-popup').classList.remove('hidden');
        }

        function closeEditPopup() {
            document.getElementById('edit-popup-overlay').classList.add('hidden');
            document.getElementById('edit-popup').classList.add('hidden');
            document.getElementById('edit-preview').classList.add('hidden');
        }

        document.getElementById('close-edit-popup').addEventListener('click', closeEditPopup);
        document.getElementById('edit-popup-overlay').addEventListener('click', closeEditPopup);

        // Image preview function
        function previewImage(input, previewId) {
            const preview = document.getElementById(previewId);
            const file = input.files[0];
            
            if (file) {
                const reader = new FileReader();
                
                reader.onload = function(e) {
                    preview.src = e.target.result;
                    preview.classList.remove('hidden');
                    
                    // Hide current image in edit mode
                    if (previewId === 'edit-preview') {
                        document.getElementById('current-image-container').classList.add('hidden');
                    }
                }
                
                reader.readAsDataURL(file);
            }
        }

        // Add ingredient row helper
        function addIngredientRow(formType = 'add') {
            const textarea = document.getElementById(`${formType}-ingredientes`);
            const currentValue = textarea.value.trim();
            
            if (currentValue) {
                textarea.value = currentValue + '\nNovo ingrediente:quantidade:unidade';
            } else {
                textarea.value = 'Ingrediente:quantidade:unidade';
            }
            
            textarea.focus();
        }

        // Filter and search functionality
        document.addEventListener('DOMContentLoaded', function() {
            const searchInput = document.getElementById('search-input');
            const filterCategory = document.getElementById('filter-category');
            const filterSort = document.getElementById('filter-sort');
            const recipesContainer = document.getElementById('recipes-container');
            
            // Auto-close success message after 5 seconds
            const successMessage = document.querySelector('.bg-green-100');
            if (successMessage) {
                setTimeout(() => {
                    successMessage.style.opacity = '0';
                    setTimeout(() => successMessage.remove(), 300);
                }, 5000);
            }
            
            // Filter recipes based on search and filters
            function filterRecipes() {
                const searchTerm = searchInput.value.toLowerCase();
                const category = filterCategory.value;
                const sort = filterSort.value;
                
                // In a real application, you would fetch filtered data from the server
                // Here we're just simulating client-side filtering for the demo
                const recipeCards = recipesContainer.querySelectorAll('.recipe-card');
                
                recipeCards.forEach(card => {
                    const title = card.querySelector('h3').textContent.toLowerCase();
                    const recipeCategory = card.querySelector('span').textContent;
                    
                    const matchesSearch = title.includes(searchTerm);
                    const matchesCategory = !category || recipeCategory === category;
                    
                    if (matchesSearch && matchesCategory) {
                        card.style.display = 'block';
                    } else {
                        card.style.display = 'none';
                    }
                });
                
                // Sort recipes (client-side for demo)
                const cardsArray = Array.from(recipeCards).filter(card => card.style.display !== 'none');
                
                cardsArray.sort((a, b) => {
                    const aTitle = a.querySelector('h3').textContent;
                    const bTitle = b.querySelector('h3').textContent;
                    
                    if (sort === 'title') {
                        return aTitle.localeCompare(bTitle);
                    } else if (sort === 'oldest') {
                        // In a real app, you would use actual dates from data attributes
                        return 1; // Just a placeholder
                    } else {
                        // Default: newest first
                        return -1; // Just a placeholder
                    }
                });
                
                // Re-append sorted cards
                cardsArray.forEach(card => {
                    recipesContainer.appendChild(card);
                });
            }
            
            // Add event listeners
            searchInput.addEventListener('input', filterRecipes);
            filterCategory.addEventListener('change', filterRecipes);
            filterSort.addEventListener('change', filterRecipes);
        });
    </script>
</body>

</html>