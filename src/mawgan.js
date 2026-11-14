// Reference-led, compressed Mawgan Porth landscape. x: north -> south;
// z: village -> Atlantic. Ground elevations are sampled from EA LiDAR.
// The full landscape and the playable bed share this profile: no box-wall skirt.
import { elevationGrid,elevationCm } from './mawgan-elevation.js?v=113';
import { Noise2D } from './noise.js?v=113';
const noise = new Noise2D(5827);
const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));
const smooth = (a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
function profile(points,z) {
  if(z<=points[0][0])return points[0][1];
  for(let i=1;i<points.length;i++)if(z<=points[i][0]){
    const a=points[i-1],b=points[i],t=(z-a[0])/(b[0]-a[0]);
    const prev=points[Math.max(0,i-2)][1],next=points[Math.min(points.length-1,i+1)][1];
    return clamp(a[1]+.5*t*(b[1]-prev+t*(2*prev-5*a[1]+4*b[1]-next+t*(3*(a[1]-b[1])+next-prev))),Math.min(a[1],b[1]),Math.max(a[1],b[1]));
  }
  return points.at(-1)[1];
}
// The bay is now sampled from Environment Agency ground elevations. These
// boundary summaries guide material hardness only; they do not create the hills.
const north=[[-100,60],[0,70.5],[15,69.7],[20,67.2],[30,43.5],[40,29.5],[50,17.2],[60,13.1],[70,5.7],[80,-1.6],[95,-4.9],[110,-9],[150,-30]];
const south=[[-100,125],[0,100.9],[15,93.5],[20,91],[30,86.1],[40,82],[50,73.8],[60,70.5],[70,77.9],[80,86.1],[95,110.7],[110,112.3],[150,190]];
export function bayEdges(z){return [profile(north,z),profile(south,z)];}
export function surveyedHeight(x,z){
  const g=elevationGrid,fx=clamp((x-g.x0)/g.step,0,g.nx-1),fz=clamp((z-g.z0)/g.step,0,g.nz-1);
  const i=Math.min(g.nx-2,Math.floor(fx)),j=Math.min(g.nz-2,Math.floor(fz)),u=fx-i,v=fz-j,k=j*g.nx+i;
  return ((elevationCm[k]*(1-u)+elevationCm[k+1]*u)*(1-v)+(elevationCm[k+g.nx]*(1-u)+elevationCm[k+g.nx+1]*u)*v)/100;
}
// Mapped Menalhyl to its beach outlet, then an authored tidal-sand reach along
// the surveyed southern foot of the bay. The beach channel migrates in reality.
export function mawganStream(z){
  return profile([[-100,117],[-44,92.95],[-24,88.69],[-4.68,88],[3.23,89.34],[8.8,90.74],[12.3,90.89],[14.79,90.12],[17.28,88.43],[17.91,87.66],[20.64,84.95],[30,80],[40,76],[50,68],[60,65],[70,72],[80,79],[95,89],[140,94]],z);
}
export function mawganHeight(x,z){
  const real=surveyedHeight(x,z);
  let h=real*.22; // horizontal scale .15; mild vertical exaggeration for legibility
  // LiDAR describes exposed land, not bathymetry. Continue low/void offshore
  // samples into a shallow authored seabed so low tide does not reveal a shelf.
  h+=Math.min(0,(75-z)*.035)*(1-smooth(.1,1.2,real));
  const d=Math.abs(x-mawganStream(z)),channel=1-smooth(1.0,2.4,d);
  const channelBed=.85-z*.022;
  if(z<103)h=h*(1-channel)+Math.min(h,channelBed)*channel;
  return h;
}
export function mawganHardness(x,z){
  // Inland turf/river banks must not slump like the beach's loose sand.
  return Math.max(.92*(1-smooth(18,27,z)),.08+.9*smooth(1.5,4.5,mawganHeight(x,z)));
}
export function mawganColour(x,z,h,slope,wet=0,disturbed=0){
  const inland=1-smooth(14,26,z),high=smooth(2.0,4.0,h);
  const grass=Math.max(inland,high)*(1-smooth(.5,1.5,slope));
  const stone=smooth(.45,1.2,slope)*smooth(1.2,3.5,h)*(1-grass);
  const n=noise.fbm(x*.12,z*.1,2)*.5+.5;
  const sand=[.69,.57,.37],turf=[.14+n*.08,.23+n*.09,.085+n*.035],slate=[.06+n*.045,.075+n*.045,.085+n*.045];
  return sand.map((v,i)=>((v*(1-grass)+turf[i]*grass)*(1-stone)+slate[i]*stone)*(1-clamp(wet,0,1)*.32)*(1-disturbed*.14));
}
