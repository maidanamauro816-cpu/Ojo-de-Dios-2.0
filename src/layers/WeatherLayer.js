import { fetchCurrentWeather } from "../fetchers/weather.js";

export class WeatherLayer {
  constructor(viewer,onStatus=()=>{}){this.viewer=viewer;this.onStatus=onStatus;this.entity=null;this.visible=false;this.controller=null;this.timer=null;}
  center(){
    const p=this.viewer.camera.pickEllipsoid(new Cesium.Cartesian2(this.viewer.canvas.clientWidth/2,this.viewer.canvas.clientHeight/2),this.viewer.scene.globe.ellipsoid);
    if(!p)return null;
    const c=Cesium.Cartographic.fromCartesian(p);
    return [Cesium.Math.toDegrees(c.latitude),Cesium.Math.toDegrees(c.longitude)];
  }
  async refresh(){
    if(!this.visible)return;
    const point=this.center();if(!point){this.onStatus({loading:false,error:"Acercá el globo a una ubicación para consultar el clima"});return;}
    this.controller?.abort();this.controller=new AbortController();this.onStatus({loading:true});
    try{
      const [lat,lon]=point,w=await fetchCurrentWeather(lat,lon,{signal:this.controller.signal}),c=w.current,u=w.units;
      const code=Number(c.weather_code),summary=weatherLabel(code);
      const text="<b>CLIMA ACTUAL · "+escapeHtml(summary)+"</b><br>Temperatura: "+c.temperature_2m+" "+u.temperature_2m+"<br>Sensación: "+c.apparent_temperature+" "+u.apparent_temperature+"<br>Humedad: "+c.relative_humidity_2m+"%<br>Precipitación: "+c.precipitation+" "+u.precipitation+"<br>Viento: "+c.wind_speed_10m+" "+u.wind_speed_10m+" · dirección "+c.wind_direction_10m+"°<br>Zona horaria: "+escapeHtml(w.timezone)+"<br>Actualizado: "+escapeHtml(c.time)+"<br><small>Open-Meteo · condiciones del punto central visible</small>";
      const pos=Cesium.Cartesian3.fromDegrees(w.lon,w.lat,0);
      if(!this.entity)this.entity=this.viewer.entities.add({id:"weather-current",name:"Clima en el centro del mapa",position:pos,point:{pixelSize:11,color:Cesium.Color.fromCssColorString("#66d9ff"),outlineColor:Cesium.Color.WHITE,outlineWidth:2},label:{text:"CLIMA",font:"10px sans-serif",fillColor:Cesium.Color.WHITE,outlineColor:Cesium.Color.BLACK,outlineWidth:2,style:Cesium.LabelStyle.FILL_AND_OUTLINE,pixelOffset:new Cesium.Cartesian2(0,-22)},description:text});
      else{this.entity.position=pos;this.entity.description=text;}
      this.onStatus({loading:false,summary,temperature:c.temperature_2m,updatedAt:c.time});
    }catch(error){if(error.name!=="AbortError")this.onStatus({loading:false,error:error.message});}
  }
  setVisible(v){this.visible=v;if(this.entity)this.entity.show=v;if(this.timer)clearInterval(this.timer);if(v){this.refresh();this.timer=setInterval(()=>this.refresh(),10*60*1000);}else this.controller?.abort();}
  destroy(){if(this.timer)clearInterval(this.timer);this.controller?.abort();if(this.entity)this.viewer.entities.remove(this.entity);}
}
function weatherLabel(code){if(code===0)return"Despejado";if([1,2,3].includes(code))return"Parcialmente nublado";if([45,48].includes(code))return"Niebla";if([51,53,55,56,57].includes(code))return"Llovizna";if([61,63,65,66,67,80,81,82].includes(code))return"Lluvia";if([71,73,75,77,85,86].includes(code))return"Nieve";if([95,96,99].includes(code))return"Tormenta";return"Condición meteorológica";}
function escapeHtml(v){return String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
