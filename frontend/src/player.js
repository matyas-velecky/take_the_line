import * as THREE from "three";

export class Player {
    constructor(x, y, z, col, controls = ["a", "d", "w", "s"]) {
        const geometry = new THREE.BoxGeometry(2, 2, 2);
        const material = new THREE.MeshBasicMaterial({ color: col });

        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.position.set(x, y + 0.5, z);
        this.speed = 15;
        this.turnSpeed = 2.5;
        this.heading = x <= 0 ? Math.PI / 2 : -Math.PI / 2;
        this.mesh.rotation.y = this.heading;
        this.keys = new Set();
        this.controls = controls;

        window.addEventListener("keydown", (event) => {
            this.keys.add(event.key.toLowerCase());
        });

        window.addEventListener("keyup", (event) => {
            this.keys.delete(event.key.toLowerCase());
        });
        this.trailColor = col;
        this.lastTrailPosition = this.mesh.position.clone();
        this.trailGroup = new THREE.Group();
        this.gameOver = false;
    }

    setColor(color) {
        this.trailColor = color;
        this.mesh.material.color.set(color);
        for (const segment of this.trailGroup.children) {
            segment.material.color.set(color);
        }
    }

    check() {
        this.mesh.position.x = THREE.MathUtils.clamp(this.mesh.position.x, -49, 49);
        this.mesh.position.z = THREE.MathUtils.clamp(this.mesh.position.z, -49, 49);
    }

    collidesWithTrail(trailGroup, ignoreOwnRecentSegments = false) {
        const playerPosition = this.mesh.position;
        const playerRadius = 1;
        const trailRadius = 0.2;
        const recentSegmentCount = 12;

        for (let index = 0; index < trailGroup.children.length; index++) {
            if (
                ignoreOwnRecentSegments &&
                index >= trailGroup.children.length - recentSegmentCount
            ) {
                continue;
            }

            const segment = trailGroup.children[index];
            const segmentLength = segment.geometry.parameters.depth;
            const direction = new THREE.Vector3(0, 0, 1)
                .applyQuaternion(segment.quaternion);

            const start = segment.position.clone().addScaledVector(direction, -segmentLength / 2);
            const end = segment.position.clone().addScaledVector(direction, segmentLength / 2);

            const ax = start.x;
            const az = start.z;
            const bx = end.x;
            const bz = end.z;
            const px = playerPosition.x;
            const pz = playerPosition.z;

            const dx = bx - ax;
            const dz = bz - az;
            const segmentLengthSquared = dx * dx + dz * dz;

            if (segmentLengthSquared === 0) continue;

            const distanceAlongSegment =
                ((px - ax) * dx + (pz - az) * dz) / segmentLengthSquared;
            const t = THREE.MathUtils.clamp(distanceAlongSegment, 0, 1);

            const closestX = ax + t * dx;
            const closestZ = az + t * dz;
            const distance = Math.hypot(px - closestX, pz - closestZ);

            if (distance < playerRadius + trailRadius) {
                return true;
            }
        }

        return false;
    }

    syncTrail(segments) {
        this.trailGroup.clear();

        for (const [startX, startZ, endX, endZ] of segments) {
            const start = new THREE.Vector3(startX, 0.08, startZ);
            const end = new THREE.Vector3(endX, 0.08, endZ);
            const distance = start.distanceTo(end);

            if (distance < 0.15) continue;

            const geometry = new THREE.BoxGeometry(0.4, 0.15, distance);
            const material = new THREE.MeshBasicMaterial({ color: this.trailColor });
            const segment = new THREE.Mesh(geometry, material);

            segment.position.copy(start).add(end).multiplyScalar(0.5);
            const direction = new THREE.Vector3().subVectors(end, start);
            segment.rotation.y = Math.atan2(direction.x, direction.z);
            this.trailGroup.add(segment);
        }
    }

    reset(x = 0, z = 0) {
        this.mesh.position.set(x, 0.5, z);
        this.heading = x <= 0 ? Math.PI / 2 : -Math.PI / 2;
        this.mesh.rotation.set(0, this.heading, 0);
        this.lastTrailPosition.copy(this.mesh.position);
        this.trailGroup.clear();
        this.keys.clear();
        this.gameOver = false;
    }

    createTrail() {
    const start = this.lastTrailPosition;
    const end = this.mesh.position;

    const distance = start.distanceTo(end);

    if (distance < 0.15) return;

    const geometry = new THREE.BoxGeometry(
        0.4,
        0.15,
        distance
    );

    const material = new THREE.MeshBasicMaterial({
        color: this.trailColor
    });

    const segment = new THREE.Mesh(geometry, material);

    segment.position.copy(start).add(end).multiplyScalar(0.5);

    const direction = new THREE.Vector3()
        .subVectors(end, start);

    segment.rotation.y = Math.atan2(
        direction.x,
        direction.z
    );

    this.trailGroup.add(segment);

    this.lastTrailPosition.copy(end);
    }

    update(delta) {
        if (this.gameOver) return;

        this.check();
        if (this.gameOver) return;

        const moveX =
            Number(this.keys.has(this.controls[1]) || this.keys.has("arrowright")) -
            Number(this.keys.has(this.controls[0]) || this.keys.has("arrowleft"));
        const moveZ =
            Number(this.keys.has(this.controls[3]) || this.keys.has("arrowdown")) -
            Number(this.keys.has(this.controls[2]) || this.keys.has("arrowup"));

        if (moveX) {
            this.heading += Math.sign(moveX) * this.turnSpeed * delta;
        } else if (moveZ) {
            const targetHeading = moveZ > 0 ? Math.PI : 0;
            const headingDifference = Math.atan2(
                Math.sin(targetHeading - this.heading),
                Math.cos(targetHeading - this.heading)
            );
            const turnAmount = THREE.MathUtils.clamp(
                headingDifference,
                -this.turnSpeed * delta,
                this.turnSpeed * delta
            );
            this.heading += turnAmount;
        }

        this.mesh.rotation.y = this.heading;
        this.mesh.position.x += Math.sin(this.heading) * this.speed * delta;
        this.mesh.position.z += Math.cos(this.heading) * this.speed * delta;

        this.check();
        this.createTrail();
    }
}
