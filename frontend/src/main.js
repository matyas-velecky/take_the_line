
import * as THREE from 'three';
import { io } from 'socket.io-client';
import { makeFloor, makeGrid } from './floor';
import { Player } from './player';

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x050510);

const camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const socket = io();

const playerOne = new Player(-20, 0, 0, 0xFF0000);
const playerTwo = new Player(20, 0, 0, 0x00FFFF, ['arrowleft', 'arrowright']);
let localPlayerNumber = null;
let pressedKeys = new Set();
let matchStartedByUser = false;

const startScreen = document.createElement('div');
startScreen.style.cssText = `
    position: fixed;
    inset: 0;
    display: grid;
    place-items: center;
    background: #050510;
    color: white;
    font-family: sans-serif;
    z-index: 20;
`;
startScreen.innerHTML = `
    <div style="text-align: center">
        <h1 style="margin: 0 0 8px; font-size: clamp(40px, 10vw, 96px)">TAKE THE LINE</h1>
        <p style="margin: 0 0 24px; color: #9adce2">Two players. One arena.</p>
        <button id="start-game" type="button">Start Game</button>
    </div>
`;
document.body.appendChild(startScreen);

const startButton = document.querySelector('#start-game');
startButton.style.cssText = `
    min-width: 160px;
    padding: 14px 24px;
    border: 0;
    border-radius: 6px;
    background: #00ffff;
    color: #050510;
    font: bold 18px sans-serif;
    cursor: pointer;
`;

startButton.addEventListener('click', () => {
    matchStartedByUser = true;
    socket.emit('ready');
    document.querySelector('#game-over-title').textContent = 'Waiting for another player...';
    gameOverScreen.dataset.waiting = 'true';
    gameOverScreen.style.display = 'grid';
    startScreen.style.display = 'none';
});

scene.add(makeFloor());
scene.add(makeGrid());
scene.add(playerOne.mesh);
scene.add(playerOne.trailGroup);
scene.add(playerTwo.mesh);
scene.add(playerTwo.trailGroup);

camera.position.set(0, 50, 50);
camera.lookAt(0, 0, 0);

const gameOverScreen = document.createElement('div');
gameOverScreen.style.cssText = `
    position: fixed;
    inset: 0;
    display: none;
    place-items: center;
    background: rgba(5, 5, 16, 0.82);
    color: white;
    font-family: sans-serif;
    z-index: 10;
`;

gameOverScreen.innerHTML = `
    <div style="text-align: center">
        <h1 id="game-over-title" style="margin: 0 0 16px">GAME OVER</h1>
        <button id="restart-game" type="button">Restart</button>
    </div>
`;
document.body.appendChild(gameOverScreen);

const restartButton = document.querySelector('#restart-game');
restartButton.style.cssText = `
    min-width: 120px;
    padding: 12px 20px;
    border: 0;
    border-radius: 6px;
    background: #00ffff;
    color: #050510;
    font: bold 16px sans-serif;
    cursor: pointer;
`;

restartButton.addEventListener('click', () => {
    socket.emit('restart');
});

function showGameOver(winner) {
    document.querySelector('#game-over-title').textContent =
        winner === 'Draw' ? 'Draw!' : `${winner} Wins!`;
    gameOverScreen.style.display = 'grid';
}

socket.on('assigned', ({ player }) => {
    localPlayerNumber = player;
});

socket.on('waiting', () => {
    gameOverScreen.dataset.waiting = 'true';
    document.querySelector('#game-over-title').textContent = 'Waiting for another player...';
    gameOverScreen.style.display = 'grid';
});

socket.on('state', (state) => {
    for (const [number, playerState] of Object.entries(state.players)) {
        const player = number === '1' ? playerOne : playerTwo;
        player.mesh.position.set(playerState.position[0], playerState.position[1], playerState.position[2]);
        player.mesh.rotation.y = playerState.heading;
        player.syncTrail(playerState.trails);
        player.gameOver = playerState.game_over;
    }

    if (!state.started) {
        if (matchStartedByUser) {
            gameOverScreen.dataset.waiting = 'true';
            document.querySelector('#game-over-title').textContent = 'Waiting for another player...';
            gameOverScreen.style.display = 'grid';
        }
    } else if (state.winner) {
        gameOverScreen.dataset.waiting = 'false';
        showGameOver(state.winner);
    } else {
        gameOverScreen.dataset.waiting = 'false';
        gameOverScreen.style.display = 'none';
    }
});

window.addEventListener('keydown', (event) => {
    const key = event.key.toLowerCase();
    if (["a", "d", "arrowleft", "arrowright"].includes(key)) {
        pressedKeys.add(key);
        socket.emit('input', { keys: Array.from(pressedKeys) });
    }
});

window.addEventListener('keyup', (event) => {
    const key = event.key.toLowerCase();
    if (pressedKeys.delete(key)) {
        socket.emit('input', { keys: Array.from(pressedKeys) });
    }
});

function animate() {
    renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

renderer.setAnimationLoop(animate);
