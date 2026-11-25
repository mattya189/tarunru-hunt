import * as THREE from 'three';
import { arenaPlanes, planBurst, projectilePosition, ThornInstances } from './projectiles.js';

const Y = new THREE.Vector3(0,1,0);
const Z = new THREE.Vector3(0,0,1);
const TAU = 2*Math.PI;
const smooth = THREE.MathUtils.smoothstep;
const vec = () => new THREE.Vector3();

const vertexShader = `
varying vec2 surface;
void main() {
  surface = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.);
}`;
const flameShader = `
varying vec2 surface;
uniform float clockTime, fade, intensity, interior;
uniform vec3 gold, hot, red;
void main(){
  float u = surface.x, v = surface.y * 6.2831853;
  float n = sin(u*28. - clockTime*29. + 2.*sin(v*3. + u*5.))
          + .55*sin(u*53. - clockTime*46. - v*5.);
  float sheet = smoothstep(-.62, .82, n);
  float tip = 1. - smoothstep(.73, 1., u + .089*sin(v*7. + clockTime*13.));
  vec3 rgb = mix(red, hot, sheet);
  rgb = mix(rgb, gold, interior*(.48+.48*sheet) + (1.-interior)*.32*pow(sheet,5.));
  float veins = smoothstep(.82,1.35,n)*interior;
  float opacity = (.28+.50*sheet+.20*interior)*tip*fade*smoothstep(0., .025, u+.014);
  gl_FragColor = vec4(rgb*(.80+intensity*(.32+.32*interior + 1.9*veins)),opacity);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function material(color, opacity) {
  return new THREE.MeshBasicMaterial({color, opacity, transparent:true, depthWrite:false, side:THREE.DoubleSide});
}

function addLines(group, positions, material) {
  const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(positions,3));
  const line = new THREE.LineSegments(geometry,material);
  group.add(line);
  return line;
}

const ringSegments=32;
const ringPoints=Array.from({length:ringSegments},(_,i)=>[
  Math.cos(i*TAU/ringSegments),Math.sin(i*TAU/ringSegments)
]);

class RingBatch {
  constructor(group, material, capacity) {
    this.line=addLines(group,new Float32Array(capacity*ringSegments*6),material);
    this.line.frustumCulled=false;
    this.line.renderOrder=2;
    this.positions=this.line.geometry.attributes.position;
    this.positions.setUsage(THREE.DynamicDrawUsage);
    this.capacity=capacity;
    this.count=0;
    this.u=vec();
    this.v=vec();
  }
  add(center, normal, radius) {
    if (this.count>=this.capacity) return;
    this.u.crossVectors(Math.abs(normal.y)>.8 ? Z : Y,normal).normalize();
    this.v.crossVectors(normal,this.u);
    let cursor=this.count++*ringSegments*2;
    const cx=center.x+normal.x*.018,cy=center.y+normal.y*.018,cz=center.z+normal.z*.018;
    for (let i=0;i<ringSegments;i++) {
      for (let j=0;j<2;j++) {
        const [x,y]=ringPoints[(i+j)%ringSegments],a=x*radius,b=y*radius;
        this.positions.setXYZ(cursor++,cx+a*this.u.x+b*this.v.x,cy+a*this.u.y+b*this.v.y,cz+a*this.u.z+b*this.v.z);
      }
    }
  }
  commit() {
    this.line.visible=this.count>0;
    this.line.geometry.setDrawRange(0,this.count*ringSegments*2);
    this.positions.needsUpdate=this.count>0;
  }
}

function flameShape(segments, inner) {
  const geometry = new THREE.BufferGeometry();
  const rows = 15, uv = [], indices = [];
  for (let j=0; j<=rows; j++) {
    for (let i=0; i<=segments; i++) {
      uv.push(j/rows,i/segments);
      if (j===rows || i===segments) continue;
      const a=j*(segments+1)+i, b=a+segments+1;
      indices.push(a,a+1,b,a+1,b+1,b);
    }
  }
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(uv.length/2*3),3).setUsage(THREE.DynamicDrawUsage));
  geometry.setIndex(indices);
  return {geometry,segments,rows,inner};
}

function shapeFlame(shape, length, near, slope, time) {
  const positions = shape.geometry.attributes.position;
  const {segments,rows,inner} = shape;
  for (let j=0; j<=rows; j++) {
    const u=j/rows, z=u*length;
    for (let i=0; i<=segments; i++) {
      const theta=TAU*i/segments;
      const ripples=.81+.13*Math.sin(theta*5+u*16-time*17)+.06*Math.sin(theta*9-u*25+time*15);
      const r=(near+slope*z) * ripples * (inner ? .61 : 1);
      positions.setXYZ(j*(segments+1)+i,Math.cos(theta)*r,Math.sin(theta)*r,z);
    }
  }
  positions.needsUpdate=true;
}

function slopeFor(event) {
  return Math.tan(THREE.MathUtils.degToRad(event.hit.halfAngleDegrees));
}

// Clip where the frustum's outer disk first touches an arena plane.
export function sampleBreath(event, time, readSocket, planes, fullLength = false) {
  const {position, direction} = readSocket(event.attachment);
  const slope = slopeFor(event), near = event.hit.nearRadius;
  const end = fullLength ? event.hit.range : Math.min(event.hit.range, Math.max(0,time-event.start)*event.speed);
  let distance = end, contact = null;
  for (const plane of planes) {
    const axial = plane.normal.dot(direction);
    const transverse = Math.sqrt(Math.max(0,1-axial*axial));
    const velocity = axial - transverse*slope;
    if (velocity >= 0) continue;
    const at = Math.max(0, (plane.distanceToPoint(position)-transverse*near) / -velocity);
    if (at < distance) { distance=at; contact=plane; }
  }
  let contactPoint=null;
  if (contact) {
    const radialNormal=contact.normal.clone().addScaledVector(direction,-contact.normal.dot(direction)).normalize();
    contactPoint=contact.projectPoint(position.clone().addScaledVector(direction,distance)
      .addScaledVector(radialNormal,-(near+slope*distance)),vec());
  }
  return {position,direction,distance,slope,near,contact,contactPoint};
}

export function pointInBreath(point, frame) {
  const offset = new THREE.Vector3().subVectors(point, frame.position);
  const z = offset.dot(frame.direction);
  if (frame.distance <= 0 || z < 0 || z > frame.distance) return false;
  return offset.lengthSq()-z*z <= (frame.near+frame.slope*z)**2;
}

export class AttackEffects {
  constructor({scene, thornModel, objects, config, events, quality='medium', arena=events.demoArena, breathReader, thornCapacity}) {
    this.scene=scene;
    this.def=objects.objects.cinder_thorn;
    this.config=config;
    this.events=events;
    this.planes=arenaPlanes(arena);
    this.breathReader=breathReader;
    this.layer=new THREE.Group();
    this.debug=new THREE.Group();
    scene.add(this.layer,this.debug);
    this.thorns=new ThornInstances(this.layer,thornModel,{...this.def,maxActive:thornCapacity??this.def.maxActive});
    this.sparkStride=thornCapacity ? 4 : 1;
    this.shots=[];
    this.options={sockets:false, range:false, paths:false};
    this.glow=1;
    this.pose=new THREE.Object3D();
    this.breathGroup=new THREE.Group();
    this.breathGroup.visible=false;
    this.layer.add(this.breathGroup);
    const fire=config.effects.fire_breath;
    this.flames=[1,0].map(interior => new THREE.ShaderMaterial({
      vertexShader,fragmentShader:flameShader,transparent:true,depthWrite:false,side:THREE.FrontSide,
      uniforms:{interior:{value:interior},clockTime:{value:0},fade:{value:1},intensity:{value:1},
        gold:{value:new THREE.Color(fire.colors[0])},hot:{value:new THREE.Color(fire.colors[1])},red:{value:new THREE.Color(fire.colors[2])}}
    }));
    this.blastMat=new THREE.LineBasicMaterial({color:0xff7130,transparent:true,opacity:.78,depthWrite:false});
    this.warnMat=new THREE.LineBasicMaterial({color:0xffc35a,transparent:true,opacity:.58,depthWrite:false});
    this.pathMat=new THREE.LineBasicMaterial({color:0xffbd57,transparent:true,opacity:.42,depthWrite:false});
    this.hitMat=new THREE.LineBasicMaterial({color:0x70e2ce,depthWrite:false,transparent:true,opacity:.85});
    this.pathGroup=new THREE.Group();
    this.debug.add(this.pathGroup);
    this.markers=new RingBatch(this.layer,this.blastMat,thornCapacity??40);
    this.warning=new RingBatch(this.layer,this.warnMat,thornCapacity??32);
    this.socketDebug=Object.keys(events.sockets).map(id => {
      const arrow=new THREE.ArrowHelper(Z,vec(),.62,0x78ffe1,.16,.09);
      arrow.visible=false;
      this.debug.add(arrow); return {id,arrow};
    });
    this.sphereDebug=new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1,1),
      new THREE.MeshBasicMaterial({color:0x70e2ce,wireframe:true,transparent:true,opacity:.65,depthWrite:false}),40);
    this.sphereDebug.count=0;
    this.sphereDebug.frustumCulled=false;
    this.debug.add(this.sphereDebug);
    const frustumPositions=new Float32Array(36*6*2);
    this.frustumDebug=addLines(this.debug,frustumPositions,this.hitMat);
    this.aimGuide=addLines(this.layer,new Float32Array(frustumPositions.length),this.warnMat);
    this.aimGuide.visible=false;
    this.frustumDebug.visible=false;
    this.frustumDebug.frustumCulled=this.aimGuide.frustumCulled=false;
    this.particles=new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1,0),
      new THREE.MeshBasicMaterial({color:0xffffff}),768);
    this.particles.count=0;
    this.particles.frustumCulled=false;
    this.particles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.breathGroup.userData.bloomSource=true;
    this.particles.userData.bloomSource=true;
    this.layer.add(this.particles);
    this.scorch=new THREE.Mesh(new THREE.CircleGeometry(1,24),material(config.effects.scorch.colors[0],.55));
    this.scorch.visible=false; this.scorch.renderOrder=1; this.layer.add(this.scorch);
    this.setQuality(quality);
  }

  setQuality(name) {
    this.quality=this.config.quality[name];
    if (!this.quality) throw new Error(`未対応の画質: ${name}`);
    for (const mesh of [...this.breathGroup.children]) {
      this.breathGroup.remove(mesh);
      mesh.geometry.dispose();
    }
    this.shapes=this.flames.map((mat,index) => {
      const shape=flameShape(this.quality.flameSegments,index===0);
      const mesh=new THREE.Mesh(shape.geometry,mat);
      mesh.frustumCulled=false;
      mesh.renderOrder=index+2;
      this.breathGroup.add(mesh);
      return shape;
    });
  }

  setAttack(attack, readAtTime) {
    this.attack=attack;
    this.shots=[];
    for (const path of [...this.pathGroup.children]) { this.pathGroup.remove(path); path.geometry.dispose(); }
    for (const event of attack.events) {
      if (event.type==='thorn_burst') {
        this.shots.push(...planBurst(event,this.def,readAtTime(event.time),this.planes,this.shots.length));
      }
    }
    this.breathEvent=attack.events.find(event=>event.type==='breath');
    if (this.breathEvent) {
      const event=this.breathEvent;
      this.aimFrame=sampleBreath(event,event.start,readAtTime(event.start),this.planes,true);
    }
    const burstTimes=[...new Set(this.shots.map(shot=>shot.launchTime))];
    for (const t of burstTimes) {
      const p=[];
      for (const shot of this.shots.filter(s=>s.launchTime===t)) {
        let previous=shot.origin;
        for (let k=1;k<=16;k++) {
          const next=projectilePosition(shot,shot.duration*k/16);
          p.push(...previous.toArray(),...next.toArray()); previous=next;
        }
      }
      const path=addLines(this.pathGroup,p,this.pathMat);
      path.userData.time=t;
    }
  }

  present(attack, time, readSocket, shots, shotTime) {
    this.attack=attack;
    this.breathEvent=attack?.events.find(event=>event.type==='breath');
    this.aimFrame=this.breathEvent && this.breathReader && time>=this.breathEvent.time && time<this.breathEvent.start
      ? this.breathReader(this.breathEvent,time,readSocket,true) : this.aimFrame;
    this.shots=shots;
    this.update(time,readSocket,shotTime);
  }

  update(time, readSocket, shotTime=time) {
    this.thorns.update(this.shots,shotTime);
    this.particles.count=0;
    this.sphereDebug.count=0;
    this.markers.count=this.warning.count=0;
    this.breathGroup.visible=this.aimGuide.visible=this.frustumDebug.visible=this.scorch.visible=false;
    this.activeBreath=null;
    for (const {id,arrow} of this.socketDebug) {
      arrow.visible=this.options.sockets;
      if (!arrow.visible) continue;
      const frame=readSocket(id);
      arrow.position.copy(frame.position);
      arrow.setDirection(frame.direction);
    }
    this.pathGroup.visible=this.options.paths;
    for (const path of this.pathGroup.children) {
      path.visible=time>=path.userData.time-.8 && time<path.userData.time+1.35;
    }
    for (const event of this.attack?.events ?? []) {
      if (event.type==='thorn_charge' && time>=event.time && time<event.end) {
        const fx=this.config.effects[event.effect], elapsed=time-event.time;
        for (let j=0;j<event.emitters.length;j++) {
          this.charge(readSocket(event.emitters[j]).position,elapsed/(event.end-event.time),time,j,fx);
        }
      }
    }
    if (this.breathEvent) this.updateBreath(this.breathEvent,time,readSocket);
    for (const shot of this.shots) this.updateShot(shot,shotTime);
    this.markers.commit();
    this.warning.commit();
    this.particles.instanceMatrix.needsUpdate=true;
    if (this.particles.instanceColor) this.particles.instanceColor.needsUpdate=true;
    this.sphereDebug.instanceMatrix.needsUpdate=true;
  }

  getHitState(previousTime, time) {
    const segments=[], explosions=[];
    for (const shot of this.shots) {
      const start=Math.max(shot.launchTime,previousTime);
      const end=Math.min(shot.impactTime,time);
      if (end>start) {
        segments.push({index:shot.index,fromTime:start,toTime:end,radius:shot.hit.radius,
          from:projectilePosition(shot,start-shot.launchTime),to:projectilePosition(shot,end-shot.launchTime)});
      }
      const explosionEnd=shot.detonateTime+shot.hit.explosionDuration;
      if (time>=shot.detonateTime && previousTime<explosionEnd) {
        explosions.push({index:shot.index,center:shot.impactCenter.clone(),start:shot.detonateTime,
          end:explosionEnd,radius:shot.hit.explosionRadius});
      }
    }
    return {segments,explosions,breath:this.activeBreath,
      breathTickSeconds:this.breathEvent?.hit.tickSeconds ?? null};
  }

  drawSphere(center,radius) {
    if (!this.options.range || this.sphereDebug.count>=40) return;
    this.pose.position.copy(center);
    this.pose.quaternion.identity();
    this.pose.scale.setScalar(radius);
    this.pose.updateMatrix();
    this.sphereDebug.setMatrixAt(this.sphereDebug.count++,this.pose.matrix);
  }

  particle(x,y,z,sx,sy,sz,rotation,color) {
    const i=this.particles.count;
    if (i>=this.particles.instanceMatrix.count) return;
    const pose=this.pose;
    pose.position.set(x,y,z); pose.rotation.set(0,rotation,-rotation*.7);
    pose.scale.set(sx,sy,sz); pose.updateMatrix();
    this.particles.setMatrixAt(i,pose.matrix);
    this.particles.setColorAt(i,color);
    this.particles.count++;
  }

  charge(center,progress,time,seed,fx) {
    const color=new THREE.Color(fx.colors[0]).multiplyScalar(.82+.38*this.glow*fx.emission);
    const count=Math.min(fx.particles,this.quality.burstParticles);
    for (let i=0;i<count;i++) {
      const u=(i*.618+time*.45)%1, a=i*2.399+time*7+seed, r=fx.size*(1-u)*(.7+.4*progress);
      this.particle(center.x+Math.cos(a)*r,center.y+(u-.5)*.48,center.z+Math.sin(a)*r,
        .027+.02*progress,.057,.035,a,color);
    }
  }

  updateShot(shot,time) {
    const flight=time-shot.launchTime;
    const hit=shot.hit;
    if (flight>=0 && time<shot.impactTime && (this.options.range || shot.index%this.sparkStride===0)) {
      const p=projectilePosition(shot,flight);
      this.drawSphere(p,hit.radius);
      const tail=projectilePosition(shot,Math.max(0,flight-.045));
      const color=new THREE.Color(0xff641d).multiplyScalar(.72+.44*this.glow);
      this.particle(tail.x,tail.y,tail.z,.024,.065,.024,flight*8,color);
    }
    const until=shot.detonateTime-time;
    if (shot.impactNormal && until>0 && (until<=.66 || time>=shot.impactTime) && flight>-.22) {
      const outline=Math.sqrt(Math.max(0,hit.explosionRadius**2-hit.radius**2));
      this.warning.add(shot.contactPoint,shot.impactNormal,outline);
    }
    const elapsed=time-shot.detonateTime, fx=this.config.effects.thorn_blast;
    if (elapsed<0 || elapsed>=fx.duration) return;
    const q=elapsed/fx.duration, center=shot.impactCenter;
    const normal=shot.impactNormal ?? Y;
    const outline=shot.impactNormal ? Math.sqrt(Math.max(0,hit.explosionRadius**2-hit.radius**2)) : hit.explosionRadius;
    const surface=shot.impactNormal ? shot.contactPoint : center;
    if (elapsed<hit.explosionDuration) {
      this.drawSphere(center,hit.explosionRadius);
      this.markers.add(surface,normal,outline);
    }
    if (shot.index%this.sparkStride!==0 || this.particles.count>=this.particles.instanceMatrix.count) return;
    const local=new THREE.Quaternion().setFromUnitVectors(Y,normal);
    const p=vec(), flame=new THREE.Color(), colors=fx.colors.map(c=>new THREE.Color(c));
    for (let i=0;i<this.quality.burstParticles;i++) {
      const theta=i*2.399+shot.index, spread=hit.explosionRadius*(.32+.68*(i%4)/3) * Math.sin(q*1.58);
      const height=Math.sin(q*Math.PI)*(.11+.36*(i%5)/4);
      p.set(Math.cos(theta)*spread,height,Math.sin(theta)*spread).applyQuaternion(local).add(center);
      flame.copy(colors[i%3]).multiplyScalar((1.1-.55*q)*(.8+.64*this.glow*fx.emission));
      const size=(.055+.032*(i%4))*(1-.82*q);
      this.particle(p.x,p.y,p.z,size,size*(i%3===2 ? 1.15 : 1.8),size,theta,flame);
    }
    if (q<.52) {
      const hot=colors[1].clone().lerp(colors[0],.28).multiplyScalar(1+.70*this.glow);
      for (let i=0;i<3;i++) {
        const a=shot.index+i*TAU/3+q;
        p.set(Math.cos(a)*.1, .06+q*.28, Math.sin(a)*.1).applyQuaternion(local).add(center);
        const width=hit.explosionRadius*(.24+.30*Math.sin(q*Math.PI))*(1-q);
        this.particle(p.x,p.y,p.z,width,width*(1.5+i*.14),width,a,hot);
      }
    }
  }

  drawFrustum(line,frame) {
    const {distance,near,slope,position,direction}=frame, far=near+slope*distance;
    const rotation=new THREE.Quaternion().setFromUnitVectors(Z,direction);
    const positions=line.geometry.attributes.position;
    let cursor=0;
    for (let i=0;i<36;i++) {
      const a=i*TAU/36,b=(i+1)*TAU/36;
      positions.setXYZ(cursor++,near*Math.cos(a),near*Math.sin(a),0);
      positions.setXYZ(cursor++,near*Math.cos(b),near*Math.sin(b),0);
      positions.setXYZ(cursor++,far*Math.cos(a),far*Math.sin(a),distance);
      positions.setXYZ(cursor++,far*Math.cos(b),far*Math.sin(b),distance);
      positions.setXYZ(cursor++,near*Math.cos(a),near*Math.sin(a),0);
      if (i%6===0) positions.setXYZ(cursor++,far*Math.cos(a),far*Math.sin(a),distance);
      else positions.setXYZ(cursor++,near*Math.cos(a),near*Math.sin(a),0);
    }
    positions.needsUpdate=true;
    line.position.copy(position);
    line.quaternion.copy(rotation);
    line.visible=true;
    return rotation;
  }

  updateBreath(event,time,readSocket) {
    if (time<event.time || time>=event.fadeEnd) return;
    if (time<event.start) {
      this.charge(readSocket(event.attachment).position,(time-event.time)/(event.start-event.time),time,1,this.config.effects.thorn_charge);
      this.drawFrustum(this.aimGuide,this.aimFrame);
      return;
    }
    const sampleTime=Math.min(time,event.end);
    const frame=this.breathReader ? this.breathReader(event,sampleTime,readSocket,false)
      : sampleBreath(event,sampleTime,readSocket,this.planes);
    if (frame.distance<.02) return;
    const fade=1-smooth(time,event.end,event.fadeEnd);
    const {position,direction,distance,near,slope}=frame;
    const rotation=new THREE.Quaternion().setFromUnitVectors(Z,direction);
    this.breathGroup.visible=true;
    this.breathGroup.position.copy(position);
    this.breathGroup.quaternion.copy(rotation);
    const effects=this.config.effects;
    this.shapes.forEach((shape,index) => {
      shapeFlame(shape,distance,near,slope,time);
      const uniforms=this.flames[index].uniforms;
      uniforms.clockTime.value=time;
      uniforms.fade.value=fade;
      uniforms.intensity.value=this.glow*effects.fire_breath.emission;
    });
    if (time<event.end) {
      this.activeBreath=frame;
      if (this.options.range) this.drawFrustum(this.frustumDebug,frame);
    }
    const count=Math.floor(this.quality.breathEmbers*fade*Math.min(1,distance/1.6));
    const p=vec();
    for (let i=0;i<count;i++) {
      const s=(i*.61803+time*(.83+.12*(i%5)))%1;
      const z=s*distance, a=i*2.399+time*(2+(i%3)*.2), r=(near+slope*z)*(.53+.28*(i%4)/3);
      p.set(Math.cos(a)*r,Math.sin(a)*r,z).applyQuaternion(rotation).add(position);
      const color=new THREE.Color(effects.fire_breath.colors[i%2]).multiplyScalar(.94+.74*this.glow);
      const size=(.025+(i%3)*.009)*fade;
      this.particle(p.x,p.y,p.z,size,size*1.65,size,a,color);
    }
    if (frame.contact) {
      const normal=frame.contact.normal;
      this.scorch.visible=true;
      this.scorch.position.copy(frame.contactPoint).addScaledVector(normal,.012);
      this.scorch.quaternion.setFromUnitVectors(Z,normal);
      this.scorch.scale.setScalar((.18+effects.scorch.size*(near+slope*distance))*(.55+.45*fade));
      this.scorch.material.opacity=.52*fade;
      this.markers.add(frame.contactPoint,normal,this.scorch.scale.x);
    }
  }

  dispose() {
    this.thorns.dispose();
    this.scene.remove(this.layer,this.debug);
    const geometries=new Set(), materials=new Set();
    for (const group of [this.layer,this.debug]) {
      group.traverse(object=>{
        if (object.geometry) geometries.add(object.geometry);
        if (object.material) materials.add(object.material);
      });
    }
    // ArrowHelper shares internal geometries across instances of the same Three.js module.
    for (const {arrow} of this.socketDebug) {
      geometries.delete(arrow.line.geometry);
      geometries.delete(arrow.cone.geometry);
    }
    this.particles.dispose();
    this.sphereDebug.dispose();
    geometries.forEach(g=>g.dispose());
    materials.forEach(m=>m.dispose());
  }
}
