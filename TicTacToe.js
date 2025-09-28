// --- TicTacToe.js ---
class TicTacToe {
  constructor(playerX, playerO) {
    this.board = Array(9).fill(null); // Tablero de 3x3
    this.currentPlayer = 'X'; // Inicia X
    this.players = {
      X: playerX,
      O: playerO
    };
    this.winner = null;
    this.moves = 0;
  }

  makeMove(position) {
    if (this.board[position] || this.winner) {
      return false; // Movimiento inválido
    }

    this.board[position] = this.currentPlayer;
    this.moves++;

    // Revisar si hay ganador
    if (this.checkWinner()) {
      this.winner = this.currentPlayer;
    } else if (this.moves === 9) {
      this.winner = 'draw';
    } else {
      // Cambiar turno
      this.currentPlayer = this.currentPlayer === 'X' ? 'O' : 'X';
    }

    return true;
  }

  checkWinner() {
    const winPatterns = [
      [0,1,2], [3,4,5], [6,7,8], // Filas
      [0,3,6], [1,4,7], [2,5,8], // Columnas
      [0,4,8], [2,4,6]           // Diagonales
    ];

    return winPatterns.some(pattern => {
      const [a,b,c] = pattern;
      return this.board[a] && this.board[a] === this.board[b] && this.board[a] === this.board[c];
    });
  }

  getGameState() {
    return {
      board: this.board,
      currentPlayer: this.currentPlayer,
      winner: this.winner
    };
  }
}

module.exports = TicTacToe;
