export async function fetchEarthquakes({signal}={}) {
  const response=await fetch("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson",{signal,cache:"no-store"});
  if(!response.ok)throw new Error("USGS HTTP "+response.status);
  const data=await response.json();
  return (data.features||[]).map(f=>{
    const p=f.properties||{},c=f.geometry?.coordinates||[];
    return {id:f.id,lon:+c[0],lat:+c[1],depthKm:+c[2],magnitude:p.mag,place:p.place||"Ubicación sin datos",time:p.time,url:p.url,tsunami:!!p.tsunami};
  }).filter(q=>q.id&&Number.isFinite(q.lat)&&Number.isFinite(q.lon)&&Number.isFinite(q.magnitude));
}
