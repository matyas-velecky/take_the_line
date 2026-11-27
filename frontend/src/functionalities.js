export function updateMatchStatus(state, elements) {
    const { gameOverScreen, title, restartButton } = elements;

    if (state.winner) {
        title.textContent =
            state.winner === 'Draw' ? 'Draw!' : `${state.winner} Wins!`;
        gameOverScreen.dataset.waiting = 'false';
        gameOverScreen.style.display = 'grid';
        restartButton.style.display = 'inline-block';
        return;
    }

    restartButton.style.display = 'none';
    if (state.started) {
        gameOverScreen.dataset.waiting = 'false';
        gameOverScreen.style.display = 'none';
        return;
    }

    gameOverScreen.dataset.waiting = state.countdown === null ? 'true' : 'false';
    title.textContent = state.countdown === null
        ? 'Waiting for an opponent...'
        : `Starting in ${Math.ceil(state.countdown)}...`;
    gameOverScreen.style.display = 'grid';
}

export function showMatchStopped(elements) {
    const { gameOverScreen, title, restartButton, roomStatus } = elements;
    title.textContent = 'Connection lost. Match stopped.';
    roomStatus.textContent = 'Disconnected';
    gameOverScreen.dataset.waiting = 'false';
    gameOverScreen.style.display = 'grid';
    restartButton.style.display = 'none';
}
