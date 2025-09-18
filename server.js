// --- Importaciones y Configuración (sin cambios) ---
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const SerpientesYEscaleras = require('./SerpientesYEscaleras.js'); 
const bcrypt = require('bcrypt');
const db = require('./db.js');

const app = express();
app.use(express.json()); // <-- AÑADE ESTA LÍNEA
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


