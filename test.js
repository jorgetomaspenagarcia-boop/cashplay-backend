const SerpientesYEscaleras = require('./SerpientesYEscaleras.js');

// 1. Crear una nueva partida
const game = new SerpientesYEscaleras(['jugadorA', 'jugadorB']);
console.log("--- ¡Comienza el juego! ---", game.getGameState());

// 2. Simular una partida hasta que haya un ganador
while (!game.getGameState().winner) {
    const currentPlayer = game.getGameState().currentPlayerId;
    console.log(`\nTurno de: ${currentPlayer}`);
    game.playTurn(currentPlayer);
    const newState = game.getGameState();
    console.log(` > Sacó un ${newState.lastRoll} y se movió a la casilla ${newState.positions[currentPlayer]}`);
}

console.log("\n--- ¡Juego terminado! ---");
console.log(`El ganador es: ${game.getGameState().winner}`);