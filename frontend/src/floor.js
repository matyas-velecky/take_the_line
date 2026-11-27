import * as THREE from "three";

export const BOARD_SIZE = 75;
export const BOARD_HALF = BOARD_SIZE / 2;

export function makeFloor() {
    const geometry = new THREE.BoxGeometry(BOARD_SIZE, BOARD_SIZE, BOARD_SIZE);
    const material = new THREE.MeshBasicMaterial({ color: 0x080818 });
    return new THREE.Mesh(geometry, material);
}

export function makeGrid() {
    const gridGroup = new THREE.Group();
    const faceRotations = [
        new THREE.Euler(0, 0, 0),
        new THREE.Euler(Math.PI, 0, 0),
        new THREE.Euler(Math.PI / 2, 0, 0),
        new THREE.Euler(-Math.PI / 2, 0, 0),
        new THREE.Euler(0, 0, -Math.PI / 2),
        new THREE.Euler(0, 0, Math.PI / 2),
    ];
    const faceNormals = [
        new THREE.Vector3(0, 1, 0),
        new THREE.Vector3(0, -1, 0),
        new THREE.Vector3(0, 0, 1),
        new THREE.Vector3(0, 0, -1),
        new THREE.Vector3(1, 0, 0),
        new THREE.Vector3(-1, 0, 0),
    ];

    for (let index = 0; index < faceRotations.length; index++) {
        const grid = new THREE.GridHelper(
            BOARD_SIZE,
            15,
            0x00ffff,
            0x004466
        );
        grid.rotation.copy(faceRotations[index]);
        grid.position.copy(faceNormals[index]).multiplyScalar(BOARD_HALF + 0.04);
        gridGroup.add(grid);
    }

    return gridGroup;
}

export function makeArenaBorder() {
    const border = new THREE.Group();
    const material = new THREE.MeshBasicMaterial({ color: 0x00ffff });
    const edgeGeometry = [
        new THREE.BoxGeometry(BOARD_SIZE + 0.25, 0.25, 0.25),
        new THREE.BoxGeometry(0.25, BOARD_SIZE + 0.25, 0.25),
        new THREE.BoxGeometry(0.25, 0.25, BOARD_SIZE + 0.25),
    ];

    for (const x of [-BOARD_HALF, BOARD_HALF]) {
        for (const y of [-BOARD_HALF, BOARD_HALF]) {
            const edge = new THREE.Mesh(edgeGeometry[2], material);
            edge.position.set(x, y, 0);
            border.add(edge);
        }
    }

    for (const x of [-BOARD_HALF, BOARD_HALF]) {
        for (const z of [-BOARD_HALF, BOARD_HALF]) {
            const edge = new THREE.Mesh(edgeGeometry[1], material);
            edge.position.set(x, 0, z);
            border.add(edge);
        }
    }

    for (const y of [-BOARD_HALF, BOARD_HALF]) {
        for (const z of [-BOARD_HALF, BOARD_HALF]) {
            const edge = new THREE.Mesh(edgeGeometry[0], material);
            edge.position.set(0, y, z);
            border.add(edge);
        }
    }

    return border;
}
