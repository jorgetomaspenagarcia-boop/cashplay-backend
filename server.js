// --- 1. IMPORTACIONES ---
const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require("socket.io");
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const db = require('./db.js');
const SerpientesYEscaleras = require('./SerpientesYEscaleras.js');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const Ajedrez = require('./Ajedrez.js'); // <-- NUEVA IMPORTACIÓN
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

// --- 2. CONFIGURACIÓN INICIAL DE EXPRESS Y SOCKET.IO ---
const app = express();
app.use(express.json());
app.use(cors({ origin: 'https://cashplay.space' }));

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "https://cashplay.space", methods: ["GET", "POST"] }
});
const PORT = process.env.PORT || 3000;

// --- 3. VARIABLES GLOBALES DEL JUEGO ---
const activeGames = {};
const gameConfigs = {
    snakesAndLadders: { gameClass: SerpientesYEscaleras, playersRequired: 4, betAmount: 1.00 },
    chess: { gameClass: Ajedrez, playersRequired: 2, betAmount: 5.00 }
};
let waitingQueues = {
    snakesAndLadders: [],
    chess: []
};

// --- 4. MIDDLEWARE DE AUTENTICACIÓN PARA LA API ---
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Formato: "Bearer TOKEN"
    if (token == null) return res.sendStatus(401);
    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
}

function authenticateAdmin(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ message: 'Token requerido' });

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ message: 'Token inválido' });
        if (user.role !== 'admin') return res.status(403).json({ message: 'No autorizado' });
        req.admin = user;
        next();
    });
}

// --- 5. RUTAS DE LA API ---
// Login de admin
app.post('/api/admin/login', async (req, res) => {
    const { user, password } = req.body;
    if (!user || !password) return res.status(400).json({ message: "Usuario y contraseña requeridos" });
    try {
        const [rows] = await db.query("SELECT * FROM adminusers WHERE user = ?", [user]);
        if (rows.length === 0) return res.status(404).json({ message: "Admin no encontrado" });
        const admin = rows[0];
        const match = await bcrypt.compare(password, admin.password);
        if (!match) return res.status(401).json({ message: "Contraseña incorrecta" });

        const token = jwt.sign({ id: admin.id, user: admin.user, role: admin.role }, process.env.JWT_SECRET, { expiresIn: '8h' });
        res.json({ message: "Login exitoso", token });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Error en el servidor" });
    }
});

// Registro
app.post('/api/register', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) { return res.status(400).json({ message: 'El email y la contraseña son obligatorios.' }); }
        const [existingUsers] = await db.query('SELECT id FROM users WHERE email = ?', [email]);
        if (existingUsers.length > 0) { return res.status(409).json({ message: 'Este correo electrónico ya está registrado.' }); }
        const hashedPassword = await bcrypt.hash(password, 10);
        await db.query('INSERT INTO users (email, password) VALUES (?, ?)', [email, hashedPassword]);
        res.status(201).json({ message: 'Usuario registrado exitosamente.' });
    } catch (error) {
        console.error('Error registro:', error);
        res.status(500).json({ message: 'Error interno del servidor.' });
    }
});

// Login
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) { return res.status(400).json({ message: 'El email y la contraseña son obligatorios.' }); }
        const [users] = await db.query('SELECT id, email, COALESCE(balance, 0) AS balance, password FROM users WHERE email = ?', [email]);
        if (users.length === 0) { return res.status(404).json({ message: 'El usuario no existe.' }); }
        const user = users[0];
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) return res.status(401).json({ message: 'Contraseña incorrecta.' });
        const token = jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '1d' });
        res.json({ token, user: { id: user.id, email: user.email, balance: Number(user.balance) } });
    } catch (error) {
        console.error('Error login:', error);
        res.status(500).json({ message: 'Error interno.' });
    }
});

// Historial de usuario
app.get('/api/user/history', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const [games] = await db.query('SELECT * FROM games WHERE id IN (SELECT game_id FROM transactions WHERE user_id = ?) ORDER BY created_at DESC LIMIT 10', [userId]);
        const [transactions] = await db.query('SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 10', [userId]);
        res.json({ games, transactions });
    } catch (error) {
        console.error('Error historial:', error);
        res.status(500).json({ message: 'Error interno.' });
    }
});

// Crear payment intent
app.post('/api/create-payment-intent', authenticateToken, async (req, res) => {
    try {
        const { amount } = req.body;
        if (!amount || amount <= 0) return res.status(400).json({ error: 'Monto inválido.' });
        const paymentIntent = await stripe.paymentIntents.create({
            amount: Math.round(amount * 100),
            currency: 'mxn',
            automatic_payment_methods: { enabled: true }
        });
        res.json({ clientSecret: paymentIntent.client_secret });
    } catch (error) {
        console.error('Error Stripe:', error);
        res.status(500).json({ error: error.message });
    }
});

// Actualizar balance después de pago
app.post('/api/update-balance-after-payment', authenticateToken, async (req, res) => {
    const { amount } = req.body;
    if (!amount || amount <= 0) return res.status(400).json({ error: 'Monto inválido.' });
    const userId = req.user.id;
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        await connection.query('UPDATE users SET balance = balance + ? WHERE id = ?', [amount, userId]);
        await connection.query('INSERT INTO transactions (user_id, type, amount) VALUES (?, ?, ?)', [userId, 'deposit', amount]);
        await connection.commit();
        const [[user]] = await connection.query('SELECT COALESCE(balance,0) AS balance FROM users WHERE id = ?', [userId]);
        res.json({ newBalance: Number(user.balance) });
    } catch (error) {
        await connection.rollback();
        console.error('Error actualizar balance:', error);
        res.status(500).json({ error: 'Error al actualizar saldo.' });
    } finally {
        connection.release();
    }
});

// --- Solicitar retiro ---
app.post("/api/withdraw", authenticateToken, async (req, res) => {
  const { amount, account_info } = req.body;
  const userId = req.user.id;
  if (!amount || amount <= 0) {
    return res.status(400).json({ message: "Monto inválido" });
  }
  if (!account_info) {
    return res.status(400).json({ message: "Debe ingresar una cuenta de retiro" });
  }
  try {
    const [rows] = await db.query("SELECT balance FROM users WHERE id = ?", [userId]);
    if (rows.length === 0) return res.status(404).json({ message: "Usuario no encontrado" });
    const balance = rows[0].balance;
    if (balance < amount) return res.status(400).json({ message: "Saldo insuficiente" });

    await db.query("UPDATE users SET balance = balance - ? WHERE id = ?", [amount, userId]);
    await db.query(
      "INSERT INTO withdrawals (user_id, amount, status, account_info) VALUES (?, ?, ?, ?)",
      [userId, amount, "pending", account_info]
    );
    res.json({ message: "Retiro solicitado correctamente. En proceso de aprobación." });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error en el servidor" });
  }
});

// --- Obtener historial de retiros ---
app.get("/api/withdrawals", authenticateToken, async (req, res) => {
  const userId = req.user.id;
  try {
    const [rows] = await db.query(
      "SELECT id, amount, status, created_at FROM withdrawals WHERE user_id = ? ORDER BY created_at DESC",
      [userId]
    );
    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error al obtener el historial de retiros" });
  }
});

// --- 6. SOCKET.IO ---
io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('No token.'));
    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) return next(new Error('Token inválido.'));
        socket.user = user;
        next();
    });
});

io.on('connection', (socket) => {
    console.log(`Conectado: ${socket.user.email} (${socket.id})`);

    socket.on('findGame', ({ gameType }) => {
        if (!gameConfigs[gameType]) return socket.emit('error', { message: 'Tipo de juego no válido.' });
        const config = gameConfigs[gameType];
        const queue = waitingQueues[gameType];
        queue.push(socket);
        queue.forEach(s => s.emit('queueUpdate', { gameType, playersInQueue: queue.length, playersRequired: config.playersRequired }));

        if (queue.length >= config.playersRequired) {
            const players = queue.splice(0, config.playersRequired);
            (async () => {
                const connection = await db.getConnection();
                try {
                    await connection.beginTransaction();
                    const playerIds = players.map(p => p.user.id);
                    const [users] = await connection.query('SELECT id, balance FROM users WHERE id IN (?)', [playerIds]);
                    if (users.some(u => u.balance < config.betAmount)) {
                        players.forEach(s => s.emit('gameCancelled', { message: 'Saldo insuficiente.' }));
                        waitingQueues[gameType].unshift(...players);
                        await connection.rollback();
                        return;
                    }
                    const potAmount = config.betAmount * config.playersRequired;
                    for (const user of users) {
                        await connection.query('UPDATE users SET balance = balance - ? WHERE id = ?', [config.betAmount, user.id]);
                        await connection.query('INSERT INTO transactions (user_id, type, amount) VALUES (?, ?, ?)', [user.id, 'bet', -config.betAmount]);
                    }
                    await connection.commit();

                    const GameClass = config.gameClass;
                    const gameId = `${playerIds[0]}-${Date.now()}`;
                    const game = new GameClass(playerIds);
                    game.potAmount = potAmount;
                    activeGames[gameId] = game;
                    players.forEach(p => { p.join(gameId); p.currentGameId = gameId; });
                    io.to(gameId).emit('gameStart', game.getGameState());
                } catch (error) {
                    await connection.rollback();
                    console.error('Error inicio partida:', error);
                    waitingQueues[gameType].unshift(...players);
                } finally {
                    connection.release();
                }
            })();
        }
    });

    socket.on('lanzarDado', async () => {
        const gameId = socket.currentGameId;
        if (!gameId || !activeGames[gameId]) return;
        const game = activeGames[gameId];
        try {
            const newState = game.playTurn(socket.user.id);
            io.to(gameId).emit('gameStateUpdate', newState);

            if (newState.winner) {
                const winnerId = newState.winner;
                const potAmount = game.potAmount;
                const prize = potAmount * 0.75;
                const fee = potAmount * 0.25;
                const connection = await db.getConnection();
                try {
                    await connection.beginTransaction();
                    const [gameInsert] = await connection.query('INSERT INTO games (winner_id, pot_amount, app_fee) VALUES (?, ?, ?)', [winnerId, potAmount, fee]);
                    await connection.query('UPDATE users SET balance = balance + ? WHERE id = ?', [prize, winnerId]);
                    await connection.query('INSERT INTO transactions (user_id, type, amount, game_id) VALUES (?, ?, ?, ?)', [winnerId, 'win', prize, gameInsert.insertId]);
                    await connection.commit();
                    const [[winnerData]] = await connection.query('SELECT COALESCE(balance,0) AS balance FROM users WHERE id = ?', [winnerId]);
                    io.to(gameId).emit('gameOver', { ...newState, newBalance: Number(winnerData.balance) });
                } catch (error) {
                    await connection.rollback();
                    console.error('Error fin partida:', error);
                    io.to(gameId).emit('gameError', { message: 'Error al finalizar partida.' });
                } finally {
                    connection.release();
                    delete activeGames[gameId];
                }
            }
        } catch (error) {
            socket.emit('errorJuego', { message: error.message });
        }
    });

   socket.on('makeChessMove', async (move) => {
        const gameId = socket.currentGameId;
        if (!gameId || !activeGames[gameId] || !(activeGames[gameId] instanceof Ajedrez)) return socket.emit('errorJuego', { message: 'No estás en una partida de ajedrez válida.' });
        const game = activeGames[gameId];
        try {
            const newState = game.makeMove(socket.user.id, move);
            io.to(gameId).emit('chessMoveUpdate', newState);
            if (newState.isGameOver) {
                const winnerId = newState.isCheckmate ? game.players[newState.turn === 'w' ? 'b' : 'w'] : null;
                if (!winnerId) {
                    io.to(gameId).emit('gameOver', { message: 'Empate o abandono.', isDraw: true });
                    delete activeGames[gameId];
                    return;
                }
                const potAmount = game.potAmount;
                const prize = potAmount * 0.75;
                const fee = potAmount * 0.25;
                const connection = await db.getConnection();
                try {
                    await connection.beginTransaction();
                    const [gameInsert] = await connection.query('INSERT INTO games (winner_id, pot_amount, app_fee) VALUES (?, ?, ?)', [winnerId, potAmount, fee]);
                    await connection.query('UPDATE users SET balance = balance + ? WHERE id = ?', [prize, winnerId]);
                    await connection.query('INSERT INTO transactions (user_id, type, amount, game_id) VALUES (?, ?, ?, ?)', [winnerId, 'win', prize, gameInsert.insertId]);
                    await connection.commit();
                    const [[winnerData]] = await connection.query('SELECT COALESCE(balance,0) AS balance FROM users WHERE id = ?', [winnerId]);
                    io.to(gameId).emit('gameOver', { ...newState, winner: winnerId, newBalance: Number(winnerData.balance), message: 'Partida de ajedrez finalizada.' });
                } catch (error) {
                    await connection.rollback();
                    console.error('Error fin partida ajedrez:', error);
                    io.to(gameId).emit('gameError', { message: 'Error al finalizar partida de ajedrez.' });
                } finally {
                    connection.release();
                    delete activeGames[gameId];
                }
            }
        } catch (error) {
            socket.emit('errorJuego', { message: error.message });
        }
    });
    
    socket.on('disconnect', () => {
        console.log(`Desconectado: ${socket.user.email}`);
        for (const type in waitingQueues) waitingQueues[type] = waitingQueues[type].filter(p => p.id !== socket.id);
        const gameId = socket.currentGameId;
        if (gameId && activeGames[gameId]) {
            const game = activeGames[gameId];
            if (game.positions) delete game.positions[socket.user.id];
            io.to(gameId).emit('playerDisconnected', { disconnectedId: socket.user.id, message: `Jugador ${socket.user.email} se desconectó.` });
            if (game.positions && Object.keys(game.positions).length === 1) delete activeGames[gameId];
        }
    });
});

// --- 7. INICIAR EL SERVIDOR ---
server.listen(PORT, () => {
    console.log(`🚀 Servidor escuchando en el puerto *:${PORT}`);
});







