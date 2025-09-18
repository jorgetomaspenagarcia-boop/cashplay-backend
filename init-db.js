const db = require('./db');

async function setupDatabase() {
    try {
        console.log('Verificando y creando tablas...');

        // 1. Tabla de Usuarios (ya la teníamos)
        await db.query(`
            CREATE TABLE IF NOT EXISTS users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                email VARCHAR(255) NOT NULL UNIQUE,
                password VARCHAR(255) NOT NULL,
                balance DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 2. Tabla para el Historial de Partidas
        await db.query(`
            CREATE TABLE IF NOT EXISTS games (
                id INT AUTO_INCREMENT PRIMARY KEY,
                winner_id INT,
                pot_amount DECIMAL(10, 2) NOT NULL,
                app_fee DECIMAL(10, 2) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (winner_id) REFERENCES users(id)
            );
        `);

        // 3. Tabla para las Transacciones ( crucial para el dinero)
        await db.query(`
            CREATE TABLE IF NOT EXISTS transactions (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                type ENUM('deposit', 'withdrawal', 'bet', 'win') NOT NULL,
                amount DECIMAL(10, 2) NOT NULL,
                game_id INT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id),
                FOREIGN KEY (game_id) REFERENCES games(id)
            );
        `);

        console.log('✅ ¡Tablas verificadas o creadas exitosamente!');
    } catch (error) {
        console.error('❌ Error al configurar la base de datos:', error);
    } finally {
        await db.end();
    }
}

setupDatabase();
