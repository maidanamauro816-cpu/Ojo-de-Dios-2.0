export async function fetchCurrentWeather(lat,lon,{signal}={}) {
  const url=new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude",String(lat));url.searchParams.set("longitude",String(lon));
  url.searchParams.set("current","temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_direction_10m");
  url.searchParams.set("timezone","auto");
  const response=await fetch(url,{signal,cache:"no-store"});
  if(!response.ok)throw new Error("Open-Meteo HTTP "+response.status);
  const data=await response.json();
  return {lat:data.latitude,lon:data.longitude,timezone:data.timezone,current:data.current,units:data.current_units};
}
