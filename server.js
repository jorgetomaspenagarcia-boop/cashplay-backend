console.log('--- VERIFICANDO VARIABLES DE ENTORNO ---');
console.log('JWT_SECRET:', process.env.JWT_SECRET ? 'Cargado ✅' : 'NO ENCONTRADO O VACÍO ❌');
console.log('--- FIN DE VERIFICACIÓN ---');

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
// NUEVO: Objeto de configuración para cada juego
const gameConfigs = {
    snakesAndLadders: {
        gameClass: SerpientesYEscaleras,
        playersRequired: 4,
        betAmount: 5.00
    },
    chess: {
        gameClass: Ajedrez,
        playersRequired: 2,
        betAmount: 5.00 // El ajedrez puede tener una apuesta diferente
    }
};

// NUEVO: Un objeto para las colas de espera de cada juego
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
            
            // 3. Obtenemos y devolvemos el nuevo saldo
            const [[user]] = await connection.query('SELECT balance FROM users WHERE id = ?', [userId]);
            res.status(200).json({ newBalance: user.balance });

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
    // NUEVO: Evento para buscar partida
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
            const players = queue.splice(0, config.playersRequired);
            console.log(`Cola de ${gameType} llena. Iniciando partida...`);
            
            // La lógica de transacciones que ya teníamos, ahora es dinámica
            (async () => {
                const connection = await db.getConnection();
                try {
                    await connection.beginTransaction();
                    const playerIds = players.map(p => p.user.id);
                    const [users] = await connection.query('SELECT id, balance FROM users WHERE id IN (?)', [playerIds]);

                    const hasEnoughBalance = users.length === config.playersRequired && users.every(u => u.balance >= config.betAmount);

                    if (!hasEnoughBalance) {
                        // ... (código para manejar saldo insuficiente, sin cambios)
                        return;
                    }
                    
                    const potAmount = config.betAmount * config.playersRequired;
                    for (const user of users) {
                        // ... (código para debitar la apuesta, sin cambios)
                    }
                    await connection.commit();

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
                    
                    io.to(gameId).emit('gameStart', game.getGameState());
                    console.log(`Partida de ${gameType} (${gameId}) iniciada.`);

                } catch (error) {
                    // ... (código de manejo de errores, sin cambios)
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
            // CORRECCIÓN: Usar el ID de usuario de la base de datos
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

// --- 7. INICIAR EL SERVIDOR ---
server.listen(PORT, () => {
    console.log(`🚀 Servidor escuchando en el puerto *:${PORT}`);
});







