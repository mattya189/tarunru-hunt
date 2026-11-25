// 攻撃エフェクト素材を狩場の座標とゲーム内の当たり判定に接続。
import * as T from 'three'
export function createEffects(scene, actor, config) {
  const c = config
  const active = []
  const V = (x = 0, y = 0, z = 0) => new T.Vector3(x, y, z)
  const mat = (color, opacity = 0.8) =>
    new T.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      toneMapped: false,
      side: T.DoubleSide,
    })
  function mesh(g, col, o) {
    return new T.Mesh(g, mat(col, o))
  }
  function ring(r, w, col, o) {
    const m = mesh(new T.TorusGeometry(r, w, 6, 48), col, o)
    return m
  }
  function group() {
    let g = new T.Group()
    scene.add(g)
    return g
  }
  function add(g, d, update, tag) {
    active.push({ g, d, t: 0, update, tag })
    return g
  }
  function remove(a) {
    scene.remove(a.g)
    a.g.traverse((m) => {
      if (m.isInstancedMesh) m.dispose()
      m.geometry?.dispose()
      m.material?.dispose()
    })
  }
  function stop(tag) {
    for (let i = active.length - 1; i >= 0; i--)
      if (active[i].tag === tag) {
        remove(active[i])
        active.splice(i, 1)
      }
  }
  function origin() {
    actor.updateWorldMatrix(true, false)
    return actor.getWorldPosition(V()).add(V(0, c.height, 0))
  }
  const jaw = actor.getObjectByName('Jaw_Pivot')
  function mouth(out = V()) {
    return jaw.localToWorld(out.set(0, 0.11, 0.37))
  }
  function direction() {
    return V(0, 0, 1).applyQuaternion(actor.getWorldQuaternion(new T.Quaternion())).normalize()
  }
  function particles(group, count, color, radius) {
    const cloud = new T.InstancedMesh(new T.OctahedronGeometry(0.045), mat(color, 0.75), count)
    const matrix = new T.Matrix4()
    cloud.frustumCulled = false
    group.add(cloud)
    return (time) => {
      for (let i = 0; i < count; i++) {
        const angle = i * 2.399 + time * 4
        matrix.makeTranslation(
          Math.cos(angle) * radius,
          Math.sin(i * 1.7 + time * 3) * radius * 0.65,
          Math.sin(angle) * radius,
        )
        cloud.setMatrixAt(i, matrix)
      }
      cloud.instanceMatrix.needsUpdate = true
    }
  }
  function charge() {
    let g = group(),
      m = mesh(new T.IcosahedronGeometry(0.22, 1), 0xff77cc, 0.85)
    g.add(m)
    let p = particles(g, 24, 0xb24bff, 0.45)
    return add(
      g,
      1.2,
      (t) => {
        g.position.copy(mouth())
        m.scale.setScalar(0.3 + t * 0.8)
        p(t)
      },
      'charge',
    )
  }
  function beam() {
    stop('charge')
    let g = group()
    for (let [r, col, o] of [
      [0.25, 0xffa9e9, 0.9],
      [0.48, 0x9a27c9, 0.32],
    ]) {
      let m = mesh(new T.CylinderGeometry(r, r, c.beamLength, 16, 1, true), col, o)
      m.rotation.x = Math.PI / 2
      m.position.z = c.beamLength / 2
      g.add(m)
    }
    let coils = []
    for (let i = 0; i < 32; i++) {
      let m = mesh(new T.OctahedronGeometry(0.08), 0xd46aff, 0.8)
      g.add(m)
      coils.push(m)
    }
    return add(
      g,
      1.5,
      (t) => {
        g.position.copy(mouth())
        g.quaternion.setFromUnitVectors(V(0, 0, 1), direction())
        coils.forEach((m, i) => {
          let z = ((i / 32) * c.beamLength + t * 9) % c.beamLength,
            a = z * 3 + t * 8
          m.position.set(0.5 * Math.cos(a), 0.5 * Math.sin(a), z)
        })
      },
      'beam',
    )
  }
  function spin() {
    let g = group()
    for (let i = 0; i < 3; i++) {
      let m = ring(c.spinRadius * (0.78 + i * 0.09), 0.045, 0xe86abf, 0.65 - i * 0.15)
      m.rotation.x = Math.PI / 2 + i * 0.2
      g.add(m)
    }
    return add(
      g,
      1.3,
      (t) => {
        g.position.copy(origin())
        g.rotation.y = t * 16
        g.rotation.z = Math.sin(t * 8) * 0.25
      },
      'spin',
    )
  }
  function tornado(position) {
    let g = group()
    g.position.copy(position)
    let bands = []
    for (let i = 0; i < 12; i++) {
      let r = 0.25 + i * 0.105,
        m = ring(r, 0.045, i % 2 ? 0x713cb8 : 0x38244e, 0.65)
      m.rotation.x = Math.PI / 2
      m.position.y = i * 0.23
      g.add(m)
      bands.push(m)
    }
    let p = particles(g, 48, 0xa68bd0, 0.9)
    return add(
      g,
      Infinity,
      (t) => {
        g.position.copy(position)
        bands.forEach((m, i) => {
          m.position.x = Math.sin(t * 7 + i * 0.6) * 0.2
          m.position.z = Math.cos(t * 7 + i * 0.6) * 0.2
          m.scale.setScalar(1 + 0.12 * Math.sin(t * 8 + i))
        })
        p(t)
      },
      'tornado',
    )
  }
  function barrier() {
    stop('barrier')
    let g = group(),
      r = c.barrierRadius
    let shell = mesh(new T.SphereGeometry(r, 24, 16), 0x9159dd, 0.09)
    g.add(shell)
    let polyhedron = new T.IcosahedronGeometry(r, 2)
    let edges = new T.EdgesGeometry(polyhedron)
    polyhedron.dispose()
    let wire = new T.LineSegments(
      edges,
      new T.LineBasicMaterial({ color: 0xb68bff, transparent: true, opacity: 0.27, depthWrite: false }),
    )
    g.add(wire)
    let m = ring(r, 0.035, 0xd0a0ff, 0.65)
    g.add(m)
    return add(
      g,
      Infinity,
      (t) => {
        g.position.copy(origin())
        wire.rotation.y = t * 0.25
        m.rotation.set(t * 0.6, t * 0.3, 0)
      },
      'barrier',
    )
  }
  function burst(pos, col = 0xd28aff) {
    let g = group()
    g.position.copy(pos)
    let m = ring(0.3, 0.055, col, 0.85)
    m.rotation.x = Math.PI / 2
    g.add(m)
    let p = particles(g, 30, col, 1.4)
    return add(
      g,
      0.8,
      (t) => {
        m.scale.setScalar(1 + t * 6)
        m.material.opacity = 1 - t / 0.8
        p(t)
      },
      'burst',
    )
  }
  function summon(positions) {
    let g = group()
    for (let pos of positions) {
      for (let [r, w, col] of [
        [0.8, 0.06, 0xb15aff],
        [0.55, 0.025, 0xf58ad8],
      ]) {
        let m = ring(r, w, col, 0.75)
        m.rotation.x = Math.PI / 2
        m.position.copy(pos)
        m.position.y += 0.08
        g.add(m)
      }
    }
    return add(
      g,
      1.4,
      (t) => {
        g.children.forEach((m, i) => m.scale.setScalar(0.3 + Math.min(1, t * 3) + 0.1 * Math.sin(t * 8 + i)))
      },
      'summon',
    )
  }
  function rage() {
    stop('rage')
    let g = group(),
      p = particles(g, 42, 0xe13577, 1.6)
    return add(
      g,
      Infinity,
      (t) => {
        g.position.copy(origin())
        p(t)
      },
      'rage',
    )
  }
  return {
    mouth,
    charge,
    beam,
    spin,
    tornado,
    barrier,
    summon,
    rage,
    burst,
    stop,
    breakBarrier() {
      stop('barrier')
      burst(origin())
    },
    update(dt) {
      for (let i = active.length - 1; i >= 0; i--) {
        let a = active[i]
        a.t += dt
        if (a.t >= a.d) {
          remove(a)
          active.splice(i, 1)
        } else a.update(a.t)
      }
    },
    dispose() {
      while (active.length) remove(active.pop())
    },
  }
}
