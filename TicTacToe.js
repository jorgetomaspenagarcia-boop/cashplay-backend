// --- TicTacToe.js ---
class TicTacToe {
    constructor(playerIds) {
        this.players = playerIds;       // array de IDs de jugadores
        this.board = Array(9).fill(null); // tablero vacío
        this.turn = 0;                  // índice de jugador que empieza
        this.isGameOver = false;
        this.winner = null;
    }

    get currentPlayer() {
        return this.players[this.turn];
    }

  getGameState() {
        return {
            players: this.players,
            board: this.board,
            currentPlayer: this.currentPlayer,
            isGameOver: this.isGameOver,
            winner: this.winner
        };
    }

   makeMove(playerId, position) {
    if (this.isGameOver) throw new Error('Partida finalizada');

    const currentPlayerId = this.players[this.turn];
    if (playerId !== currentPlayerId) throw new Error('No es tu turno');

    if (this.board[position] !== null) throw new Error('Posición ocupada');

    this.board[position] = playerId;

    // Cambiar turno
    this.turn = (this.turn + 1) % this.players.length;

    // Verificar ganador
    const lines = [
        [0,1,2],[3,4,5],[6,7,8],
        [0,3,6],[1,4,7],[2,5,8],
        [0,4,8],[2,4,6]
    ];
    for (const [a,b,c] of lines) {
        if (this.board[a] && this.board[a] === this.board[b] && this.board[a] === this.board[c]) {
            this.isGameOver = true;
            this.winner = playerId;
        }
    }

    // Empate
    if (!this.board.includes(null) && !this.winner) {
        this.isGameOver = true;
    }

    return this.getGameState();
}
}

module.exports = TicTacToe;
