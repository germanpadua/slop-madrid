[out:json][timeout:180];
(
  way["building"](40.4138,-3.7125,40.4228,-3.6898);
  relation["building"](40.4138,-3.7125,40.4228,-3.6898);
  way["highway"](40.4138,-3.7125,40.4228,-3.6898);
  nwr["historic"]["name"](40.4138,-3.7125,40.4228,-3.6898);
  nwr["tourism"]["name"](40.4138,-3.7125,40.4228,-3.6898);
  nwr["man_made"]["name"](40.4138,-3.7125,40.4228,-3.6898);
  nwr["amenity"~"fountain|place_of_worship"](40.4138,-3.7125,40.4228,-3.6898);
  nwr["place"="square"](40.4138,-3.7125,40.4228,-3.6898);
  way["natural"="water"](40.4138,-3.7125,40.4228,-3.6898);
  relation["natural"="water"](40.4138,-3.7125,40.4228,-3.6898);
  way["waterway"](40.4138,-3.7125,40.4228,-3.6898);
  way["leisure"~"park|garden|pitch|playground"](40.4138,-3.7125,40.4228,-3.6898);
  way["landuse"~"grass|forest|meadow|recreation_ground"](40.4138,-3.7125,40.4228,-3.6898);
  way["highway"="pedestrian"]["area"="yes"](40.4138,-3.7125,40.4228,-3.6898);
);
out geom meta;
