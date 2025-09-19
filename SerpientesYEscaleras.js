class SerpientesYEscaleras {
    constructor(playerIds) {
        if (playerIds.length < 2 || playerIds.length > 4) {
            throw new Error("El juego debe tener entre 2 y 4 jugadores.");
        }

        this.boardSize = 100;
        // ¡NUEVO! Generamos el tablero al azar al crear la partida
        this.snakesAndLadders = this._generateRandomBoard(this.boardSize, 5, 5); // 7 serpientes y 7 escaleras

        this.playerIds = playerIds;
        this.positions = {};
        playerIds.forEach(id => {
            this.positions[id] = 1;
        });
        this.currentPlayerIndex = 0;
        this.winner = null;
        this.lastRoll = null;
    }

    // --- NUEVA FUNCIÓN PARA GENERAR EL TABLERO ---
    _generateRandomBoard(size, numSnakes, numLadders) {
        const board = {};
        const usedSquares = new Set([1, size]); // No se puede empezar o terminar en 1 o 100

        for (let i = 0; i < numLadders; i++) {
            let start, end;
            do {
                start = Math.floor(Math.random() * (size - 10)) + 2; // Escaleras no empiezan muy arriba
                end = start + Math.floor(Math.random() * 20) + 10; // Deben subir al menos 10 casillas
            } while (usedSquares.has(start) || usedSquares.has(end) || end >= size);
            
            board[start] = end;
            usedSquares.add(start);
            usedSquares.add(end);
        }

        // Generar Escaleras
        for (let i = 0; i < numLadders; i++) {
            let start, end;
            do {
                start = Math.floor(Math.random() * (size - 15)) + 2; // Escaleras no empiezan muy arriba
                end = start + Math.floor(Math.random() * 20) + 10; // Deben subir al menos 10 casillas
            } while (usedSquares.has(start) || usedSquares.has(end) || end >= size);
            
            board[start] = end;
            usedSquares.add(start);
            usedSquares.add(end);
        }

        // Generar Serpientes
        for (let i = 0; i < numSnakes; i++) {
            let start, end;
            do {
                start = Math.floor(Math.random() * (size - 15)) + 12; // Serpientes no empiezan muy abajo
                end = start - (Math.floor(Math.random() * 20) + 10); // Deben bajar al menos 10 casillas
            } while (usedSquares.has(start) || usedSquares.has(end) || end <= 1);

            board[start] = end;
            usedSquares.add(start);
            usedSquares.add(end);
        }

        return board;
    }
    
    _rollDice() {
        return Math.floor(Math.random() * 6) + 1;
    }

    playTurn(playerId) {
        if (this.winner) throw new Error("El juego ya ha terminado.");
        if (playerId !== this.playerIds[this.currentPlayerIndex]) throw new Error("No es el turno de este jugador.");
        
        const roll = this._rollDice();
        this.lastRoll = roll;
        let newPosition = this.positions[playerId] + roll;

        if (newPosition <= this.boardSize) {
            // Si cae en una casilla especial, se mueve a la nueva posición
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

    getGameState() {
        return {
            playerIds: this.playerIds,
            positions: this.positions,
            currentPlayerId: this.playerIds[this.currentPlayerIndex],
            winner: this.winner,
            lastRoll: this.lastRoll,
            // ¡NUEVO! Enviamos la configuración del tablero al frontend
            board: {
                size: this.boardSize,
                snakesAndLadders: this.snakesAndLadders
            }
        };
    }
}

module.exports = SerpientesYEscaleras;

