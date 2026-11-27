import * as THREE from "three";

export function makeFloor(){
const floorGeometry = new THREE.PlaneGeometry(100, 100);

const floorMaterial = new THREE.MeshBasicMaterial({
    color: 0x080818,
    side: THREE.DoubleSide
    
});

const floor = new THREE.Mesh(
    floorGeometry,
    floorMaterial
);

floor.rotation.x = -Math.PI / 2;
floor.position.y = 0;

return floor;
}
export function makeGrid(){

const grid = new THREE.GridHelper(
    100,
    100,
    0x00ffff,
    0x004466
);

grid.position.y = 0.02;
return grid;
}

export function makeArenaBorder() {
const border = new THREE.Group();
const material = new THREE.MeshBasicMaterial({ color: 0x00ffff });
const longEdge = new THREE.BoxGeometry(100, 0.3, 0.25);
const shortEdge = new THREE.BoxGeometry(0.25, 0.3, 99.5);

for (const z of [-49.5, 49.5]) {
    const edge = new THREE.Mesh(longEdge, material);
    edge.position.set(0, 0.15, z);
    border.add(edge);
}

for (const x of [-49.5, 49.5]) {
    const edge = new THREE.Mesh(shortEdge, material);
    edge.position.set(x, 0.15, 0);
    border.add(edge);
}

return border;
}