import * as THREE from "three";

export function makeFloor(){
const floorGeometry = new THREE.PlaneGeometry(50, 50);

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
    50,       
    50,       
    0x00ffff, 
    0x004466
);

grid.position.y = 0.02;
return grid;
}