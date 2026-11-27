
import * as THREE from 'three';
import { io } from 'socket.io-client';
import { makeFloor, makeGrid } from './floor';
import { Player } from './player';
import { showMatchStopped, updateMatchStatus } from './functionalities';

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
const playerTwo = new Player(
    20,
    0,
    0,
    0x00FFFF,
    ['arrowleft', 'arrowright', 'arrowup', 'arrowdown']
);
let localPlayerNumber = null;
let localRoomId = null;
let pressedKeys = new Set();

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
        <h1 id="game-over-title" style="margin: 0 0 16px">Finding an opponent...</h1>
        <button id="restart-game" type="button">Restart</button>
    </div>
`;
document.body.appendChild(gameOverScreen);

const settingsPanel = document.createElement('div');
settingsPanel.style.cssText = `
    position: fixed;
    top: 16px;
    left: 16px;
    display: grid;
    gap: 8px;
    padding: 12px 16px;
    border: 1px solid #176171;
    border-radius: 8px;
    background: rgba(5, 5, 16, 0.88);
    color: white;
    font: 14px sans-serif;
    z-index: 11;
`;
settingsPanel.innerHTML = `
    <strong id="room-status">Finding an opponent...</strong>
    <span id="room-code-display"></span>
    <button id="copy-room-code" type="button" style="display: none">Copy room code</button>
    <label style="display: flex; align-items: center; gap: 10px">
        Player color
        <input id="player-color" type="color" value="#ff0000" aria-label="Player color">
    </label>
`;
document.body.appendChild(settingsPanel);

const lobbyPanel = document.createElement('div');
lobbyPanel.style.cssText = `
    position: fixed;
    inset: 0;
    display: grid;
    place-items: center;
    background: rgba(5, 5, 16, 0.94);
    color: white;
    font: 16px sans-serif;
    z-index: 30;
`;
lobbyPanel.innerHTML = `
    <div style="display: grid; gap: 12px; width: min(320px, calc(100vw - 40px))">
        <h1 style="margin: 0; text-align: center">Private match</h1>
        <label style="display: grid; gap: 6px">
            Your name
            <input id="player-name" maxlength="20" autocomplete="nickname" placeholder="Enter your name">
        </label>
        <button id="create-room" type="button">Create private room</button>
        <label style="display: grid; gap: 6px">
            Room code
            <input id="join-room-code" maxlength="6" autocomplete="off" placeholder="6-character code">
        </label>
        <button id="join-room" type="button">Join room</button>
        <p id="lobby-error" role="status" style="min-height: 1.2em; margin: 0; color: #ff8c8c"></p>
    </div>
`;
document.body.appendChild(lobbyPanel);

const nameInput = document.querySelector('#player-name');
nameInput.value = localStorage.getItem('playerName') || '';
const createRoomButton = document.querySelector('#create-room');
const joinRoomButton = document.querySelector('#join-room');
const lobbyError = document.querySelector('#lobby-error');

function requestRoom(eventName, payload) {
    const name = nameInput.value.trim();
    if (!name || name.length > 20) {
        lobbyError.textContent = 'Enter a name between 1 and 20 characters.';
        return;
    }

    localStorage.setItem('playerName', name);
    lobbyError.textContent = 'Connecting to room...';
    createRoomButton.disabled = true;
    joinRoomButton.disabled = true;
    socket.emit(eventName, { ...payload, name });
}

createRoomButton.addEventListener('click', () => {
    requestRoom('create_room', {});
});

joinRoomButton.addEventListener('click', () => {
    requestRoom('join_room', {
        code: document.querySelector('#join-room-code').value.trim().toUpperCase(),
    });
});

document.querySelector('#join-room-code').addEventListener('input', (event) => {
    event.target.value = event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
});

const colorInput = document.querySelector('#player-color');
let storedColor = localStorage.getItem('playerColor');
if (storedColor && /^#[0-9a-f]{6}$/i.test(storedColor)) {
    colorInput.value = storedColor;
}

colorInput.addEventListener('input', () => {
    storedColor = colorInput.value;
    localStorage.setItem('playerColor', colorInput.value);
    if (localPlayerNumber === null) return;

    const localPlayer = localPlayerNumber === 1 ? playerOne : playerTwo;
    localPlayer.setColor(colorInput.value);
    socket.emit('set_color', { color: colorInput.value });
});

const restartButton = document.querySelector('#restart-game');
restartButton.style.cssText = `
    display: none;
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

const matchStatusElements = {
    gameOverScreen,
    title: document.querySelector('#game-over-title'),
    restartButton,
    roomStatus: document.querySelector('#room-status'),
};

socket.on('room_error', ({ message }) => {
    lobbyError.textContent = message;
    createRoomButton.disabled = false;
    joinRoomButton.disabled = false;
});

socket.on('assigned', ({ player, room, name }) => {
    localPlayerNumber = player;
    localRoomId = room;
    lobbyPanel.style.display = 'none';
    createRoomButton.disabled = false;
    joinRoomButton.disabled = false;
    const localPlayer = localPlayerNumber === 1 ? playerOne : playerTwo;
    const selectedColor = storedColor || (player === 1 ? '#ff0000' : '#00ffff');
    colorInput.value = selectedColor;
    localPlayer.setColor(selectedColor);
    socket.emit('set_color', { color: selectedColor });
    document.querySelector('#room-status').textContent = `${name} · Room ${localRoomId}`;
    document.querySelector('#room-code-display').textContent = `Code: ${localRoomId}`;
    document.querySelector('#copy-room-code').style.display = 'block';
});

document.querySelector('#copy-room-code').addEventListener('click', async () => {
    try {
        await navigator.clipboard.writeText(localRoomId);
        document.querySelector('#copy-room-code').textContent = 'Copied!';
    } catch {
        document.querySelector('#room-code-display').textContent =
            `Room code: ${localRoomId} (copy it to share)`;
    }
});

socket.on('state', (state) => {
    for (const [number, playerState] of Object.entries(state.players)) {
        const player = number === '1' ? playerOne : playerTwo;
        player.mesh.position.set(playerState.position[0], playerState.position[1], playerState.position[2]);
        player.mesh.rotation.y = playerState.heading;
        player.setColor(playerState.color);
        player.syncTrail(playerState.trails);
        player.gameOver = playerState.game_over;
    }

    updateMatchStatus(state, matchStatusElements);
});

socket.on('disconnect', () => {
    showMatchStopped(matchStatusElements);
});

window.addEventListener('keydown', (event) => {
    const key = event.key.toLowerCase();
    if (["a", "d", "w", "s", "arrowleft", "arrowright", "arrowup", "arrowdown"].includes(key)) {
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
