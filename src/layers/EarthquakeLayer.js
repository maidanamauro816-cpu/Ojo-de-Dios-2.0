import { fetchEarthquakes } from "../fetchers/earthquakes.js";

export class EarthquakeLayer {
  constructor(viewer,onStatus=()=>{}){this.viewer=viewer;this.onStatus=onStatus;this.entities=new Map();this.visible=false;this.controller=null;this.timer=null;}
  async refresh(){
    if(!this.visible)return;
    this.controller?.abort();this.controller=new AbortController();
    this.onStatus({loading:true,count:this.entities.size});
    try{
      const quakes=await fetchEarthquakes({signal:this.controller.signal}),incoming=new Set();
      for(const q of quakes){
        incoming.add(q.id);
        const mag=Number(q.magnitude),size=Math.max(5,Math.min(18,5+mag*2));
        const pos=Cesium.Cartesian3.fromDegrees(q.lon,q.lat,0);
        const description="<b>Magnitud "+mag.toFixed(1)+"</b><br>"+escapeHtml(q.place)+"<br>Profundidad: "+q.depthKm.toFixed(1)+" km<br>"+new Date(q.time).toLocaleString()+"<br>"+(q.tsunami?"Alerta de tsunami reportada":"Sin alerta de tsunami en este registro")+'<br><a href="'+safeUrl(q.url)+'" target="_blank" rel="noopener">Ficha USGS</a>';
        let entity=this.entities.get(q.id);
        if(!entity){entity=this.viewer.entities.add({id:"quake-"+q.id,name:"Sismo M"+mag.toFixed(1),position:pos,point:{pixelSize:size,color:mag>=5?Cesium.Color.RED:mag>=3?Cesium.Color.ORANGE:Cesium.Color.YELLOW,outlineColor:Cesium.Color.WHITE,outlineWidth:1},description});this.entities.set(q.id,entity);}
        else{entity.position=pos;entity.description=description;}
      }
      for(const [id,e] of this.entities)if(!incoming.has(id)){this.viewer.entities.remove(e);this.entities.delete(id);}
      this.onStatus({loading:false,count:this.entities.size,updatedAt:new Date().toISOString()});
    }catch(error){if(error.name!=="AbortError")this.onStatus({loading:false,count:this.entities.size,error:error.message});}
  }
  setVisible(v){this.visible=v;for(const e of this.entities.values())e.show=v;if(this.timer)clearInterval(this.timer);if(v){this.refresh();this.timer=setInterval(()=>this.refresh(),5*60*1000);}else this.controller?.abort();}
  destroy(){if(this.timer)clearInterval(this.timer);this.controller?.abort();for(const e of this.entities.values())this.viewer.entities.remove(e);this.entities.clear();}
}
function escapeHtml(v){return String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function safeUrl(v){try{const u=new URL(v);return u.protocol==="https:"?u.href:"#";}catch{return "#";}}
