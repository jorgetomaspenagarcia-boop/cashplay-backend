// Importamos la librería que acabamos de instalar
const { Chess } = require('chess.js');

class Ajedrez {
    constructor(playerIds) {
        // El ajedrez es estrictamente para 2 jugadores
        if (playerIds.length !== 2) {
            throw new Error("El ajedrez debe tener exactamente 2 jugadores.");
        }

        this.chess = new Chess(); // Creamos una nueva instancia del juego de ajedrez
        this.playerIds = playerIds; // [id_blancas, id_negras]

        // Asignamos los colores. El primer jugador en la lista será las blancas.
        this.players = {
            'w': playerIds[0], // Blancas
            'b': playerIds[1]  // Negras
        };
    }

    /**
     * Intenta realizar un movimiento.
     * @param {number} playerId - El ID del jugador que realiza el movimiento.
     * @param {object} move - Un objeto de movimiento, ej: { from: 'e2', to: 'e4' }
     * @returns {object} El nuevo estado del juego.
     */
    makeMove(playerId, move) {
        // Verificamos que sea el turno del jugador correcto
        const playerColor = this.chess.turn(); // 'w' o 'b'
        if (playerId !== this.players[playerColor]) {
            throw new Error("No es tu turno.");
        }

        try {
            // La librería chess.js valida el movimiento por nosotros.
            // Si el movimiento no es legal, lanzará un error.
            this.chess.move(move);
        } catch (error) {
            // Si el movimiento es ilegal, lanzamos un error para notificar al jugador.
            throw new Error("Movimiento ilegal.");
        }

        return this.getGameState();
    }

    /**
     * Devuelve el estado actual y completo del juego.
     */
    getGameState() {
        const turnColor = this.chess.turn();
        return {
            gameType: 'chess', // <-- NUEVA LÍNEA
            playerIds: this.playerIds,
            players: this.players,
            // FEN es la notación estándar para representar la posición de un tablero de ajedrez
            boardState: this.chess.fen(), 
            turn: turnColor,
            currentPlayerId: this.players[turnColor],
            isGameOver: this.chess.isGameOver(),
            isCheckmate: this.chess.isCheckmate(),
            isDraw: this.chess.isDraw(),
            // Aquí podríamos añadir más información, como las piezas capturadas.
        };
    }
}


module.exports = Ajedrez;
