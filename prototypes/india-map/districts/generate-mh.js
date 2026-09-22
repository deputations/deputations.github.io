// districts/generate-districts.js
// Generates approximate district polygons for Maharashtra using real centroid coordinates.
// These are synthetic placeholders — NOT boundary-accurate — for prototype interaction testing.
// Real district geometry should be sourced from Survey of India / data.gov.in for production.

const MH_DISTRICTS = [
  // [name, approx_lat, approx_lon, approx_area_deg]
  ["Ahmednagar", 19.09, 74.74, 0.8],
  ["Akola", 20.70, 77.01, 0.5],
  ["Amravati", 20.93, 77.75, 0.6],
  ["Aurangabad", 19.88, 75.32, 0.6],
  ["Beed", 18.99, 75.76, 0.6],
  ["Bhandara", 21.17, 79.65, 0.4],
  ["Buldhana", 20.53, 76.18, 0.6],
  ["Chandrapur", 19.96, 79.30, 0.9],
  ["Dhule", 20.90, 74.77, 0.5],
  ["Gadchiroli", 20.19, 80.00, 0.8],
  ["Gondia", 21.46, 80.20, 0.5],
  ["Hingoli", 19.72, 77.11, 0.4],
  ["Jalgaon", 21.01, 75.56, 0.7],
  ["Jalna", 19.84, 75.88, 0.4],
  ["Kolhapur", 16.70, 74.24, 0.6],
  ["Latur", 18.40, 76.58, 0.5],
  ["Mumbai City", 19.08, 72.88, 0.2],
  ["Mumbai Suburban", 19.15, 72.86, 0.3],
  ["Nagpur", 21.15, 79.08, 0.7],
  ["Nanded", 19.15, 77.30, 0.5],
  ["Nandurbar", 21.38, 74.24, 0.5],
  ["Nashik", 20.01, 73.78, 0.9],
  ["Osmanabad", 18.19, 76.04, 0.5],
  ["Palghar", 19.70, 72.76, 0.6],
  ["Parbhani", 19.27, 76.75, 0.4],
  ["Pune", 18.52, 73.86, 0.8],
  ["Raigad", 18.48, 73.18, 0.7],
  ["Ratnagiri", 17.00, 73.31, 0.6],
  ["Sangli", 16.85, 74.56, 0.5],
  ["Satara", 17.68, 74.01, 0.7],
  ["Sindhudurg", 16.17, 73.56, 0.5],
  ["Solapur", 17.66, 75.91, 0.8],
  ["Thane", 19.20, 73.04, 0.5],
  ["Wardha", 20.74, 78.60, 0.4],
  ["Washim", 19.95, 76.98, 0.4],
  ["Yavatmal", 20.39, 78.13, 0.7]
];

function generatePolygon(lat, lon, area) {
  // Generate a hexagon-like polygon centered at (lat, lon)
  const sides = 8;
  const dLat = Math.sqrt(area) * 0.15;
  const dLon = dLat * 1.3; // Adjust for latitude distortion
  const points = [];
  for (let i = 0; i < sides; i++) {
    const angle = (2 * Math.PI * i) / sides;
    const jitter = 0.7 + Math.random() * 0.3;
    const la = lat + Math.cos(angle) * dLat * jitter;
    const lo = lon + Math.sin(angle) * dLon * jitter * (1/Math.cos(lat * Math.PI/180));
    points.push([lo, la]);
  }
  points.push(points[0].slice()); // close
  return points;
}

const features = MH_DISTRICTS.map(([name, lat, lon, area]) => ({
  type: "Feature",
  properties: {
    district: name,
    centroid_lat: lat,
    centroid_lon: lon
  },
  geometry: {
    type: "Polygon",
    coordinates: [generatePolygon(lat, lon, area)]
  }
}));

const geojson = {
  type: "FeatureCollection",
  features
};

require('fs').writeFileSync('MH.geojson', JSON.stringify(geojson));
console.log(`Generated ${features.length} district polygons`);
