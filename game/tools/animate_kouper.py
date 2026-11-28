"""Rig the supplied coiled paper snake before running gltfpack on the resulting GLB."""
import argparse
import io
import json
import math
import struct
from pathlib import Path

import numpy as np
from PIL import Image


def load_glb(path):
    data = path.read_bytes()
    size, kind = struct.unpack_from('<II', data, 12)
    assert data[:4] == b'glTF' and kind == 0x4e4f534a
    return json.loads(data[20:20+size]), memoryview(data)[28+size:]


def rotation(rx, ry, rz):
    sx, cx = math.sin(rx/2), math.cos(rx/2)
    sy, cy = math.sin(ry/2), math.cos(ry/2)
    sz, cz = math.sin(rz/2), math.cos(rz/2)
    return [sx*cy*cz+cx*sy*sz, cx*sy*cz-sx*cy*sz,
            cx*cy*sz+sx*sy*cz, cx*cy*cz-sx*sy*sz]


JOINTS = np.array([
    [-1.29, 2.13, .32], [-.86, 2.22, -.49], [-.19, 2.06, -.66],
    [.36, 1.42, -.53], [.03, .84, -.16], [-.66, .65, .43],
    [-.53, .50, .89], [.19, .44, .95], [1.04, .48, .66],
    [1.70, .59, .16], [1.77, .95, -.37], [1.45, 1.50, -.54],
], dtype=np.float32)
ANGLE = .87
ORIENT = np.array([[math.cos(ANGLE), 0, math.sin(ANGLE)],
                   [0, 1, 0], [-math.sin(ANGLE), 0, math.cos(ANGLE)]], dtype=np.float32)
JOINTS = JOINTS @ ORIENT.T

# Frame tuples give time, head reach, head lift, lateral lean, body compression and tail sweep.
CLIPS = {
    'Idle': (2.0, [(0,0,0,0,0,0),(.25,.03,.08,.09,.02,.07),(.5,0,0,0,0,0),(.75,.01,.07,-.10,.02,-.09),(1,0,0,0,0,0)]),
    'Slither': (.75, [(0,0,0,.22,.05,-.15),(.25,.14,-.08,0,.11,-.30),(.5,0,0,-.22,.05,.15),(.75,.14,-.08,0,.11,.30),(1,0,0,.22,.05,-.15)]),
    'FastSlither': (.47, [(0,.38,-.36,.22,.12,-.31),(.25,.51,-.54,0,.22,-.59),(.5,.38,-.36,-.22,.12,.31),(.75,.51,-.54,0,.22,.59),(1,.38,-.36,.22,.12,-.31)]),
    'TurnLeft': (.67, [(0,0,0,.18,0,.02),(.4,.14,.06,-.34,.15,.26),(.8,.08,.04,-.17,.08,-.18),(1,0,0,.18,0,.02)]),
    'TurnRight': (.67, [(0,0,0,-.18,0,-.02),(.4,.14,.06,.34,.15,-.26),(.8,.08,.04,.17,.08,.18),(1,0,0,-.18,0,-.02)]),
    'Strafe': (.62, [(0,.04,-.11,.16,.10,-.22),(.33,.08,.10,.38,.08,.04),(.68,.06,-.12,.14,.14,.28),(1,.04,-.11,.16,.10,-.22)]),
    'Back': (.72, [(0,-.21,.14,.12,.12,.21),(.5,-.12,.05,-.10,.03,-.24),(1,-.21,.14,.12,.12,.21)]),
    'Headbutt': (1, [(0,0,0,0,0,0),(.34,-.58,.35,0,.12,.28),(.53,.22,-.21,0,.05,-.18),(.91,.50,-1.43,0,.22,.36),(1,.48,-1.36,0,.24,.22)]),
    'DoubleSlam': (1, [(0,0,0,0,0,0),(.35,-.17,.27,-.62,.12,.29),(.48,.50,-1.42,-.83,.22,.29),(.58,.04,-.20,0,.09,-.27),(.78,-.16,.30,.71,.10,-.36),(.96,.50,-1.43,.85,.25,-.28),(1,.4,-1.36,.80,.25,-.28)]),
    'Serpentine': (1, [(0,0,0,0,0,0),(.35,.33,-.92,.29,.29,-.40),(.54,.75,-.97,-.29,.21,.76),(.75,.66,-.90,.34,.22,-.74),(1,.43,-.69,-.22,.23,.40)]),
    'Sweep': (1, [(0,0,0,0,0,0),(.35,-.11,-.22,-1.28,.08,.48),(.48,.30,-.28,-1.36,.06,.61),(.66,1.22,-.80,.12,-.12,-.32),(.81,.20,-.44,1.54,-.09,-.63),(1,.10,-.21,1.09,.04,-.40)]),
    'Jump': (1, [(0,0,0,0,0,0),(.48,-.36,-.89,0,.38,.23),(1,-.18,-.78,0,.42,.49)]),
    'Airborne': (1, [(0,-.18,-.78,0,.42,.49),(.32,.27,.43,.15,.08,.60),(.65,.58,.10,-.09,.13,-.34),(1,.39,-.54,0,.29,-.23)]),
    'Landing': (1, [(0,.39,-.54,0,.29,-.23),(.33,.57,-1.31,0,.46,.57),(1,.32,-1.18,0,.36,.39)]),
    'Uncoil': (1, [(0,0,0,0,0,0),(.33,-.48,-.30,-.69,.34,-.87),(.48,-.39,-.28,-.93,.38,-1.01),(.72,.63,-.56,.39,-.24,1.22),(.9,.36,-.59,1.37,-.18,-1.45),(1,.16,-.44,.52,.08,-.35)]),
    'ChainSlam': (1, [(0,0,0,0,0,0),(.34,-.32,.59,0,.04,.29),(.52,.67,-1.39,0,.27,.62),(.8,.45,-1.20,0,.18,-.26),(1,.45,-1.17,0,.17,.13)]),
    'Scatter': (1, [(0,0,0,0,0,0),(.55,-.36,-.84,0,.40,1.1),(.72,.29,.42,.24,-.05,-1.30),(1,.09,-.10,0,.10,-.30)]),
    'FinalSlam': (1, [(0,.09,-.10,0,.10,-.30),(.48,-.28,.66,0,.12,.76),(.84,-.12,.39,0,.17,.85),(1,.53,-1.55,0,.49,-.83)]),
    'Fatigue': (1, [(0,.53,-1.55,0,.49,-.83),(.24,.63,-1.31,.18,.29,.17),(.53,.55,-1.42,.15,.32,.07),(.83,.54,-1.27,.12,.30,.04),(1,.24,-.62,.04,.15,0)]),
    'Recover': (1, [(0,.02,-.10,0,.10,.01),(.29,.09,.12,0,.10,.14),(.72,.10,.19,0,.03,-.06),(1,0,0,0,0,0)]),
    'Rage': (1, [(0,0,0,0,0,0),(.23,-.22,-.48,-.35,.24,-.67),(.54,.21,.52,.31,.08,.79),(.79,.39,.42,-.24,.14,-.43),(1,0,0,0,0,0)]),
    'Hit': (1, [(0,0,0,0,0,0),(.26,-.16,.18,-.27,.06,.35),(1,0,0,0,0,0)]),
    'Stagger': (1, [(0,0,0,0,0,0),(.23,-.28,.22,.44,.11,-.62),(.45,.03,-.61,-.30,.22,.73),(1,0,0,0,0,0)]),
    'Death': (1, [(0,0,0,0,0,0),(.27,-.24,.23,-.28,.16,-.62),(.59,.48,-1.18,.49,.36,.73),(1,.58,-1.62,.58,.57,.52)]),
}
CLIPS['DoubleSlamRight'] = (1, [(t,z,y,-x,c,-s) for t,z,y,x,c,s in CLIPS['DoubleSlam'][1]])


def convert(source, target):
    gltf, data = load_glb(source)
    binary = bytearray()
    views, accessors = [], []
    types = {5121:'u1', 5123:'<u2', 5125:'<u4', 5126:'<f4'}
    sizes = {'SCALAR':1, 'VEC2':2, 'VEC3':3, 'VEC4':4, 'MAT4':16}

    def read(index):
        acc = gltf['accessors'][index]
        view = gltf['bufferViews'][acc['bufferView']]
        dtype = np.dtype(types[acc['componentType']])
        size = sizes[acc['type']]
        return np.ndarray((acc['count'],size), dtype=dtype, buffer=data,
                          offset=view.get('byteOffset',0)+acc.get('byteOffset',0),
                          strides=(view.get('byteStride',size*dtype.itemsize),dtype.itemsize))

    def payload(raw, target=None):
        binary.extend(b'\0'*(-len(binary)%4))
        view = {'buffer':0,'byteOffset':len(binary),'byteLength':len(raw)}
        if target:
            view['target'] = target
        views.append(view)
        binary.extend(raw)
        return len(views)-1

    def write(array, dtype, component, kind, bounds=False, target=None):
        array = np.asarray(array,dtype=dtype)
        acc = {'bufferView':payload(array.tobytes(),target),'componentType':component,
               'count':len(array),'type':kind}
        if bounds:
            acc.update(min=np.atleast_1d(array.min(axis=0)).tolist(),
                       max=np.atleast_1d(array.max(axis=0)).tolist())
        accessors.append(acc)
        return len(accessors)-1

    groups = {}
    for node in gltf['nodes']:
        if 'mesh' not in node:
            continue
        assert not any(key in node for key in ('matrix','rotation','translation','scale'))
        rigid_head = node['name'].startswith(('Face','Head','Paper rim'))
        for original in gltf['meshes'][node['mesh']]['primitives']:
            attrib = original['attributes']
            position = read(attrib['POSITION']) @ ORIENT.T
            normals = read(attrib['NORMAL']) @ ORIENT.T
            uv = read(attrib['TEXCOORD_0'])
            index = read(original['indices']).reshape(-1)
            count = len(position)
            joints = np.zeros((count,4),np.uint8)
            weights = np.zeros((count,4),np.float32)
            if rigid_head:
                weights[:,0] = 1
            else:
                # Project onto the closest centerline segment so nearby coils retain separate motion.
                best = np.full(count,np.inf)
                for i, (a,b) in enumerate(zip(JOINTS,JOINTS[1:])):
                    seg = b-a
                    delta = position-a
                    t = np.clip((delta @ seg)/(seg @ seg),0,1)
                    error = np.sum((delta-t[:,None]*seg)**2,axis=1)
                    use = error < best
                    best[use] = error[use]
                    joints[use,:2] = [i,i+1]
                    weights[use,0] = 1-t[use]
                    weights[use,1] = t[use]
            group = groups.setdefault(original['material'],[])
            offset = group[-1][-1] if group else 0
            group.append((position,normals,uv,joints,weights,index.astype(np.uint32)+offset,offset+count))

    primitives = []
    for material, chunks in sorted(groups.items()):
        position,normals,uv,joints,weights,index,_ = zip(*chunks)
        primitives.append({'material':material,'indices':write(np.concatenate(index),'<u4',5125,'SCALAR',target=34963),
            'attributes':{
                'POSITION':write(np.concatenate(position),'<f4',5126,'VEC3',True,34962),
                'NORMAL':write(np.concatenate(normals),'<f4',5126,'VEC3',target=34962),
                'TEXCOORD_0':write(np.concatenate(uv),'<f4',5126,'VEC2',target=34962),
                'JOINTS_0':write(np.concatenate(joints),'u1',5121,'VEC4',target=34962),
                'WEIGHTS_0':write(np.concatenate(weights),'<f4',5126,'VEC4',target=34962),
            }})

    nodes = [{'name':'KouperToiper','children':list(range(1,len(JOINTS)+2))},
             {'name':'PaperMesh','mesh':0,'skin':0}]
    inverses = []
    for i, center in enumerate(JOINTS):
        nodes.append({'name':f'Paper{i}','translation':center.tolist()})
        inverse = np.eye(4,dtype=np.float32)
        inverse[3,:3] = -center
        inverses.append(inverse.reshape(-1))
    skin = {'joints':list(range(2,len(nodes))), 'skeleton':0,
            'inverseBindMatrices':write(inverses,'<f4',5126,'MAT4')}
    animations = []
    for name,(duration,frames) in CLIPS.items():
        times = write([frame[0]*duration for frame in frames],'<f4',5126,'SCALAR',True)
        channels,samplers = [],[]
        for i,rest in enumerate(JOINTS):
            n = i/(len(JOINTS)-1)
            head = math.exp(-i*.56)
            tail = n**1.7
            locations, rotations = [],[]
            for _,reach,lift,side,compress,sweep in frames:
                dx = side*head+sweep*tail+compress*(-rest[0])*.56
                dy = lift*head-compress*rest[1]*(1-head)*.56+abs(sweep)*tail*.08
                dz = reach*head+compress*(-rest[2])*.68-abs(sweep)*tail*.22
                locations.append(rest+[dx,dy,dz])
                rotations.append(rotation(-lift*head*.28+sweep*tail*.22, side*head*.62+sweep*tail*.56, -side*head*.28+sweep*tail*.33))
            for prop,values,size in [('translation',locations,'VEC3'),('rotation',rotations,'VEC4')]:
                channels.append({'sampler':len(samplers),'target':{'node':2+i,'path':prop}})
                samplers.append({'input':times,'output':write(values,'<f4',5126,size)})
        animations.append({'name':name,'channels':channels,'samplers':samplers})

    images = []
    for image in gltf['images']:
        source_view = gltf['bufferViews'][image['bufferView']]
        start = source_view.get('byteOffset',0)
        raw = data[start:start+source_view['byteLength']]
        if image.get('name') == 'paper_normal':
            tile = Image.open(io.BytesIO(raw)).convert('RGB')
            tile.thumbnail((768,768),Image.Resampling.LANCZOS)
            encoded = io.BytesIO()
            tile.save(encoded,'JPEG',quality=93,subsampling=0,optimize=True)
            images.append({**image,'mimeType':'image/jpeg','bufferView':payload(encoded.getvalue())})
        else:
            images.append({**image,'bufferView':payload(raw)})

    materials = gltf['materials']
    # The small water drops use alpha instead of forcing a full transmission pass on phones.
    if len(materials)>4:
        drop=materials[4]
        drop.pop('extensions',None)
        drop['alphaMode']='BLEND'
        drop['pbrMetallicRoughness']['baseColorFactor']=[.8,.89,.92,.65]
    extensions = sorted({e for material in materials for e in material.get('extensions',{})})
    out = {'asset':{'version':'2.0','generator':'animate_kouper.py'},
           'scene':0,'scenes':[{'nodes':[0]}],'nodes':nodes,'skins':[skin],
           'meshes':[{'primitives':primitives}],'animations':animations,
           'materials':materials,'textures':gltf['textures'],'images':images,'samplers':gltf['samplers'],
           'extensionsUsed':extensions,'buffers':[{'byteLength':len(binary)}],'bufferViews':views,'accessors':accessors}
    encoded = json.dumps(out,separators=(',',':'),ensure_ascii=False).encode()
    encoded += b' '*(-len(encoded)%4)
    binary.extend(b'\0'*(-len(binary)%4))
    target.write_bytes(struct.pack('<4s4I',b'glTF',2,28+len(encoded)+len(binary),len(encoded),0x4e4f534a)
                       +encoded+struct.pack('<II',len(binary),0x004e4942)+binary)


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source',type=Path)
    parser.add_argument('target',type=Path)
    args=parser.parse_args()
    convert(args.source,args.target)
