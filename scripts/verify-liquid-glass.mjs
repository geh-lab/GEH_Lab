import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Exercise the actual browser module with deterministic visibility, removal and
// resize events. No browser session, network requests or GPU allocation needed.
const source=(await readFile(new URL('../assets/js/liquid-glass.js',import.meta.url),'utf8'))
  .replace(/^import .*;\n/,'').replaceAll('export function ','function ');
function fixture({compact=false,touch=0,ua='AppleWebKit Chrome/140 Safari/537',dpr=1,canvasFailure=false}={}) {
  const observers={resize:[],intersection:[],mutation:[]};
  const canvases=[];
  class Element {
    constructor(tag='article',classes='',width=120,height=60) {
      this.tagName=tag; this.attrs={};this.dataset={};this.children=[];this.parentElement=null;
      this.clientWidth=width;this.clientHeight=height;
      const names=new Set(classes.split(' ').filter(Boolean));
      this.classList={add:name=>names.add(name),contains:name=>names.has(name)};
      const properties=new Map();
      this.style={setProperty:(key,value)=>properties.set(key,String(value)),removeProperty:key=>properties.delete(key),getPropertyValue:key=>properties.get(key)||''};
    }
    get isConnected(){return this===document.body||!!this.parentElement?.isConnected;}
    setAttribute(key,value){this.attrs[key]=String(value);}
    append(...nodes){nodes.forEach(node=>{node.parentElement=this;this.children.push(node);});}
    remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(node=>node!==this);this.parentElement=null;}
    matches(selector){return selector.split(',').some(part=>part==='[data-liquid-glass]'?!!this.dataset.liquidGlass:part[0]==='.'?this.classList.contains(part.slice(1)):this.tagName===part);}
    closest(selector){return this.matches(selector)?this:this.parentElement?.closest(selector)||null;}
    querySelectorAll(selector){return this.children.flatMap(node=>[...(node.matches(selector)?[node]:[]),...node.querySelectorAll(selector)]);}
  }
  const document={body:new Element('body'),querySelectorAll:selector=>document.body.querySelectorAll(selector),createElementNS:(_,tag)=>new Element(tag),createElement:tag=>{
    if(tag!=='canvas')return new Element(tag);
    const canvas={width:0,height:0,getContext:()=>canvasFailure?null:{putImageData(){}},toDataURL:()=> 'data:image/png;base64,AA=='};
    canvases.push(canvas);return canvas;
  }};
  const observerClass=kind=>class {
    constructor(callback){this.callback=callback;this.targets=new Set();observers[kind].push(this);}
    observe(node){this.targets.add(node);}
    disconnect(){this.targets.clear();}
  };
  const media={matches:compact,listeners:[],addEventListener:(_,fn)=>media.listeners.push(fn)};
  const context=vm.createContext({window:{matchMedia:()=>media,devicePixelRatio:dpr},navigator:{maxTouchPoints:touch,userAgent:ua},document,Element,
    ResizeObserver:observerClass('resize'),IntersectionObserver:observerClass('intersection'),MutationObserver:observerClass('mutation'),
    ImageData:class{},GLASS_SURFACE:{scale:32,blur:.2},GLASS_CONTROL:{},
    createSurfaceMaps:()=>({width:24,height:24,displacement:[],mask:[]}),
    getComputedStyle:node=>({position:'relative',borderTopLeftRadius:'20px',getPropertyValue:key=>node.style.getPropertyValue(key)})});
  vm.runInContext(source,context);
  context.setupLiquidGlass();
  const show=node=>observers.intersection.filter(o=>o.targets.has(node)).forEach(o=>o.callback([{isIntersecting:true}]));
  return {context,document,observers,media,canvases,
    host:(width=120,height=60,parent=document.body,classes='stat-card')=>{const node=new Element('article',classes,width,height);parent.append(node);context.attachLiquidGlass(node);show(node);return node;},
    wrapper:()=>{const node=new Element('div','site-modal');document.body.append(node);return node;},
    filters:()=>document.querySelectorAll('filter'),
    resize:node=>observers.resize.filter(o=>o.targets.has(node)).forEach(o=>o.callback([])),
    hide:node=>observers.intersection.filter(o=>o.targets.has(node)).forEach(o=>o.callback([{isIntersecting:false}])),show,
    remove:node=>{node.remove();observers.mutation.forEach(o=>o.callback([{removedNodes:[node],addedNodes:[]}]))}
  };
}
{
  const f=fixture();const wrapper=f.wrapper();
  const cards=Array.from({length:122},()=>f.host(700,100,wrapper,'member-publication-item'));
  assert.ok(cards.every(node=>node.dataset.liquidGlass==='material'));
  assert.equal(f.filters().length,0);
  assert.equal(f.observers.resize.length,0,'Modal cards must not create resize observers');
  f.remove(wrapper);
}
for(const options of [{compact:true},{touch:5},{ua:'AppleWebKit/605.1.15 Version/18 Safari/605.1.15'},{touch:5,ua:'AppleWebKit/605.1.15 CriOS/140 Mobile Safari/604.1'}]){
  const f=fixture(options);const node=f.host();
  assert.equal(node.dataset.liquidGlass,'native');assert.equal(f.filters().length,0);assert.equal(f.canvases.length,0);
}
{
  const f=fixture();const a=f.host(),b=f.host();
  assert.equal(f.filters().length,1,'Identical visible surfaces share one resource');
  const oldId=f.filters()[0].attrs.id;
  f.remove(a);assert.equal(f.filters().length,1);
  f.remove(b);assert.equal(f.filters().length,0,'Last owner must release its filter');
  assert.ok([...f.observers.resize,...f.observers.intersection].every(o=>o.targets.size===0));
  const c=f.host();assert.notEqual(f.filters()[0].attrs.id,oldId);
  for(let i=0;i<80;i++){c.clientWidth=140+i;f.resize(c);assert.equal(f.filters().length,1);}
  f.hide(c);assert.equal(f.filters().length,0);
  f.show(c);assert.equal(f.filters().length,1);
  f.media.matches=true;f.media.listeners.forEach(fn=>fn());assert.equal(f.filters().length,0);assert.equal(c.dataset.liquidGlass,'native');
  f.media.matches=false;f.media.listeners.forEach(fn=>fn());assert.equal(f.filters().length,1);
  assert.ok(f.canvases.every(canvas=>canvas.width===0&&canvas.height===0),'Temporary canvas backing stores must be cleared');
}
{
  const f=fixture();const nodes=Array.from({length:40},(_,i)=>f.host(80+i,40));
  assert.equal(f.filters().length,24,'Concurrent distinct filters must be bounded');
  assert.ok(nodes.some(node=>node.dataset.liquidGlass==='native'));
  nodes.forEach(node=>f.remove(node));assert.equal(f.filters().length,0);
}
{
  const f=fixture({dpr:2});const large=f.host(700,800);
  assert.equal(large.dataset.liquidGlass,'native');assert.equal(f.filters().length,0);
  const g=fixture();const nodes=Array.from({length:10},(_,i)=>g.host(600+i,600));
  assert.ok(g.filters().length<=5,'Total filter pixel budget must be bounded');
  assert.equal(nodes.at(-1).dataset.liquidGlass,'native');
}
{
  const f=fixture({canvasFailure:true});const node=f.host();
  assert.equal(node.dataset.liquidGlass,'native');assert.equal(f.filters().length,0);
  assert.ok(f.canvases.every(canvas=>canvas.width===0&&canvas.height===0));
}
console.log('Liquid glass checks passed: 122 modal cards without filters, native touch/WebKit rendering, shared resource cleanup, resize/visibility lifecycle, count/pixel limits, canvas failure fallback.');
