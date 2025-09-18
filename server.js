const jwt = require('jsonwebtoken'); // <-- Añade esta importación al principio

// --- Importaciones y Configuración (sin cambios) ---
const express = require('express');
const http = require('http');
const cors = require('cors'); // <-- AÑADE ESTA LÍNEA
const { Server } = require("socket.io");
const SerpientesYEscaleras = require('./SerpientesYEscaleras.js'); 
const bcrypt = require('bcrypt');
const db = require('./db.js');

const app = express();
app.use(express.json()); // <-- AÑADE ESTA LÍNEA

// --- CONFIGURACIÓN DE CORS PARA EXPRESS ---
app.use(cors({
    origin: 'https://cashplay.space' // Permite peticiones solo desde tu dominio
}));
// -----------------------------------------

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
      origin: "https://cashplay.space",
      methods: ["GET", "POST"]
    }
});
const PORT = process.env.PORT || 3000; 

// --- NUEVO: Servir archivos estáticos ---
// ---

const activeGames = {};
// CAMBIO: Usamos un array como cola de espera en lugar de una sola variable
let waitingQueue = []; 
const PLAYERS_PER_GAME = 4; // Definimos el número de jugadores por partida

app.post('/api/register', async (req, res) => {
    try {
        // 1. Obtenemos el email y la contraseña del cuerpo de la petición
        const { email, password } = req.body;

        // 2. Verificamos que no falten datos
        if (!email || !password) {
            return res.status(400).json({ message: 'El email y la contraseña son obligatorios.' });
        }

        // 3. Revisamos si el email ya existe en la base de datos
        const [existingUsers] = await db.query('SELECT id FROM users WHERE email = ?', [email]);
        if (existingUsers.length > 0) {
            return res.status(409).json({ message: 'Este correo electrónico ya está registrado.' }); // 409 Conflict
        }

        // 4. Encriptamos la contraseña (¡nunca guardarla como texto plano!)
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(password, saltRounds);

        // 5. Insertamos el nuevo usuario en la base de datos
        await db.query('INSERT INTO users (email, password) VALUES (?, ?)', [email, hashedPassword]);
        
        // 6. Enviamos una respuesta de éxito
        res.status(201).json({ message: 'Usuario registrado exitosamente.' }); // 201 Created

    } catch (error) {
        console.error('Error en el registro de usuario:', error);
        res.status(500).json({ message: 'Error interno del servidor.' });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ message: 'El email y la contraseña son obligatorios.' });
        }

        // 1. Buscamos al usuario en la base de datos (sin cambios)
        const [users] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
        if (users.length === 0) {
            return res.status(404).json({ message: 'El usuario no existe.' });
        }
        const user = users[0];

        // 2. Comparamos la contraseña con la guardada (sin cambios)
        const isPasswordCorrect = await bcrypt.compare(password, user.password);
        if (!isPasswordCorrect) {
            return res.status(401).json({ message: 'Contraseña incorrecta.' });
        }

        // --- INICIO DE LA LÓGICA DE JWT ---

        // 3. Preparamos los datos que irán dentro del token (el "payload")
        // NUNCA incluyas la contraseña aquí.
        const payload = {
            id: user.id,
            email: user.email
        };

        // 4. Firmamos el token usando el secreto que guardaste en Render
        // El token expirará en 1 día, forzando al usuario a iniciar sesión de nuevo.
        const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1d' });

        // 5. Enviamos el token al cliente junto con el mensaje de éxito
        res.status(200).json({ 
            message: 'Inicio de sesión exitoso.',
            token: token 
        });

        // --- FIN DE LA LÓGICA DE JWT ---

    } catch (error) {
        console.error('Error en el inicio de sesión:', error);
        res.status(500).json({ message: 'Error interno del servidor.' });
    }
});

// --- Lógica de Conexión ---
io.on('connection', (socket) => {
    console.log(`✅ Jugador conectado: ${socket.id}`);

    // --- Lógica de Matchmaking para 4 jugadores ---
    waitingQueue.push(socket);
    console.log(`Jugadores en cola: ${waitingQueue.length}`);

    // Avisamos al jugador que está en la cola de espera
    socket.emit('waitingInQueue', { playersInQueue: waitingQueue.length, requiredPlayers: PLAYERS_PER_GAME });

    // Si tenemos suficientes jugadores en la cola, iniciamos una partida
    if (waitingQueue.length >= PLAYERS_PER_GAME) {
        console.log(`¡Cola llena! Creando partida para 4 jugadores.`);
        
        // Tomamos los primeros 4 jugadores de la cola
        const players = waitingQueue.splice(0, PLAYERS_PER_GAME);
        const playerIds = players.map(p => p.id);
        
        const gameId = `${playerIds[0]}-${Date.now()}`; // Creamos un ID único
        
        const game = new SerpientesYEscaleras(playerIds);
        activeGames[gameId] = game;

        // Unimos a los 4 jugadores a su sala y les asignamos el ID de la partida
        players.forEach(player => {
            player.join(gameId);
            player.currentGameId = gameId;
        });
        
        // Enviamos el evento de inicio a los 4 jugadores
        io.to(gameId).emit('gameStart', game.getGameState());
        console.log(`Partida ${gameId} iniciada con ${playerIds.join(', ')}.`);
    }

    // Evento para lanzar el dado (sin cambios en su lógica interna)
    socket.on('lanzarDado', () => {
        const gameId = socket.currentGameId;
        if (!gameId || !activeGames[gameId]) return;

        const game = activeGames[gameId];
        try {
            const newState = game.playTurn(socket.id);
            io.to(gameId).emit('gameStateUpdate', newState);
            if (newState.winner) {
                io.to(gameId).emit('gameOver', newState);
                delete activeGames[gameId];
            }
        } catch (error) {
            socket.emit('errorJuego', { message: error.message });
        }
    });

    // Lógica de Desconexión (actualizada para la cola)
    socket.on('disconnect', () => {
        console.log(`❌ Jugador desconectado: ${socket.id}`);
        
        // Lo quitamos de la cola de espera si estaba ahí
        waitingQueue = waitingQueue.filter(player => player.id !== socket.id);
        console.log(`Jugadores restantes en cola: ${waitingQueue.length}`);

        // La lógica de desconexión en partida activa sigue funcionando igual
        const gameId = socket.currentGameId;
        if (gameId && activeGames[gameId]) {
            const game = activeGames[gameId];
            delete game.positions[socket.id]; // Lo quitamos de la partida
            io.to(gameId).emit('playerDisconnected', { disconnectedId: socket.id, message: `El jugador ${socket.id} ha abandonado la partida.` });

            // Opcional: Si solo queda un jugador, declararlo ganador
            if (Object.keys(game.positions).length === 1) {
                const winnerId = Object.keys(game.positions)[0];
                io.to(gameId).emit('gameOver', { winner: winnerId });
                delete activeGames[gameId];
            }
        }
    });
});

// --- Iniciar el Servidor ---
server.listen(PORT, () => {
    console.log(`🚀 Servidor escuchando en el puerto *:${PORT}`);

});






