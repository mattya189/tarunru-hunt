import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const EAST = new THREE.Vector3(1, 0, 0);
const Z = new THREE.Vector3(0, 0, 1);

export function arenaPlanes(arena) {
  return [
    new THREE.Plane(UP.clone(), -arena.groundY),
    new THREE.Plane(EAST.clone(), -arena.minX),
    new THREE.Plane(EAST.clone().negate(), arena.maxX),
    new THREE.Plane(Z.clone(), -arena.minZ),
    new THREE.Plane(Z.clone().negate(), arena.maxZ),
  ].filter(plane => Number.isFinite(plane.constant));
}

export function createSocketReader(monster, sockets) {
  const bindings = Object.fromEntries(Object.entries(sockets).map(([id, data]) => {
    const node = monster.getObjectByName(data.node);
    if (!node) throw new Error(`GLB に接続ノードがありません: ${data.node}`);
    return [id, {node, offset: new THREE.Vector3(...data.offset), forward: new THREE.Vector3(...data.forward)}];
  }));
  return id => {
    const {node, offset, forward} = bindings[id];
    node.updateWorldMatrix(true, false);
    return {position: offset.clone().applyMatrix4(node.matrixWorld),
      direction: forward.clone().transformDirection(node.matrixWorld)};
  };
}

export function projectilePosition(shot, seconds, result = new THREE.Vector3()) {
  return result.copy(shot.origin).addScaledVector(shot.velocity, seconds)
    .addScaledVector(shot.acceleration, .5 * seconds * seconds);
}

function firstPlaneContact(plane, shot, limit) {
  const c = plane.distanceToPoint(shot.origin) - shot.hit.radius;
  const b = plane.normal.dot(shot.velocity);
  const a = .5 * plane.normal.dot(shot.acceleration);
  if (c <= 0) return 0;
  const discriminant = b*b - 4*a*c;
  if (Math.abs(a) < 1e-8) return b < 0 ? Math.min(limit, -c/b) : limit;
  if (discriminant < 0) return limit;
  return Math.min(limit, ...[(-b-Math.sqrt(discriminant))/(2*a), (-b+Math.sqrt(discriminant))/(2*a)]
    .filter(t => t >= 0 && b+2*a*t <= 0));
}

function limitDistance(shot, lifetime, maxDistance) {
  const point = new THREE.Vector3();
  const maxSquared = maxDistance * maxDistance;
  // Find the first crossing even if the arc returns closer to its origin.
  let previous = 0;
  for (let step = 1; step <= 48; step++) {
    let right = lifetime * step / 48;
    if (projectilePosition(shot, right, point).distanceToSquared(shot.origin) >= maxSquared) {
      let left = previous;
      for (let i = 0; i < 18; i++) {
        const middle = (left + right) / 2;
        if (projectilePosition(shot, middle, point).distanceToSquared(shot.origin) >= maxSquared) right = middle;
        else left = middle;
      }
      return right;
    }
    previous = right;
  }
  return lifetime;
}

export function planBurst(event, definition, readSocket, planes, firstIndex = 0, resolveContact) {
  const shots = [];
  for (const emitter of event.emitters) {
    const {position, direction} = readSocket(emitter);
    direction.y = 0; // Branch movement supplies yaw; lift is authored independently.
    if (direction.lengthSq() < 1e-6) direction.copy(Z);
    direction.normalize();
    for (let index = 0; index < event.countPerEmitter; index++) {
      const u = index / Math.max(1, event.countPerEmitter - 1) - .5;
      const yaw = THREE.MathUtils.degToRad(u * event.spreadDegrees);
      const velocity = direction.clone().applyAxisAngle(UP, yaw).multiplyScalar(event.speed * (1 - .12*Math.abs(u)));
      velocity.y = event.lift + .43 * Math.cos(index * 2.2);
      const shot = {index:firstIndex + shots.length, launchTime:event.time, origin:position.clone(),
        scale:event.scale, velocity, acceleration:new THREE.Vector3(...definition.acceleration), hit:event.hit,
        roll:definition.initialRollRadians, spin:definition.rollRadiansPerSecond};
      let duration = limitDistance(shot, definition.lifetime, definition.maxDistance);
      // Safety cap: all authored trajectories hit well below this speed.
      const a = shot.acceleration.lengthSq();
      const b = 2 * velocity.dot(shot.acceleration);
      const c = velocity.lengthSq() - definition.maxSpeed ** 2;
      if (c >= 0) duration = 0;
      else if (a > 0) duration = Math.min(duration, (-b + Math.sqrt(b*b - 4*a*c)) / (2*a));
      let contact = null;
      for (const plane of planes) {
        const time = firstPlaneContact(plane, shot, duration);
        if (time < duration) { duration = time; contact = plane; }
      }
      if (resolveContact) {
        const resolved = resolveContact(shot, duration);
        if (resolved) { duration = resolved.time; contact = resolved.plane; }
      }
      shot.duration = duration;
      shot.impactTime = event.time + duration;
      shot.impactCenter = projectilePosition(shot, duration);
      shot.impactNormal = contact?.normal.clone() ?? null;
      shot.contactPoint = contact ? contact.projectPoint(shot.impactCenter, new THREE.Vector3()) : shot.impactCenter.clone();
      shot.detonateTime = Math.max(shot.impactTime, event.detonateAt ?? shot.impactTime);
      shots.push(shot);
    }
  }
  return shots;
}

export class ThornInstances {
  constructor(scene, model, definition) {
    const source = model.getObjectByName('CinderThorn');
    this.mesh = new THREE.InstancedMesh(source.geometry, source.material, definition.maxActive);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene = scene;
    scene.add(this.mesh);
    this.pose = new THREE.Object3D();
    this.direction = new THREE.Vector3();
  }

  update(shots, time) {
    this.mesh.count = 0;
    for (const shot of shots) {
      const elapsed = time - shot.launchTime;
      if (elapsed < 0 || time >= shot.detonateTime || this.mesh.count >= this.mesh.instanceMatrix.count) continue;
      const planted = elapsed >= shot.duration;
      if (planted) {
        this.pose.position.copy(shot.impactCenter);
        this.direction.copy(shot.impactNormal ?? UP);
      } else {
        projectilePosition(shot, elapsed, this.pose.position);
        this.direction.copy(shot.velocity).addScaledVector(shot.acceleration, elapsed).normalize();
      }
      this.pose.quaternion.setFromUnitVectors(UP, this.direction);
      this.pose.rotateY(shot.roll + Math.min(elapsed,shot.duration) * shot.spin);
      this.pose.scale.setScalar(shot.scale);
      this.pose.updateMatrix();
      this.mesh.setMatrixAt(this.mesh.count++, this.pose.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.mesh.dispose(); // The GLB owner retains the shared geometry and material.
  }
}
