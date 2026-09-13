// A two-dimensional rounded-rectangle lens. Circles are the equal-sided case.
// The entire interior transmits the scene; only the bevel adds stronger bending.
export const GLASS_SURFACE = Object.freeze({ strength:.24, magnification:.007, magnificationLimit:5, bevelRatio:.22, scale:32, blur:.2 });
// Short header capsules need a deeper lens, not a brighter painted outline.
export const GLASS_CONTROL = Object.freeze({ strength:.26, magnification:.16, magnificationLimit:12, bevelRatio:.48 });
const clamp = (value, min=0, max=1) => Math.max(min, Math.min(max, value));
const smooth = value => { const t=clamp(value); return t*t*(3-2*t); };

export function surfaceOptics(x, y, width, height, radius, options={}) {
  const config={...GLASS_SURFACE,...options};
  const r=clamp(radius,0,Math.min(width,height)/2);
  const px=x-width/2, py=y-height/2;
  const qx=Math.abs(px)-(width/2-r), qy=Math.abs(py)-(height/2-r);
  const ox=Math.max(qx,0), oy=Math.max(qy,0), length=Math.hypot(ox,oy);
  const distance=-(length+Math.min(Math.max(qx,qy),0)-r);
  if(distance<=0) return {mask:0,dx:0,dy:0,distance};
  let nx=0,ny=0;
  if(length>0) { nx=Math.sign(px)*ox/length; ny=Math.sign(py)*oy/length; }
  else if(qx>qy) nx=Math.sign(px);
  else ny=Math.sign(py);
  const mask=smooth(distance/1.25);
  const bevel=Math.min(26,Math.min(width,height)*config.bevelRatio);
  const t=clamp(distance/bevel);
  const bending=bevel*clamp(config.strength,0,.3)*Math.sin(Math.PI*t);
  // A slight magnification across the whole face avoids an empty-centred ring.
  // Cap the offset on very wide/tall panels; text itself is never filtered.
  const limit=config.magnificationLimit;
  const dx=mask*(nx*bending-clamp(px*config.magnification,-limit,limit));
  const dy=mask*(ny*bending-clamp(py*config.magnification,-limit,limit));
  return {mask,dx,dy,distance};
}

export function createSurfaceMaps(width,height,radius,options={}) {
  const ratio=Math.min(1,480/Math.max(width,height));
  const mapWidth=Math.max(24,Math.round(width*ratio));
  const mapHeight=Math.max(24,Math.round(height*ratio));
  const displacement=new Uint8ClampedArray(mapWidth*mapHeight*4);
  const mask=new Uint8ClampedArray(displacement.length);
  for(let y=0;y<mapHeight;y++) for(let x=0;x<mapWidth;x++) {
    const value=surfaceOptics((x+.5)*width/mapWidth,(y+.5)*height/mapHeight,width,height,radius,options);
    const i=(y*mapWidth+x)*4;
    displacement[i]=255*(.5+value.dx/GLASS_SURFACE.scale);
    displacement[i+1]=255*(.5+value.dy/GLASS_SURFACE.scale);
    displacement[i+2]=128; displacement[i+3]=255;
    mask[i]=mask[i+1]=mask[i+2]=255; mask[i+3]=Math.round(value.mask*255);
  }
  return {width:mapWidth,height:mapHeight,displacement,mask};
}
