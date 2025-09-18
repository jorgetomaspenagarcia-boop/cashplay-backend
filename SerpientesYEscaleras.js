/**
 * @class SerpientesYEscaleras
 * Maneja el estado y la lógica para una partida de Serpientes y Escaleras.
 */
class SerpientesYEscaleras {
    /**
     * @param {string[]} playerIds Un array con los IDs de los jugadores (2 a 4).
     */
    constructor(playerIds) {
        // CAMBIO: Ahora validamos que haya entre 2 y 4 jugadores.
        if (playerIds.length < 2 || playerIds.length > 4) {
            throw new Error("El juego debe tener entre 2 y 4 jugadores.");
        }
        
        // El resto del constructor queda exactamente igual...
        this.boardSize = 100;
        this.snakesAndLadders = {
            // ...
        };

        this.playerIds = playerIds;
        this.positions = {};
        // INICIO: Inicializamos la posición de cada jugador en 1.
        playerIds.forEach(id => {
            this.positions[id] = 1;
        });
        // FIN: El resto sigue igual.
        this.currentPlayerIndex = 0;
        this.winner = null;
        this.lastRoll = null;
    }

    /**
     * Simula el lanzamiento de un dado de 6 caras.
     * @returns {number} Un número entre 1 y 6.
     */
    _rollDice() {
        return Math.floor(Math.random() * 6) + 1;
    }

    /**
     * Realiza el turno de un jugador.
     * @param {string} playerId El ID del jugador que realiza el movimiento.
     * @returns {object} El estado actualizado del juego.
     */
    playTurn(playerId) {
        if (this.winner) throw new Error("El juego ya ha terminado.");
        if (playerId !== this.playerIds[this.currentPlayerIndex]) throw new Error("No es el turno de este jugador.");

        const roll = this._rollDice();
        this.lastRoll = roll;
        let newPosition = this.positions[playerId] + roll;

        if (newPosition <= this.boardSize) {
            if (this.snakesAndLadders[newPosition]) {
                newPosition = this.snakesAndLadders[newPosition];
            }
            this.positions[playerId] = newPosition;
        }

        if (this.positions[playerId] === this.boardSize) {
            this.winner = playerId;
        } else {
            this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.playerIds.length;
        }
        return this.getGameState();
    }

    /**
     * Devuelve el estado actual del juego.
     * @returns {object} Un objeto con el estado completo de la partida.
     */
    getGameState() {
        return {
            playerIds: this.playerIds, // <-- AÑADE ESTA LÍNEA
            positions: this.positions,
            currentPlayerId: this.playerIds[this.currentPlayerIndex],
            winner: this.winner,
            lastRoll: this.lastRoll,
            board: {
                size: this.boardSize,
                specialTiles: this.snakesAndLadders
            }
        };
    }
}

// Exportamos la clase para poder usarla en otros archivos.
module.exports = SerpientesYEscaleras;