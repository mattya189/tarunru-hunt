"""Add rigid articulation and combat clips to the supplied monarch GLB."""
import json
import math
from pathlib import Path
import struct
import sys

source, output = map(Path, sys.argv[1:])
original = source.read_bytes()
size, = struct.unpack_from('<I', original, 12)
doc = json.loads(original[20:20 + size])
binary = bytearray(original[28 + size:])
nodes = doc['nodes']
original_root, = doc['scenes'][0]['nodes']
assert len(nodes) == 94 and nodes[original_root]['name'] == 'Reference creature | posed sculpture'

origins = {}
def pivot(name, origin, parent, meshes):
    parent_origin = origins.get(parent, (0, 0, 0))
    index = len(nodes)
    origins[index] = origin
    nodes.append(dict(name=name, translation=[a-b for a,b in zip(origin, parent_origin)], children=list(meshes)))
    nodes[parent].setdefault('children', []).append(index)
    for child in meshes:
        nodes[original_root]['children'].remove(child)
        nodes[child]['translation'] = [a-b for a,b in zip(nodes[child].get('translation', (0,0,0)), origin)]
    return index

body = pivot('Body', (0,4.36,-.13), original_root, [])
head = pivot('Crown', (0,4.58,.11), body, [0,1,2,3,18,19,20,21,22,23,25,54])
cloak = pivot('Mantle', (0,4.51,-.49), body, [16,17,30])
wings = [
    pivot('WingUpperL', (-.10,4.53,-.57), body, [27,84,90]),
    pivot('WingUpperR', (.10,4.53,-.57), body, [29,86,92]),
    pivot('WingLowerL', (-.08,4.28,-.82), body, [26,85,89]),
    pivot('WingLowerR', (.08,4.28,-.82), body, [28,87,91]),
]
left = pivot('BladeL', (-.64,3.85,.31), body, [7,9,11,12,52])
right = pivot('BladeR', (.64,3.85,.31), body, [8,10,13,14,53])
arms = pivot('BladeArms', (0,4.06,.24), body, [15,40,41])
upper_l = pivot('ArmUpperL', (-.07,4.63,.15), body, range(56,69))
upper_r = pivot('ArmUpperR', (.07,4.62,.15), body, range(69,82))
legs = pivot('Legs', (0,3.81,-.10), body, range(34,40))
pulse_l = pivot('VortexL', (-.54,4.27,-.57), body, [33])
pulse_r = pivot('VortexR', (.54,4.27,-.57), body, [46])
for index in list(nodes[original_root]['children']):
    if index < original_root:
        nodes[original_root]['children'].remove(index)
        nodes[body]['children'].append(index)
        nodes[index]['translation'] = [a-b for a,b in zip(nodes[index].get('translation',(0,0,0)), origins[body])]

def accessor(kind, elements):
    flat = [v for row in elements for v in row]
    data = struct.pack(f'<{len(flat)}f', *flat)
    view = len(doc['bufferViews'])
    doc['bufferViews'].append(dict(buffer=0,byteOffset=len(binary),byteLength=len(data)))
    binary.extend(data)
    item = dict(bufferView=view, componentType=5126,count=len(elements),type=kind)
    if kind == 'SCALAR':
        item.update(min=[min(flat)],max=[max(flat)])
    doc['accessors'].append(item)
    return len(doc['accessors'])-1

def quaternion(x,y,z):
    a,b,c = (math.sin(v/2) for v in (x,y,z))
    d,e,f = (math.cos(v/2) for v in (x,y,z))
    return (a*e*f+d*b*c,d*b*f-a*e*c,d*e*c+a*b*f,d*e*f-a*b*c)

# Time, body pitch, bank, wing thrust, arm strike, mantle billow, lift and head twist.
def pose(t, pitch=0, bank=0, wing=0, strike=0, cape=0, lift=0, turn=0):
    return t,pitch,bank,wing,strike,cape,lift,turn

def loop(pitch=0, bank=0, turn=0, duration=1.4):
    return [pose(duration*f,pitch,bank,w,0,c,y,turn) for f,w,c,y in
            [(0,.1,.02,0),(.25,.39,.16,.10),(.5,.03,.27,.03),(.75,-.34,.08,-.08),(1,.1,.02,0)]]

idle = pose(0)
clips = {
  'Idle': loop(), 'FlyForward': loop(.23,0,0,1.02), 'FlyBackward': loop(-.18,0,0,1.13),
  'FlyLeft': loop(.05,.30,-.13,.99), 'FlyRight': loop(.05,-.30,.13,.99),
  'Turn': loop(.04,.20,.21,.86),
  'WindBlade': [idle,pose(.36,-.17,0,.52,-.35,.2),pose(.73,.16,0,-.55,.48,.48),pose(1.08,-.06,0,.37,-.12,.22),pose(1.46,.11,0,-.48,.38,.4),pose(1.84)],
  'CrossSlash': [idle,pose(.38,-.27,0,.42,-.84,.22),pose(.94,.32,0,-.32,1.15,.46),pose(1.2,.19,0,-.1,.75,.32),pose(1.68)],
  'SkyBombardment': [idle,pose(.44,-.31,0,.48,-.54,.27),pose(.9,-.12,0,-.45,.53,.52),pose(1.24,.18,0,.40,-.31,.3),pose(1.65,.19,0,-.48,.62,.51),pose(2.25)],
  'GravityPull': [idle,pose(.54,-.13,0,.69,-.67,.21),pose(1.2,-.09,.08,.44,-.83,.42),pose(2.2,-.15,-.1,.57,-.95,.52),pose(3.25,.28,0,-.65,1.07,.61),pose(3.65)],
  'TripleShockwave': [idle,pose(.48,-.21,0,.62,-.32,.21),pose(.96,.27,0,-.74,.51,.45),pose(1.35,-.15,0,.59,-.23,.24),pose(1.73,.30,0,-.75,.55,.52),pose(2.20,-.22,0,.65,-.34,.25),pose(2.67,.30,0,-.8,.60,.54),pose(3.15)],
  'SweepingBeam': [idle,pose(.62,-.29,.23,.51,-.59,.21,0,-.33),pose(1.15,.15,.2,.22,.63,.35,0,-.23),pose(2.2,.17,0,.16,.56,.46,0,0),pose(3.25,.22,-.25,-.16,.68,.53,0,.31),pose(3.6)],
  'DiveSlash': [idle,pose(.42,-.39,0,.43,-.36,.43),pose(.92,.39,0,-.81,-.49,.62),pose(1.22,.68,0,-.85,1.13,.84),pose(1.47,.16,0,-.69,.89,.64),pose(1.88,-.25,0,.49,-.13,.38),pose(2.25)],
  'TrackingTornado': [idle,pose(.34,-.16,.29,.55,-.46,.29,0,-.25),pose(.79,.31,-.35,-.67,.72,.71,0,.32),pose(1.12,.09,-.21,.28,.23,.39),pose(1.52)],
  'Ultimate1': [idle,pose(1,-.32,0,.74,-.60,.49),pose(2,.12,.1,-.36,.58,.54),pose(3,-.13,-.1,.49,-.42,.31),pose(4,.23,.08,-.55,.80,.61),pose(5,-.23,0,.65,-.74,.45),pose(6.75,.36,0,-.88,1.18,.72),pose(7,.27,0,-.34,.34,.29)],
  'Ultimate2': [idle,pose(1.23,-.26,0,.73,-.73,.49),pose(2.15,.15,.19,.43,.72,.52,0,-.25),pose(3.3,.11,-.18,.53,.6,.38,0,.22),pose(4.6,.21,.11,.37,.68,.5),pose(6,-.2,0,.6,-.69,.58),pose(7.65,.40,0,-.88,1.21,.76),pose(8,.30,0,-.32,.30,.30)],
  'Enrage': [idle,pose(.24,-.19,0,.34,-.45,.22),pose(.64,-.32,0,.76,-.84,.49,.17),pose(.94,.22,0,-.60,.91,.63,.08),pose(1.22)],
  'Hit': [idle,pose(.11,-.23,.23,-.51,-.35,.51,-.12),pose(.3,.09,-.09,.24,.15,.36),pose(.51)],
  'Death': [idle,pose(.43,-.12,.32,-.42,-.37,.41),pose(.97,.45,.66,-.67,-.52,.72),pose(1.74,.62,1.16,-.72,-.62,.73),pose(2.28,.49,1.38,-.45,-.72,.46,-.12),pose(2.65,.47,1.39,-.44,-.74,.44,-.12)],
}
doc['animations'] = []
for name, keys in clips.items():
    anim = dict(name=name,samplers=[],channels=[])
    times = accessor('SCALAR', [(p[0],) for p in keys])
    def track(target, path, kind, values):
        index = len(anim['samplers'])
        anim['samplers'].append(dict(input=times,output=accessor(kind, list(values)),interpolation='LINEAR'))
        anim['channels'].append(dict(sampler=index,target=dict(node=target,path=path)))
    for i,target in enumerate(wings):
        side = -1 if i%2==0 else 1
        layer = 1 if i<2 else -.69
        track(target,'rotation','VEC4',(quaternion(.10*w,side*w*layer,side*w*.23) for _,_,_,w,*_ in keys))
    for side,target,arm in [(-1,left,upper_l),(1,right,upper_r)]:
        track(target,'rotation','VEC4',(quaternion(-s*.87,side*s*.46,side*s*.21) for _,_,_,_,s,*_ in keys))
        track(arm,'rotation','VEC4',(quaternion(-s*.28,side*w*.17,side*s*.11) for _,_,_,w,s,*_ in keys))
    track(arms,'rotation','VEC4',(quaternion(-s*.59,bank*.18,0) for _,_,bank,_,s,*_ in keys))
    track(body,'rotation','VEC4',(quaternion(pitch,turn*.32,bank) for _,pitch,bank,_,_,_,_,turn in keys))
    track(body,'translation','VEC3',((0,4.36+lift,-.13) for *_,lift,turn in keys))
    track(head,'rotation','VEC4',(quaternion(-pitch*.56,turn,bank*-.27) for _,pitch,bank,_,_,_,_,turn in keys))
    track(cloak,'rotation','VEC4',(quaternion(-.67*c,bank*-.38,(w+turn)*.24) for _,_,bank,w,_,c,_,turn in keys))
    track(legs,'rotation','VEC4',(quaternion(-pitch*.85-w*.23,0,bank*-.26) for _,pitch,bank,w,*_ in keys))
    for target,side in ((pulse_l,-1),(pulse_r,1)):
        track(target,'rotation','VEC4',(quaternion(w*.18,side*s*.3,side*w*.21) for _,_,_,w,s,*_ in keys))
    doc['animations'].append(anim)

doc['buffers'][0]['byteLength'] = len(binary)
metadata = json.dumps(doc, ensure_ascii=False, separators=(',',':')).encode()
metadata += b' ' * (-len(metadata)%4)
output.parent.mkdir(exist_ok=True, parents=True)
output.write_bytes(struct.pack('<4sIIII',b'glTF',2,28+len(metadata)+len(binary),len(metadata),0x4e4f534a)
                   +metadata+struct.pack('<II',len(binary),0x004e4942)+binary)
