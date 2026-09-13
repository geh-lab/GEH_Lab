import { GLASS_SURFACE, GLASS_CONTROL, createSurfaceMaps } from './glass-surface-model.js';

const NS='http://www.w3.org/2000/svg';
const filters=new Map();
const MAX_FILTERS=24;
const MAX_FILTER_PIXELS=500000;
const MAX_TOTAL_FILTER_PIXELS=2000000;
const compactMedia=window.matchMedia('(max-width: 980px), (hover: none), (pointer: coarse)');
const nativePlatform=()=>navigator.maxTouchPoints>0||(/AppleWebKit/.test(navigator.userAgent)&&!/(Chrome|Chromium|Edg|OPR)\//.test(navigator.userAgent));
let nextFilterId=0;
let definitions;
const svgNode=(name,attributes={})=>{
  const node=document.createElementNS(NS,name);
  Object.entries(attributes).forEach(([key,value])=>node.setAttribute(key,String(value)));
  return node;
};
function imageUrl(data,width,height) {
  const canvas=document.createElement('canvas'); canvas.width=width; canvas.height=height;
  try {
    canvas.getContext('2d').putImageData(new ImageData(data,width,height),0,0);
    return canvas.toDataURL();
  } finally { canvas.width=0; canvas.height=0; }
}
function surfaceFilter(key,width,height,radius,blur,control,pixels) {
  const shared=filters.get(key);
  if(shared) { shared.users++; return shared; }
  const totalPixels=[...filters.values()].reduce((sum,resource)=>sum+resource.pixels,0);
  if(filters.size>=MAX_FILTERS||pixels>MAX_FILTER_PIXELS||totalPixels+pixels>MAX_TOTAL_FILTER_PIXELS) return null;
  if(!definitions) {
    definitions=svgNode('svg',{width:0,height:0,'aria-hidden':true,focusable:false});
    definitions.classList.add('liquid-glass-definitions');document.body.append(definitions);
  }
  const maps=createSurfaceMaps(width,height,radius,control?GLASS_CONTROL:{});
  const id=`geh-surface-${nextFilterId++}`;
  const filter=svgNode('filter',{id,x:0,y:0,width:'100%',height:'100%',filterUnits:'objectBoundingBox','color-interpolation-filters':'sRGB'});
  const add=(name,attrs)=>{const node=svgNode(name,attrs);filter.append(node);return node;};
  for(const name of ['displacement','mask']) add('feImage',{href:imageUrl(maps[name],maps.width,maps.height),x:0,y:0,width,height,preserveAspectRatio:'none',result:name});
  add('feDisplacementMap',{in:'SourceGraphic',in2:'displacement',scale:GLASS_SURFACE.scale,xChannelSelector:'R',yChannelSelector:'G',result:'refracted'});
  add('feGaussianBlur',{in:'refracted',stdDeviation:blur,result:'soft'});
  add('feComposite',{in:'soft',in2:'mask',operator:'in',result:'inside'});
  add('feComposite',{in:'SourceGraphic',in2:'mask',operator:'out',result:'outside'});
  // Complementary masks add exactly: no alpha seam and no warped exterior.
  add('feComposite',{in:'inside',in2:'outside',operator:'arithmetic',k2:1,k3:1});
  definitions.append(filter);
  const result={key,node:filter,url:`url("#${id}")`,users:1,pixels};
  filters.set(key,result);
  return result;
}

function releaseFilter(resource) {
  if(!resource||--resource.users>0) return;
  resource.node.remove();
  filters.delete(resource.key);
}

const attached=new WeakMap();
export function attachLiquidGlass(host) {
  if(attached.has(host)) return;
  if(getComputedStyle(host).position==='static') host.classList.add('liquid-glass--positioned');
  host.classList.add('liquid-glass');
  // The modal scrim already blurs the page. Its many inner cards only need
  // translucent fills and rims, not a separate offscreen filter per card.
  if(host.closest('.site-modal,.admin-editor-modal,.admin-dialog__panel')) {
    host.dataset.liquidGlass='material';
    attached.set(host,{dispose:()=>attached.delete(host),resize:()=>{}});
    return;
  }
  host.dataset.liquidGlass='native';
  let visible=false;
  let resource=null;
  const clearFilter=()=>{
    host.style.removeProperty('--glass-filter');
    releaseFilter(resource);
    resource=null;
  };
  const dispose=()=>{
    clearFilter();
    sizeObserver.disconnect();
    visibilityObserver.disconnect();
    attached.delete(host);
  };
  const resize=()=>{
    if(!host.isConnected) {dispose();return;}
    if(!visible) {clearFilter();host.dataset.liquidGlass='material';return;}
    // CSS dimensions, not the temporarily scaled entrance animation.
    const width=host.clientWidth,height=host.clientHeight;
    if(width<1||height<1) {clearFilter();host.dataset.liquidGlass='material';return;}
    const style=getComputedStyle(host);
    const corner=style.borderTopLeftRadius;
    const radius=Math.min((Number.parseFloat(corner)||0)*(corner.includes('%')?Math.min(width,height)/100:1),width/2,height/2);
    // A long accordion is a material backing; its individual cards carry lenses.
    // Avoid allocating a several-screen-high backdrop texture for that wrapper.
    if(height>1400) {clearFilter();host.dataset.liquidGlass='material';return;}
    // iOS browsers and Safari use native CSS blur. A syntactically accepted SVG
    // backdrop filter is not evidence that the device can render it reliably.
    if(compactMedia.matches||nativePlatform()||style.getPropertyValue('--glass-backdrop').trim()) {
      clearFilter();host.dataset.liquidGlass='native';return;
    }
    const control=host.matches('.brand,.dock-shell,.header-language,[data-glass-profile="control"]');
    const customBlur=Number.parseFloat(style.getPropertyValue('--glass-blur'));
    const blur=Number.isFinite(customBlur)?Math.max(0,customBlur):(control?0:GLASS_SURFACE.blur);
    const pixelRatio=Math.max(1,window.devicePixelRatio||1);
    const key=[width,height,radius,blur,control,pixelRatio].join(':');
    if(resource?.key!==key) {
      clearFilter();
      try { resource=surfaceFilter(key,width,height,radius,blur,control,width*height*pixelRatio*pixelRatio); }
      catch { resource=null; }
    }
    if(!resource) {host.dataset.liquidGlass='native';return;}
    host.style.setProperty('--glass-filter',resource.url);
    host.dataset.glassOptics=control?'control':'surface';
    host.dataset.liquidGlass='ready';
  };
  const sizeObserver=new ResizeObserver(resize);
  const visibilityObserver=new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;resize();},{rootMargin:'80px'});
  attached.set(host,{dispose,resize});
  sizeObserver.observe(host);visibilityObserver.observe(host);
}

export function setupLiquidGlass() {
  const selectors=[
    '.page-hero-card','.stat-card','.project-card','.member-card','.pi-card','.contact-card',
    '.home-publication-card','.home-news-card','.home-contact-card','.publication-card',
    '.board-card','.news-card','.accordion','.archive-item','.patent-card','.login-card',
    '.admin-card','.admin-item-card','.summary-card','.admin-dialog__panel',
    '.brand','.dock-shell','.header-language','.site-nav','.chrome-popover','.global-search',
    '.search-field-surface','.global-search form','.global-search [data-search-close]',
    '.floating-tools > .chrome-icon','.text-size-control > button',
    '[data-preferences-panel] .theme-options > button',
    '.site-modal__dialog','.site-modal__close','.admin-tab',
    '.detail-block','.member-education-item','.member-experience-item','.linked-card',
    '.member-publication-item','.publication-members__item','.archive-project-item','.publication-item',
    '.admin-editor-modal','.admin-editor-modal .editor-title-row','.admin-editor-modal .admin-card-head',
    '.admin-editor-modal:not(#board-editor-card) .form-actions','.admin-editor-modal .member-editor-actions',
    '.admin-editor-modal .degree-section','.admin-editor-modal .experience-editor-row',
    '.admin-editor-modal .schedule-editor-row','.admin-editor-modal .admin-inline-panel'
  ].join(',');
  const visit=root=>{
    if(!(root instanceof Element)) return;
    if(root.matches(selectors)) attachLiquidGlass(root);
    root.querySelectorAll(selectors).forEach(attachLiquidGlass);
  };
  visit(document.body);
  compactMedia.addEventListener('change',()=>{
    document.querySelectorAll('[data-liquid-glass]').forEach(host=>attached.get(host)?.resize());
  });
  new MutationObserver(records=>{
    // Removed modal content and refreshed rosters must release their observers
    // and shared filter images. Moved nodes still connected to the page stay live.
    for(const record of records) for(const node of record.removedNodes) {
      if(!(node instanceof Element)||node.isConnected) continue;
      attached.get(node)?.dispose();
      node.querySelectorAll('[data-liquid-glass]').forEach(host=>attached.get(host)?.dispose());
    }
    for(const record of records) for(const node of record.addedNodes) {
      if(node instanceof Element&&!node.matches('.liquid-glass-definitions,svg *'))visit(node);
    }
  }).observe(document.body,{childList:true,subtree:true});
}
