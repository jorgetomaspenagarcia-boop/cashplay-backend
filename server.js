// --- 1. IMPORTACIONES ---
const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require("socket.io");
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const db = require('./db.js');
const SerpientesYEscaleras = require('./SerpientesYEscaleras.js');

// --- 2. CONFIGURACIÓN INICIAL DE EXPRESS Y SOCKET.IO ---
const app = express();
app.use(express.json());
app.use(cors({ origin: 'https://cashplay.space' }));

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "https://cashplay.space",
        methods: ["GET", "POST"]
    }
});
const PORT = process.env.PORT || 3000;

// --- 3. VARIABLES GLOBALES DEL JUEGO ---
const activeGames = {};
let waitingQueue = [];
const PLAYERS_PER_GAME = 4;
const BET_AMOUNT = 1.00; 

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

// --- 5. RUTAS DE LA API ---
app.post('/api/register', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) { return res.status(400).json({ message: 'El email y la contraseña son obligatorios.' }); }
        const [existingUsers] = await db.query('SELECT id FROM users WHERE email = ?', [email]);
        if (existingUsers.length > 0) { return res.status(409).json({ message: 'Este correo electrónico ya está registrado.' }); }
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(password, saltRounds);
        await db.query('INSERT INTO users (email, password) VALUES (?, ?)', [email, hashedPassword]);
        res.status(201).json({ message: 'Usuario registrado exitosamente.' });
    } catch (error) {
        console.error('Error en el registro de usuario:', error);
        res.status(500).json({ message: 'Error interno del servidor.' });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) { return res.status(400).json({ message: 'El email y la contraseña son obligatorios.' }); }
        const [users] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
        if (users.length === 0) { return res.status(404).json({ message: 'El usuario no existe.' }); }
        const user = users[0];
        const isPasswordCorrect = await bcrypt.compare(password, user.password);
        if (!isPasswordCorrect) { return res.status(401).json({ message: 'Contraseña incorrecta.' }); }
        const payload = { id: user.id, email: user.email };
        const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1d' });
        res.status(200).json({
            message: 'Inicio de sesión exitoso.',
            token: token,
            user: { id: user.id, email: user.email, balance: user.balance }
        });
    } catch (error) {
        console.error('Error en el inicio de sesión:', error);
        res.status(500).json({ message: 'Error interno del servidor.' });
    }
});

app.get('/api/user/history', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const [games] = await db.query('SELECT * FROM games WHERE id IN (SELECT game_id FROM transactions WHERE user_id = ?) ORDER BY created_at DESC LIMIT 10', [userId]);
        const [transactions] = await db.query('SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 10', [userId]);
        res.status(200).json({ games, transactions });
    } catch (error) {
        console.error('Error al obtener el historial del usuario:', error);
        res.status(500).json({ message: 'Error interno del servidor.' });
    }
});

// --- 6. LÓGICA DE WEBSOCKETS PARA EL JUEGO ---
io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) { return next(new Error('Autenticación fallida: No se proporcionó token.')); }
    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) { return next(new Error('Autenticación fallida: Token inválido.')); }
        socket.user = user;
        next();
    });
});

io.on('connection', (socket) => {
    console.log(`✅ Jugador autenticado y conectado: ${socket.user.email} (${socket.id})`);
    waitingQueue.push(socket);
    socket.emit('waitingInQueue', { playersInQueue: waitingQueue.length, requiredPlayers: PLAYERS_PER_GAME });

    if (waitingQueue.length >= PLAYERS_PER_GAME) {
        const players = waitingQueue.splice(0, PLAYERS_PER_GAME);
        (async () => {
            const connection = await db.getConnection();
            try {
                await connection.beginTransaction();
                const playerIds = players.map(p => p.user.id);
                const [users] = await connection.query('SELECT id, balance FROM users WHERE id IN (?)', [playerIds]);
                const hasEnoughBalance = users.length === PLAYERS_PER_GAME && users.every(u => u.balance >= BET_AMOUNT);

                if (!hasEnoughBalance) {
                    console.log('Un jugador no tiene saldo suficiente. Cancelando partida.');
                    players.forEach(p => p.emit('gameCancelled', { message: 'No todos los jugadores tienen saldo suficiente.' }));
                    waitingQueue.unshift(...players);
                    await connection.rollback();
                    return;
                }

                const potAmount = BET_AMOUNT * PLAYERS_PER_GAME;
                for (const user of users) {
                    await connection.query('UPDATE users SET balance = balance - ? WHERE id = ?', [BET_AMOUNT, user.id]);
                    await connection.query('INSERT INTO transactions (user_id, type, amount) VALUES (?, ?, ?)', [user.id, 'bet', -BET_AMOUNT]);
                }
                await connection.commit();

                const gameId = `${playerIds[0]}-${Date.now()}`;
                const game = new SerpientesYEscaleras(playerIds);
                game.potAmount = potAmount;
                activeGames[gameId] = game;

                players.forEach(playerSocket => {
                    playerSocket.join(gameId);
                    playerSocket.currentGameId = gameId;
                });
                
                io.to(gameId).emit('gameStart', game.getGameState());
                console.log(`Partida ${gameId} iniciada con los usuarios: ${players.map(p => p.user.email).join(', ')}.`);
            } catch (error) {
                await connection.rollback();
                console.error('Error al iniciar la partida:', error);
                waitingQueue.unshift(...players);
            } finally {
                connection.release();
            }
        })();
    }

    socket.on('lanzarDado', () => {
        const gameId = socket.currentGameId;
        if (!gameId || !activeGames[gameId]) return;

        const game = activeGames[gameId];
        try {
            // CORRECCIÓN: Usar el ID de usuario de la base de datos
            const newState = game.playTurn(socket.user.id);
            io.to(gameId).emit('gameStateUpdate', newState);
            
            if (newState.winner) {
                const winnerId = newState.winner;
                const potAmount = game.potAmount;
                const prize = potAmount * 0.90;
                const fee = potAmount * 0.10;
                
                (async () => {
                    const connection = await db.getConnection();
                    try {
                        await connection.beginTransaction();
                        await connection.query('UPDATE users SET balance = balance + ? WHERE id = ?', [prize, winnerId]);
                        const [result] = await connection.query('INSERT INTO games (winner_id, pot_amount, app_fee) VALUES (?, ?, ?)', [winnerId, potAmount, fee]);
                        const newGameId = result.insertId;
                        await connection.query('INSERT INTO transactions (user_id, type, amount, game_id) VALUES (?, ?, ?, ?)', [winnerId, 'win', prize, newGameId]);
                        await connection.commit();
                        const [[winnerData]] = await connection.query('SELECT balance FROM users WHERE id = ?', [winnerId]);
                        io.to(gameId).emit('gameOver', { ...newState, newBalance: winnerData.balance });
                    } catch (error) {
                        await connection.rollback();
                        console.error("Error al procesar el fin de la partida:", error);
                    } finally {
                        connection.release();
                    }
                })();
                delete activeGames[gameId];
            }
        } catch (error) {
            socket.emit('errorJuego', { message: error.message });
        }
    });

    socket.on('disconnect', () => {
        console.log(`❌ Jugador desconectado: ${socket.user.email}`);
        waitingQueue = waitingQueue.filter(player => player.id !== socket.id);

        const gameId = socket.currentGameId;
        if (gameId && activeGames[gameId]) {
            const game = activeGames[gameId];
            // CORRECCIÓN: Usar el ID de usuario de la base de datos
            const disconnectedUserId = socket.user.id;
            delete game.positions[disconnectedUserId]; 
            io.to(gameId).emit('playerDisconnected', { disconnectedId: disconnectedUserId, message: `El jugador ${socket.user.email} ha abandonado la partida.` });

            if (Object.keys(game.positions).length === 1) {
                // Aquí iría la lógica para manejar al ganador por abandono
                // (ej. devolver apuestas o declarar ganador al último que queda)
                delete activeGames[gameId];
            }
        }
    });
});

// --- 7. INICIAR EL SERVIDOR ---
server.listen(PORT, () => {
    console.log(`🚀 Servidor escuchando en el puerto *:${PORT}`);
});
