import {mappedRoads} from './mawgan-map.js?v=113';
const segments=[];
for(const road of mappedRoads){
  if(['footway','path','steps','track'].includes(road.kind))continue;
  const half=road.kind==='service'?.35:road.kind==='secondary'?.675:.55;
  for(let i=1;i<road.points.length;i++)segments.push({a:road.points[i-1],b:road.points[i],half});
}
export function roadOverlapsFootprint(x,z,w,d,rotation=0,clearance=.12){
  const c=Math.cos(rotation),s=Math.sin(rotation),radius=Math.hypot(w,d)/2+1.5;
  for(const {a,b,half} of segments){
    if(x+radius<Math.min(a[0],b[0])||x-radius>Math.max(a[0],b[0])||z+radius<Math.min(a[1],b[1])||z-radius>Math.max(a[1],b[1]))continue;
    const ax=(a[0]-x)*c-(a[1]-z)*s,az=(a[0]-x)*s+(a[1]-z)*c;
    const bx=(b[0]-x)*c-(b[1]-z)*s,bz=(b[0]-x)*s+(b[1]-z)*c;
    let lo=0,hi=1;
    for(const [start,delta,extent] of [[ax,bx-ax,w/2+half+clearance],[az,bz-az,d/2+half+clearance]]){
      if(Math.abs(delta)<1e-7){if(Math.abs(start)>extent){hi=-1;break;}}
      else {const t0=(-extent-start)/delta,t1=(extent-start)/delta;lo=Math.max(lo,Math.min(t0,t1));hi=Math.min(hi,Math.max(t0,t1));}
    }
    if(lo<=hi)return true;
  }
  return false;
}
