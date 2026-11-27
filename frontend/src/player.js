import * as THREE from "three";

import { BOARD_HALF } from "./floor";

// Keep in sync with MAX_TRAIL_SEGMENTS in server/main.py.
const MAX_TRAIL_SEGMENTS = 1200;

function orientationQuaternion(forwardValues, normalValues) {
    const forward = new THREE.Vector3(...forwardValues).normalize();
    const normal = new THREE.Vector3(...normalValues).normalize();
    const right = new THREE.Vector3().crossVectors(normal, forward).normalize();
    const basis = new THREE.Matrix4().makeBasis(right, normal, forward);
    return new THREE.Quaternion().setFromRotationMatrix(basis);
}

export class Player {
    constructor(x, y, z, col) {
        const geometry = new THREE.BoxGeometry(2, 2, 2);
        const material = new THREE.MeshBasicMaterial({ color: col });

        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.position.set(x, y, z);
        this.surfaceNormal = new THREE.Vector3(0, 1, 0);
        this.forward = new THREE.Vector3(x <= 0 ? 1 : -1, 0, 0);
        this.targetPosition = this.mesh.position.clone();
        this.targetNormal = this.surfaceNormal.clone();
        this.targetForward = this.forward.clone();
        this.targetQuaternion = orientationQuaternion(
            this.targetForward.toArray(),
            this.targetNormal.toArray()
        );
        this.hasServerState = false;

        this.trailColor = col;
        this.trailGroup = new THREE.Group();
        this.trailGeometry = new THREE.BoxGeometry(0.4, 0.15, 1);
        this.trailMaterial = new THREE.MeshBasicMaterial({ color: col });
        this.trailMesh = new THREE.InstancedMesh(
            this.trailGeometry,
            this.trailMaterial,
            MAX_TRAIL_SEGMENTS
        );
        this.trailMesh.count = 0;
        this.trailMesh.frustumCulled = false;
        this.trailMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.trailGroup.add(this.trailMesh);
        this.trailTransform = new THREE.Object3D();
        this.trailWriteIndex = 0;
        this.gameOver = false;
    }

    setColor(color) {
        this.trailColor = color;
        this.mesh.material.color.set(color);
        this.trailMaterial.color.set(color);
    }

    setServerState(position, forward, normal, jumpHeight) {
        this.targetNormal.set(...normal).normalize();
        this.targetForward.set(...forward).normalize();
        this.targetPosition.set(
            position[0] + normal[0] * jumpHeight,
            position[1] + normal[1] * jumpHeight,
            position[2] + normal[2] * jumpHeight
        );
        this.targetQuaternion.copy(
            orientationQuaternion(forward, normal)
        );

        if (!this.hasServerState) {
            this.mesh.position.copy(this.targetPosition);
            this.mesh.quaternion.copy(this.targetQuaternion);
            this.surfaceNormal.copy(this.targetNormal);
            this.forward.copy(this.targetForward);
            this.hasServerState = true;
        }
    }

    interpolate(delta) {
        if (!this.hasServerState) return;

        const blend = 1 - Math.exp(-18 * delta);
        const crossedFace = this.surfaceNormal.dot(this.targetNormal) < 0.999;
        if (crossedFace) {
            this.mesh.position.copy(this.targetPosition);
            this.surfaceNormal.copy(this.targetNormal);
        } else {
            this.mesh.position.lerp(this.targetPosition, blend);
        }

        this.forward.lerp(this.targetForward, blend).normalize();
        this.mesh.quaternion.slerp(this.targetQuaternion, blend);
    }

    syncTrail(segments, reset = false) {
        const updatedIndices = [];
        if (reset) {
            this.trailMesh.count = 0;
            this.trailWriteIndex = 0;
        }

        for (const segment of segments) {
            const [startX, startY, startZ, endX, endY, endZ, normalX, normalY, normalZ] = segment;
            const direction = new THREE.Vector3(
                endX - startX,
                endY - startY,
                endZ - startZ
            );
            const distance = direction.length();
            if (distance < 0.0001) continue;
            direction.divideScalar(distance);

            const normal = new THREE.Vector3(normalX, normalY, normalZ);
            const right = new THREE.Vector3().crossVectors(normal, direction).normalize();
            const basis = new THREE.Matrix4().makeBasis(right, normal, direction);

            let index;
            if (this.trailMesh.count < MAX_TRAIL_SEGMENTS) {
                index = this.trailMesh.count;
                this.trailMesh.count++;
                if (this.trailMesh.count === MAX_TRAIL_SEGMENTS) {
                    this.trailWriteIndex = 0;
                }
            } else {
                index = this.trailWriteIndex;
                this.trailWriteIndex = (this.trailWriteIndex + 1) % MAX_TRAIL_SEGMENTS;
            }

            this.trailTransform.position.set(
                (startX + endX) / 2 - normalX * 0.92,
                (startY + endY) / 2 - normalY * 0.92,
                (startZ + endZ) / 2 - normalZ * 0.92
            );
            this.trailTransform.quaternion.setFromRotationMatrix(basis);
            this.trailTransform.scale.set(1, 1, distance);
            this.trailTransform.updateMatrix();
            this.trailMesh.setMatrixAt(index, this.trailTransform.matrix);
            updatedIndices.push(index);
        }
        if (updatedIndices.length === 0) return;

        updatedIndices.sort((a, b) => a - b);
        const instanceMatrix = this.trailMesh.instanceMatrix;
        let rangeStart = updatedIndices[0];
        let previousIndex = rangeStart;
        for (let index = 1; index <= updatedIndices.length; index++) {
            const currentIndex = updatedIndices[index];
            if (currentIndex === previousIndex + 1) {
                previousIndex = currentIndex;
                continue;
            }

            instanceMatrix.addUpdateRange(
                rangeStart * 16,
                (previousIndex - rangeStart + 1) * 16
            );
            rangeStart = currentIndex;
            previousIndex = currentIndex;
        }
        instanceMatrix.needsUpdate = true;
    }

    reset(x = -20, z = 0) {
        this.mesh.position.set(x, BOARD_HALF + 1, z);
        this.surfaceNormal.set(0, 1, 0);
        this.forward.set(x <= 0 ? 1 : -1, 0, 0);
        this.mesh.quaternion.copy(
            orientationQuaternion(this.forward.toArray(), this.surfaceNormal.toArray())
        );
        this.targetPosition.copy(this.mesh.position);
        this.targetNormal.copy(this.surfaceNormal);
        this.targetForward.copy(this.forward);
        this.trailMesh.count = 0;
        this.trailWriteIndex = 0;
        this.trailMesh.instanceMatrix.needsUpdate = true;
        this.gameOver = false;
    }
}
