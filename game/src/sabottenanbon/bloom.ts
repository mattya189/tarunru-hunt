import { Color, Vector2, type Camera, type Group, type Scene, type WebGLRenderer } from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'

const effectLayer=1
const black=new Color(0)
export class BreathBloom {
  private readonly bloom:EffectComposer
  private readonly final:EffectComposer
  private readonly pass:UnrealBloomPass
  constructor(private renderer:WebGLRenderer,private scene:Scene,private camera:Camera,threshold:number) {
    this.bloom=new EffectComposer(renderer)
    this.bloom.renderToScreen=false
    this.bloom.addPass(new RenderPass(scene,camera))
    this.pass=new UnrealBloomPass(new Vector2(1,1),.12,.18,threshold)
    this.bloom.addPass(this.pass)
    this.final=new EffectComposer(renderer)
    this.final.addPass(new RenderPass(scene,camera))
    this.final.addPass(new ShaderPass({
      uniforms:{tDiffuse:{value:null},bloomTexture:{value:this.pass.renderTargetsHorizontal[0].texture}},
      vertexShader:'varying vec2 texUV; void main(){texUV=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader:'uniform sampler2D tDiffuse,bloomTexture; varying vec2 texUV; void main(){gl_FragColor=vec4(texture2D(tDiffuse,texUV).rgb+texture2D(bloomTexture,texUV).rgb,1.);}',
    }))
    this.final.addPass(new OutputPass())
  }
  resize(w:number,h:number) {
    const ratio=this.renderer.getPixelRatio()
    this.bloom.setPixelRatio(ratio*.42)
    this.bloom.setSize(w,h)
    this.final.setPixelRatio(ratio)
    this.final.setSize(w,h)
  }
  render(layer:Group,strength:number) {
    const mask=this.camera.layers.mask
    const background=this.scene.background
    const shadows=this.renderer.shadowMap.needsUpdate
    layer.traverse(object=>object.layers.enable(effectLayer))
    this.camera.layers.set(effectLayer)
    this.scene.background=black
    this.renderer.shadowMap.needsUpdate=false
    this.pass.strength=strength
    try { this.bloom.render() }
    finally {
      this.scene.background=background
      this.camera.layers.mask=mask
      this.renderer.shadowMap.needsUpdate=shadows
    }
    this.final.render()
  }
}
