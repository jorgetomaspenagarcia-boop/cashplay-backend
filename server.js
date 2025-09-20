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
        const [users] = await db.query('SELECT id, email, COALESCE(balance, 0) AS balance, password FROM users WHERE email = ?', [email]);
        if (users.length === 0) { return res.status(404).json({ message: 'El usuario no existe.' }); }
        const user = users[0];
        const isPasswordCorrect = await bcrypt.compare(password, user.password);
        if (!isPasswordCorrect) { return res.status(401).json({ message: 'Contraseña incorrecta.' }); }
        const payload = { id: user.id, email: user.email };
        const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1d' });
        res.status(200).json({
            message: 'Inicio de sesión exitoso.',
            token,
            user: { id: user.id, email: user.email, balance: Number(user.balance) }
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

app.post('/api/create-payment-intent', authenticateToken, async (req, res) => {
    try {
        const { amount } = req.body; // El monto que el usuario quiere depositar

        if (!amount || amount <= 0) {
            return res.status(400).json({ error: 'Se requiere un monto válido.' });
        }

        // Creamos la intención de pago con Stripe.
        // El monto debe estar en la unidad más pequeña (centavos).
        const paymentIntent = await stripe.paymentIntents.create({
            amount: amount * 100, // Ej: 5.50 USD se convierte en 550 centavos
            currency: 'mxn', // Puedes cambiarlo a 'usd' o tu moneda local
            automatic_payment_methods: {
                enabled: true,
            },
        });

        // Enviamos el "clientSecret" al frontend.
        // Este es el pase que el frontend necesita para finalizar el pago.
        res.send({
            clientSecret: paymentIntent.client_secret,
        });

    } catch (error) {
        console.error("Error al crear la intención de pago:", error);
        res.status(500).json({ error: error.message });
    }
});

// En server.js, junto a las otras rutas de la API
app.post('/api/update-balance-after-payment', authenticateToken, async (req, res) => {
    try {
        const { amount } = req.body;
        const userId = req.user.id;

        if (!amount || amount <= 0) {
            return res.status(400).json({ error: 'Monto inválido.' });
        }

        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();
            // 1. Actualizamos el saldo del usuario
            await connection.query('UPDATE users SET balance = balance + ? WHERE id = ?', [amount, userId]);
            // 2. Registramos la transacción
            await connection.query('INSERT INTO transactions (user_id, type, amount) VALUES (?, ?, ?)', [userId, 'deposit', amount]);
            await connection.commit();
            console.log("INSERT Transaction:", {
                user_id: winnerId,
                type: 'win',
                amount: prize,
                game_id: newGameId
            });
            
            // 3. Obtenemos y devolvemos el nuevo saldo
            const [rows] = await connection.query('SELECT COALESCE(balance, 0) AS balance FROM users WHERE id = ?', [userId]);
            const user = rows[0];
            console.log('Saldo actualizado en DB:', user.balance);
            res.status(200).json({ newBalance: Number(user.balance) });

        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }

    } catch (error) {
        console.error("Error al actualizar el saldo:", error);
        res.status(500).json({ error: 'Error al actualizar el saldo.' });
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
    
    socket.on('findGame', ({ gameType }) => {
        if (!gameConfigs[gameType]) {
            return socket.emit('error', { message: 'Tipo de juego no válido.' });
        }

        const config = gameConfigs[gameType];
        const queue = waitingQueues[gameType];
        
        // Añadimos al jugador a la cola correspondiente
        queue.push(socket);
        console.log(`Jugador ${socket.user.email} se unió a la cola de ${gameType}. Jugadores en cola: ${queue.length}`);
        
        // Notificamos a todos en la cola sobre el nuevo tamaño
        queue.forEach(playerSocket => {
            playerSocket.emit('queueUpdate', {
                gameType: gameType,
                playersInQueue: queue.length,
                playersRequired: config.playersRequired
            });
        });

        // Si la cola está llena, iniciamos la partida
        if (queue.length >= config.playersRequired) {
             console.log("LOG 1: La cola está llena. Entrando a la lógica de inicio de partida...");
            const players = queue.splice(0, config.playersRequired);
            
            // La lógica de transacciones que ya teníamos, ahora es dinámica
            (async () => {
                 console.log("LOG 2: Función asíncrona iniciada.");
                const connection = await db.getConnection();
                console.log("LOG 3: Conexión a la DB obtenida.");
                try {
                    await connection.beginTransaction();
                    console.log("LOG 4: Transacción iniciada.");
                    const playerIds = players.map(p => p.user.id);
                    const [users] = await connection.query('SELECT id, balance FROM users WHERE id IN (?)', [playerIds]);
                    users.forEach(u => {
                        u.balance = u.balance !== null ? Number(u.balance) : 0;
                    });
                    console.log("LOG 5: Balances verificados.");

                    const potAmount = config.betAmount * config.playersRequired;
                    for (const user of users) {
                        await connection.query('UPDATE users SET balance = balance - ? WHERE id = ?', [config.betAmount, user.id]);
                        await connection.query('INSERT INTO transactions (user_id, type, amount) VALUES (?, ?, ?)', [user.id, 'bet', -config.betAmount]);
                    }
                    console.log("LOG 6: Apuestas cobradas.");

                    await connection.commit();
                    console.log("LOG 7: Transacción confirmada (commit).");

                    const gameId = `${playerIds[0]}-${Date.now()}`;
                    // ¡Creamos la instancia del juego correcto!
                    const GameClass = config.gameClass;
                    const game = new GameClass(playerIds);
                    game.potAmount = potAmount;
                    activeGames[gameId] = game;

                    players.forEach(playerSocket => {
                        playerSocket.join(gameId);
                        playerSocket.currentGameId = gameId;
                    });

                    console.log("LOG 8: A punto de emitir 'gameStart'.");
                    io.to(gameId).emit('gameStart', game.getGameState());
                    console.log(`LOG 9: Evento 'gameStart' emitido.`);

                    // Comprobamos que todos los jugadores encontrados tengan saldo suficiente
                    const hasEnoughBalance = users.length === config.playersRequired && users.every(u => u.balance >= config.betAmount);
                    
                    if (!hasEnoughBalance) {
                        // Si alguien no tiene saldo, cancelamos la partida
                        console.log('Un jugador no tiene saldo suficiente. Devolviendo jugadores a la cola.');
                        
                        // Notificamos a cada jugador que la partida fue cancelada
                        players.forEach(playerSocket => {
                            playerSocket.emit('gameCancelled', { message: 'Uno de los jugadores no tiene saldo suficiente.' });
                        });
                        
                        // Devolvemos los jugadores al principio de la cola de espera correcta
                        waitingQueues[gameType].unshift(...players);
                        
                        // Revertimos la transacción en la base de datos
                        await connection.rollback();
                        
                        // Salimos de la función para detener la creación de la partida
                        return; 
                    }

                } catch (error) {
                    await connection.rollback();
                    console.error('ERROR EN EL BLOQUE DE INICIO DE PARTIDA:', error);
                    waitingQueue.unshift(...players);
                } finally {
                    connection.release();
                }
            })();
        }
    });

    socket.on('lanzarDado', () => {
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
            
                (async () => {
                    const connection = await db.getConnection();
                    try {
                        await connection.beginTransaction();

                        // 1. Insertamos la partida en games
                        const [gameInsertResult] = await connection.query(
                            'INSERT INTO games (winner_id, pot_amount, app_fee) VALUES (?, ?, ?)',
                            [winnerId, potAmount, fee]
                        );
                        const newGameId = gameInsertResult.insertId;
                        console.log('Partida insertada en games con ID:', newGameId);

                        // 2. Actualizamos saldo del ganador
                        await connection.query(
                            'UPDATE users SET balance = balance + ? WHERE id = ?',
                            [prize, winnerId]
                        );
            
                        // 3. Registramos la transacción del ganador
                        await connection.query(
                            'INSERT INTO transactions (user_id, type, amount, game_id) VALUES (?, ?, ?, ?)',
                            [winnerId, 'win', prize, newGameId]
                        );

                        await connection.commit();
                        console.log('Transacción confirmada para ganador:', winnerId);

                        // 4. Emitimos saldo actualizado y fin de juego
                        const [[winnerData]] = await connection.query(
                            'SELECT COALESCE(balance,0) AS balance FROM users WHERE id = ?',
                            [winnerId]
                        );
                        io.to(gameId).emit('gameOver', {
                            ...newState,
                            newBalance: Number(winnerData.balance) || 0
                        });
            
                    } catch (error) {
                        await connection.rollback();
                        console.error("Error al procesar el fin de la partida:", error);
                        // Podrías avisar al jugador
                        io.to(gameId).emit('gameError', { message: 'Ocurrió un error al procesar la partida.' });
                    } finally {
                        connection.release();
                    }
                })();
            
                // 7. Eliminamos la partida activa de memoria
                delete activeGames[gameId];
            }
        } catch (error) {
            socket.emit('errorJuego', { message: error.message });
        }
    });

    // Evento para manejar movimientos de ajedrez
    socket.on('makeChessMove', (move) => {
        const gameId = socket.currentGameId;
        if (!gameId || !activeGames[gameId] || !(activeGames[gameId] instanceof Ajedrez)) {
            return socket.emit('errorJuego', { message: 'No estás en una partida de ajedrez válida.' });
        }

        const game = activeGames[gameId];
        try {
            const newState = game.makeMove(socket.user.id, move);
            // Enviamos el estado actualizado a ambos jugadores en la partida
            io.to(gameId).emit('chessMoveUpdate', newState);

            if (newState.isGameOver) {
                // Lógica de pago similar a la de Serpientes y Escaleras
                const winnerId = newState.isCheckmate ? game.players[newState.turn === 'w' ? 'b' : 'w'] : null;
            
               if (!winnerId) {
                // Empate o abandono
                io.to(gameId).emit('gameOver', { 
                    message: 'La partida terminó en empate o abandono.',
                    isDraw: true
                });
                delete activeGames[gameId];
                return;
            }
                // Lógica de pago similar a Serpientes y Escaleras
                (async () => {
                    const connection = await db.getConnection();
                    try {
                        await connection.beginTransaction();
            
                        const potAmount = game.potAmount;
                        const prize = potAmount * 0.75;
                        const fee = potAmount * 0.25;
            
                        // 1. Insertar partida en DB
                        const [gameInsertResult] = await connection.query(
                            'INSERT INTO games (winner_id, pot_amount, app_fee) VALUES (?, ?, ?)',
                            [winnerId, potAmount, fee]
                        );
                        const newGameId = gameInsertResult.insertId;
            
                        // 2. Actualizar saldo del ganador
                        await connection.query(
                            'UPDATE users SET balance = balance + ? WHERE id = ?',
                            [prize, winnerId]
                        );
            
                        // 3. Registrar transacción del ganador
                        await connection.query(
                            'INSERT INTO transactions (user_id, type, amount, game_id) VALUES (?, ?, ?, ?)',
                            [winnerId, 'win', prize, newGameId]
                        );
            
                        await connection.commit();
            
                        // 4. Emitir saldo actualizado y fin de juego
                        const [[winnerData]] = await connection.query(
                            'SELECT COALESCE(balance,0) AS balance FROM users WHERE id = ?',
                            [winnerId]
                        );
            
                        io.to(gameId).emit('gameOver', {
                            ...newState,
                            winner: winnerId,
                            newBalance: Number(winnerData.balance),
                            message: 'La partida de ajedrez ha terminado.'
                        });
            
                    } catch (error) {
                        await connection.rollback();
                        console.error("Error al procesar fin de partida de ajedrez:", error);
                        io.to(gameId).emit('gameError', { message: 'Ocurrió un error al procesar la partida.' });
                    } finally {
                        connection.release();
                        delete activeGames[gameId];
                    }
            })();
        }
    }
    // AÑADIREMOS UN NUEVO EVENTO PARA EL AJEDREZ MÁS ADELANTE
    socket.on('disconnect', () => {
        console.log(`❌ Jugador desconectado: ${socket.user.email}`);
        // Limpiamos al jugador de todas las colas de espera
        for (const gameType in waitingQueues) {
            waitingQueues[gameType] = waitingQueues[gameType].filter(playerSocket => playerSocket.id !== socket.id);
        }
        
        const gameId = socket.currentGameId;
        // Verificación crucial: ¿El juego todavía existe en la lista de partidas activas?
    if (gameId && activeGames[gameId]) {
        const game = activeGames[gameId];
        const disconnectedUserId = socket.user.id;

        // Verificamos que el objeto 'positions' exista antes de modificarlo
        if (game.positions) {
            delete game.positions[disconnectedUserId];
        }

        io.to(gameId).emit('playerDisconnected', { 
            disconnectedId: disconnectedUserId, 
            message: `El jugador ${socket.user.email} ha abandonado la partida.` 
        });

        // Opcional: Si solo queda un jugador, lo declaramos ganador
        if (game.positions && Object.keys(game.positions).length === 1) {
            console.log(`Partida ${gameId} terminada por abandono.`);
            // Aquí podrías añadir la lógica para pagar al último jugador que queda
            delete activeGames[gameId];
        }
    }
});
});

// --- 7. INICIAR EL SERVIDOR ---
server.listen(PORT, () => {
    console.log(`🚀 Servidor escuchando en el puerto *:${PORT}`);
});
























